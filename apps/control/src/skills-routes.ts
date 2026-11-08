import type { Db, User } from "@open-bot/db"
import type { EventHub } from "./events"
import { httpErrorResponse } from "./http-error"
import { pluginOwnership, pluginSkillGroups } from "./plugin-ownership"
import { seedSkillDescriptions } from "./personas"
import {
  assertSkillInput,
  createVikingSkills,
  skillNameError,
  type SkillDetail,
} from "./viking-skills"

export type VikingSkills = ReturnType<typeof createVikingSkills>

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function isSkillsRequest(pathname: string): boolean {
  return pathname === "/api/skills"
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
    if (name) return json(await skills.get(name))
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
    return json({
      skills: [
        ...listed.map((skill) => {
          const plugin = ownership.skillByName.get(skill.name)
          const group = groups.get(skill.name) ?? null
          return {
            ...skill,
            group,
            seed: false,
            plugin: plugin ?? undefined,
          }
        }),
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
    const saved = await skills.save(input, previousName)
    if (previousName && previousName !== input.name) {
      db.setCatalogDirItem(user.id, "skill", input.name, carriedDir)
      db.removeCatalogDirItems(user.id, "skill", [previousName])
    }
    // An open Skills tab never sees agent/CLI writes otherwise — the tab
    // refreshes everything on catalog.changed, not just its directories.
    hub.emit(user.id, { type: "catalog.changed" })
    // confirmed !== false keeps older client shapes (and fakes) truthful;
    // an unconfirmed save is still durable — the read-back lagged, that's
    // all. Reporting it as success-with-note stops the blind retries that
    // the 502 used to trigger.
    if (saved?.confirmed === false) {
      return json({
        ok: true,
        confirmed: false,
        note: `${input.name} is written; OpenViking is still indexing it — a get may 404 for a few seconds. Do not retry the save (it already landed).`,
      })
    }
    return json({ ok: true, confirmed: true })
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
    await skills.remove(name)
    // The skill is gone: its directory membership would dangle.
    db.removeCatalogDirItems(user.id, "skill", [name])
    hub.emit(user.id, { type: "catalog.changed" })
    return json({ ok: true })
  }
  return json({ error: "not found" }, 404)
}

export type { SkillDetail }
