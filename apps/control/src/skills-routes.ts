import type { Db, PendingSkillRow, User } from "@open-bot/db"
import { writeVikingSkillFile } from "./docker"
import type { EventHub } from "./events"
import { HttpError, httpErrorResponse } from "./http-error"
import { seedSkillDescriptions } from "./personas"
import { pluginOwnership, pluginSkillGroups } from "./plugin-ownership"
import {
  assertSkillInput,
  type createVikingSkills,
  danglingSkillRefs,
  type SkillDetail,
  skillFileContent,
  skillNameError,
} from "./viking-skills"

export type VikingSkills = ReturnType<typeof createVikingSkills>

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function isSkillsRequest(pathname: string): boolean {
  return pathname === "/api/skills"
}

// Failures after which an authored skill must be kept, not lost (#135):
// OpenViking's model quota (429 during its indexing calls), timeouts, and
// transient 5xx. Validation/name 4xx stay hard failures — storing those
// pending would retry an invalid skill forever.
export function retryableSkillError(error: unknown): boolean {
  return (
    error instanceof HttpError && (error.status === 429 || error.status >= 500)
  )
}

function pendingDetail(row: PendingSkillRow): SkillDetail {
  return { name: row.name, description: row.description, body: row.body }
}

// Skills installed before the single-file guard (or written straight
// into OpenViking) can still send readers to companion files that do
// not exist on disk (#131). Reads name them instead of letting the
// agent discover the dead end mid-task; saves reject them (#127).
export function withDanglingWarning<T extends SkillDetail>(detail: T) {
  const danglingRefs = danglingSkillRefs(detail.body)
  if (danglingRefs.length === 0) return detail
  return {
    ...detail,
    danglingRefs,
    warning: `${detail.name} references files that do not ship with this single-file skill (${danglingRefs.join(", ")}); those files are not on disk — inline their content into the skill body (re-save with ob-skill) or treat those steps as unavailable.`,
  }
}

// One upstream retry for a pending row. Success clears the row and mirrors
// the loader file; failure records the attempt and keeps the row durable.
async function flushPendingSkill(
  db: Db,
  user: User,
  skills: VikingSkills,
  row: PendingSkillRow,
): Promise<boolean> {
  const detail = pendingDetail(row)
  try {
    await skills.save(detail, row.previousName)
  } catch (error) {
    db.setPendingSkill({
      ...row,
      attempts: row.attempts + 1,
      lastError: (error instanceof Error ? error.message : "save failed").slice(
        0,
        300,
      ),
      updatedAt: Date.now(),
    })
    return false
  }
  db.deletePendingSkill(user.id, row.name)
  await writeVikingSkillFile(user.id, detail.name, skillFileContent(detail))
    .then(() =>
      row.previousName && row.previousName !== detail.name
        ? writeVikingSkillFile(user.id, row.previousName, null)
        : undefined,
    )
    .catch(() => {})
  return true
}

/** Retries every pending skill save for a user (desktop wake). */
export async function flushPendingSkills(
  db: Db,
  user: User,
  makeClient: () => Promise<VikingSkills>,
): Promise<number> {
  const rows = db.pendingSkills(user.id)
  if (rows.length === 0) return 0
  const skills = await makeClient()
  let synced = 0
  for (const row of rows) {
    if (await flushPendingSkill(db, user, skills, row)) synced++
  }
  return synced
}

// Custom skills live in the desktop's OpenViking; this handler is their one
// editor surface — the dashboard Skills tab and, over the LLM token, the
// ob-skill CLI. `makeClient` ensures the desktop and returns the scoped
// Viking client; it is injected so tests run against an in-memory fake.
export async function handleSkills(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
  makeClient: () => Promise<VikingSkills>,
): Promise<Response> {
  try {
    return await skillsRoutes(req, url, db, user, hub, makeClient)
  } catch (error) {
    // Same shape the routes produced inline (validation threw to the
    // server-level handler); kept here so the handler is self-contained.
    return httpErrorResponse(error)
  }
}

async function skillsRoutes(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
  makeClient: () => Promise<VikingSkills>,
): Promise<Response> {
  if (req.method === "GET") {
    const name = url.searchParams.get("name")?.trim() ?? ""
    if (name) {
      const nameError = skillNameError(name)
      if (nameError) return json({ error: nameError }, 400)
    }
    const skills = await makeClient()
    if (name) {
      // A pending save is the newest authored version: try to sync it now,
      // and serve it either way — read-back must never 404 a skill the
      // control plane already accepted durably (#135).
      const pending = db.pendingSkill(user.id, name)
      if (pending) {
        const flushed = await flushPendingSkill(db, user, skills, pending)
        if (!flushed)
          return json(
            withDanglingWarning({ ...pendingDetail(pending), pending: true }),
          )
        return json(
          withDanglingWarning(
            await skills.get(name).catch(() => pendingDetail(pending)),
          ),
        )
      }
      return json(withDanglingWarning(await skills.get(name)))
    }
    const ownership = pluginOwnership(db, user.id)
    const groups = pluginSkillGroups(db, user.id)
    // Seed skills ride along read-only: the persona picker catalogs them,
    // so the Skills tab must list them too — otherwise most picker entries
    // could never be organized into a directory from the UI.
    let seeds: Map<string, string>
    try {
      seeds = await seedSkillDescriptions(user.id)
    } catch {
      seeds = new Map()
    }
    const listed = await skills.list()
    const seen = new Set(listed.map((skill) => skill.name))
    // Pending saves list like saved ones (marked pending), overriding a
    // stale upstream copy with the newer authored description (#135).
    const pendingRows = db.pendingSkills(user.id)
    const pendingByName = new Map(pendingRows.map((row) => [row.name, row]))
    return json({
      skills: [
        ...listed.map((skill) => {
          const plugin = ownership.skillByName.get(skill.name)
          const group = groups.get(skill.name) ?? null
          const pending = pendingByName.get(skill.name)
          return {
            ...skill,
            ...(pending
              ? { description: pending.description, pending: true }
              : {}),
            group,
            seed: false,
            plugin: plugin ?? undefined,
          }
        }),
        ...pendingRows
          .filter((row) => !seen.has(row.name))
          .map((row) => ({
            name: row.name,
            description: row.description,
            group: groups.get(row.name) ?? null,
            seed: false,
            pending: true,
          })),
        ...[...seeds.entries()]
          .filter(([seedName]) => !seen.has(seedName))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([seedName, description]) => ({
            name: seedName,
            description,
            group: null,
            seed: true,
          })),
      ],
    })
  }
  if (req.method === "PUT") {
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) return json({ error: "invalid json" }, 400)
    const input = {
      name: String(body.name ?? "").trim(),
      description: String(body.description ?? "").trim(),
      body: String(body.body ?? ""),
    }
    const previousName = String(body.previousName ?? "").trim()
    assertSkillInput(input)
    if (previousName) {
      const previousError = skillNameError(previousName)
      if (previousError) return json({ error: previousError }, 400)
    }
    const skills = await makeClient()
    // A rename carries the directory membership over: the label points at
    // the skill, not the name.
    const carriedDir =
      previousName && previousName !== input.name
        ? (db
            .catalogDirItems(user.id, "skill")
            .find((row) => row.name === previousName)?.dirId ?? null)
        : null
    // Durable acceptance first (#135/#143/#146): park the exact authored
    // body in the control-plane pending store *before* the upstream save.
    // The upstream replace is delete+post, so this closes the window where
    // an update temporarily removed the existing skill, covers a control
    // crash mid-save, and keeps the skill when OpenViking's model quota
    // 429s the write. Success below clears the row.
    const priorPending = db.pendingSkill(user.id, input.name)
    const parkedAt = Date.now()
    db.setPendingSkill({
      userId: user.id,
      name: input.name,
      previousName: previousName || (priorPending?.previousName ?? ""),
      description: input.description,
      body: input.body,
      attempts: priorPending?.attempts ?? 0,
      lastError: priorPending?.lastError ?? "",
      createdAt: priorPending?.createdAt ?? parkedAt,
      updatedAt: parkedAt,
    })
    let saved: { confirmed: boolean } | undefined
    let pendingError: unknown = null
    try {
      saved = await skills.save(input, previousName)
    } catch (error) {
      if (!retryableSkillError(error)) {
        // A hard rejection must not leave the just-parked body pending:
        // restore the row this save overwrote, or drop it when it is new.
        if (priorPending) db.setPendingSkill(priorPending)
        else db.deletePendingSkill(user.id, input.name)
        throw error
      }
      pendingError = error
      const parked = db.pendingSkill(user.id, input.name)
      if (parked)
        db.setPendingSkill({
          ...parked,
          attempts: parked.attempts + 1,
          lastError: (error instanceof Error
            ? error.message
            : "save failed"
          ).slice(0, 300),
          updatedAt: Date.now(),
        })
    }
    if (!pendingError) {
      db.deletePendingSkill(user.id, input.name)
      if (previousName && previousName !== input.name)
        db.deletePendingSkill(user.id, previousName)
    }
    if (previousName && previousName !== input.name) {
      db.setCatalogDirItem(user.id, "skill", input.name, carriedDir)
      db.removeCatalogDirItems(user.id, "skill", [previousName])
    }
    // Mirror to the desktop disk so opencode's skill loader discovers the
    // skill (#15/#19). Best-effort: OpenViking is the truth, a failed
    // mirror must not fail the save (the wake re-sync repairs it).
    await writeVikingSkillFile(user.id, input.name, skillFileContent(input))
      .then(() =>
        previousName && previousName !== input.name
          ? writeVikingSkillFile(user.id, previousName, null)
          : undefined,
      )
      .catch(() => {})
    // An open Skills tab never sees agent/CLI writes otherwise — the tab
    // refreshes everything on catalog.changed, not just its directories.
    hub.emit(user.id, { type: "catalog.changed" })
    // confirmed !== false keeps older client shapes (and fakes) truthful;
    // an unconfirmed save is still durable — the read-back lagged, that's
    // all. Reporting it as success-with-note stops the blind retries that
    // the 502 used to trigger.
    const uri = `viking://~/skills/${input.name}/SKILL.md`
    if (pendingError) {
      const reason =
        pendingError instanceof Error ? pendingError.message : "save failed"
      return json({
        ok: true,
        status: "pending",
        pending: true,
        confirmed: false,
        uri,
        note: `${input.name} is stored durably in the control plane (OpenViking could not take the write: ${reason}). It already reads back and lists as pending, and syncs to OpenViking automatically on read and on desktop wake. Do not rewrite it from scratch.`,
      })
    }
    if (saved?.confirmed === false) {
      return json({
        ok: true,
        status: "pending",
        confirmed: false,
        uri,
        note: `${input.name} is written; OpenViking is still indexing it — a get may 404 for a few seconds. Do not retry the save (it already landed).`,
      })
    }
    return json({ ok: true, status: "committed", confirmed: true, uri })
  }
  if (req.method === "DELETE") {
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) return json({ error: "invalid json" }, 400)
    const name = String(body.name ?? "").trim()
    const nameError = skillNameError(name)
    if (nameError) return json({ error: nameError }, 400)
    const skills = await makeClient()
    // A pending-only skill exists only in the control plane; drop that
    // row too or the delete would resurrect it on the next sync (#135).
    db.deletePendingSkill(user.id, name)
    await skills.remove(name)
    // The skill is gone: its directory membership would dangle.
    db.removeCatalogDirItems(user.id, "skill", [name])
    await writeVikingSkillFile(user.id, name, null).catch(() => {})
    hub.emit(user.id, { type: "catalog.changed" })
    return json({ ok: true })
  }
  return json({ error: "not found" }, 404)
}

export type { SkillDetail }
