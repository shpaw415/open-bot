import type { Db, User } from "@open-bot/db"
import {
  type CouncilView,
  findOrCreateCouncil,
  sanitizeCouncilName,
  sanitizeRole,
} from "./councils"
import { createSession, splitModelRef, UNLIMITED_STEPS_AGENT } from "./cron"
import {
  delegationCreatorOf,
  lastTurnEnd,
  recordDelegation,
  resolveDelegationCreator,
} from "./delegations"
import { desktopDeathInfo, desktopPhase, endpoint } from "./docker"
import {
  applyModelChoice,
  resolveThreadModel,
  type ThreadModelChoice,
  type ThreadModelRow,
  threadModelChoice,
  validateModelChoice,
} from "./effort"
import { pageMessages, parseMessagePageQuery } from "./messages-page"
import { trimDashboardMessages } from "./messages-trim"
import {
  ASSISTANT_ID,
  builtinLoadsAllSkills,
  findPersona,
  type PersonaMatch,
  type PersonaView,
  personaScope,
  personaSystem,
  resolvePersona,
} from "./personas"
import { ensureThreadScreen, stopThreadScreen } from "./screens"
import {
  findOrCreateThreadDir,
  sanitizeDirName,
  type ThreadDirView,
} from "./thread-dirs"
import { deleteSessionMedia } from "./workspace-snapshots"

// Hidden threads reuse the worker: title prefix. The dashboard thread list and
// the media vault already skip worker:/cron-run: titled sessions, so a hidden
// thread never appears there and never files media.
export const WORKER_TITLE_PREFIX = "worker:"
const CRON_TITLE_PREFIX = "cron-run:"
const TITLE_LIMIT = 80
const MESSAGE_LIMIT = 8000
const PROMPT_TIMEOUT_MS = 30_000
const DELETE_LIMIT = 100

export function isThreadRequest(pathname: string, method: string): boolean {
  if (
    pathname === "/api/threads" &&
    (method === "GET" || method === "POST" || method === "DELETE")
  )
    return true
  if (method === "GET" && /^\/api\/threads\/[^/]+\/status$/.test(pathname))
    return true
  if (
    (method === "GET" || method === "POST") &&
    /^\/api\/threads\/[^/]+\/model$/.test(pathname)
  )
    return true
  return (
    method === "POST" &&
    /^\/api\/threads\/[^/]+\/(?:stop|post|notify-parent)$/.test(pathname)
  )
}

/** Shape of GET /api/threads/recent rows — the passive home/search summary. */
export type RecentThreadSummary = {
  sessionId: string
  title: string
  createdAt: number
}

/**
 * Drop hidden-prefix titles and cap the list. Same visibility rule as the
 * dashboard thread list: worker:/cron-run: sessions never surface. Exported
 * so the passive endpoint's contract has a test without booting the server.
 */
export function visibleRecentThreads(
  rows: { sessionId: string; title: string; createdAt: number }[],
  limit = 8,
): RecentThreadSummary[] {
  return rows
    .filter(
      (row) =>
        !row.title.startsWith(WORKER_TITLE_PREFIX) &&
        !row.title.startsWith(CRON_TITLE_PREFIX),
    )
    .slice(0, limit)
    .map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      createdAt: row.createdAt,
    }))
}

/**
 * One opencode session row → the passive summary shape, or null when the
 * session must never surface (subagent rows carry parentID; worker:/cron-run:
 * titles are hidden the same way the dashboard thread list hides them).
 * createdAt is the session's real last activity — time.updated, falling back
 * to time.created — so the home list can order by actual recency when the
 * real list was readable, without any DB migration inventing dates.
 */
export function recentRowFromSession(
  item: unknown,
): RecentThreadSummary | null {
  if (item == null || typeof item !== "object" || Array.isArray(item))
    return null
  const row = item as {
    id?: unknown
    title?: unknown
    parentID?: unknown
    time?: { updated?: unknown; created?: unknown }
  }
  if (typeof row.id !== "string" || !row.id) return null
  if (row.parentID) return null
  if (typeof row.title !== "string") return null
  if (
    row.title.startsWith(WORKER_TITLE_PREFIX) ||
    row.title.startsWith(CRON_TITLE_PREFIX)
  )
    return null
  const updated =
    typeof row.time?.updated === "number" && Number.isFinite(row.time.updated)
      ? row.time.updated
      : 0
  const created =
    typeof row.time?.created === "number" && Number.isFinite(row.time.created)
      ? row.time.created
      : 0
  return { sessionId: row.id, title: row.title, createdAt: updated || created }
}

export function sanitizeThreadTitle(raw: unknown): string | null {
  if (raw == null) return ""
  if (typeof raw !== "string") return null
  const stripped = Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 32 || code === 127 ? " " : ch
    })
    .join("")
  return stripped.replace(/\s+/g, " ").trim().slice(0, TITLE_LIMIT)
}

export function threadTitleError(title: string): string | null {
  if (title.startsWith(WORKER_TITLE_PREFIX))
    return "title cannot start with the reserved worker: prefix"
  if (title.startsWith(CRON_TITLE_PREFIX))
    return "title cannot start with the reserved cron-run: prefix"
  return null
}

/**
 * Explicit per-thread model + reasoning effort from a start body:
 * `model: "provider/model"` (or the `{providerID, modelID}` object) and
 * `effort: "high"` (`thinkingEffort` accepted as the same field's other
 * spelling). Null choice = desktop defaults. Shape errors are 400s here;
 * whether the model/effort actually exists on the desktop is
 * validateModelChoice's job once the provider list is readable.
 */
export function parseThreadModelChoice(
  body: Record<string, unknown>,
): { choice: ThreadModelChoice | null } | { error: string } {
  let providerID: string | null = null
  let modelID: string | null = null
  if (body.model !== undefined) {
    if (typeof body.model === "string") {
      if (body.model.trim()) {
        const split = splitModelRef(body.model)
        if ("error" in split) return { error: split.error }
        providerID = split.providerId
        modelID = split.modelId
      }
    } else if (
      body.model &&
      typeof body.model === "object" &&
      !Array.isArray(body.model)
    ) {
      const record = body.model as Record<string, unknown>
      const provider = record.providerID ?? record.providerId
      const model = record.modelID ?? record.modelId
      if (typeof provider !== "string" || typeof model !== "string")
        return { error: "model must be provider/model" }
      const split = splitModelRef(`${provider.trim()}/${model.trim()}`)
      if ("error" in split) return { error: split.error }
      providerID = split.providerId
      modelID = split.modelId
    } else {
      return { error: "model must be provider/model" }
    }
  }
  const effortRaw =
    body.effort !== undefined ? body.effort : body.thinkingEffort
  let effort: string | null = null
  if (effortRaw !== undefined) {
    if (typeof effortRaw !== "string")
      return { error: "effort must be a string" }
    const trimmed = effortRaw.trim()
    if (trimmed) {
      if (/\s/.test(trimmed) || trimmed.length > 40)
        return { error: "effort must be a single level name (e.g. high)" }
      effort = trimmed
    }
  }
  if (!providerID && !effort) return { choice: null }
  return { choice: { providerID, modelID, effort } }
}

/**
 * A hot model update for a live thread (`ob-thread model`, or the flags on
 * `ob-thread post`). Each half is tri-state: absent = keep the stored pick,
 * null (or an empty string) = clear it back to the desktop default, a value
 * = set it. Shape errors are 400s here, like parseThreadModelChoice.
 */
export type ThreadModelUpdate = {
  model?: { providerID: string; modelID: string } | null
  effort?: string | null
}

export function parseThreadModelUpdate(
  body: Record<string, unknown>,
): { update: ThreadModelUpdate } | { error: string } {
  const update: ThreadModelUpdate = {}
  if ("model" in body) {
    const raw = body.model
    if (raw === null || (typeof raw === "string" && !raw.trim())) {
      update.model = null
    } else {
      const parsed = parseThreadModelChoice({ model: raw })
      if ("error" in parsed) return { error: parsed.error }
      if (!parsed.choice?.providerID || !parsed.choice.modelID)
        return { error: "model must be provider/model" }
      update.model = {
        providerID: parsed.choice.providerID,
        modelID: parsed.choice.modelID,
      }
    }
  }
  const effortKey = "effort" in body ? "effort" : "thinkingEffort"
  if (effortKey in body) {
    const raw = body[effortKey]
    if (raw === null || (typeof raw === "string" && !raw.trim())) {
      update.effort = null
    } else {
      const parsed = parseThreadModelChoice({ effort: raw })
      if ("error" in parsed) return { error: parsed.error }
      update.effort = parsed.choice?.effort ?? null
    }
  }
  return { update }
}

/** Stored pick with an update's halves applied — the thread's next pick. */
export function mergeThreadModelUpdate(
  stored: ThreadModelRow | null,
  update: ThreadModelUpdate,
): ThreadModelChoice {
  const current = threadModelChoice(stored)
  return {
    providerID:
      update.model !== undefined
        ? (update.model?.providerID ?? null)
        : (current?.providerID ?? null),
    modelID:
      update.model !== undefined
        ? (update.model?.modelID ?? null)
        : (current?.modelID ?? null),
    effort:
      update.effort !== undefined ? update.effort : (current?.effort ?? null),
  }
}

function persistThreadModel(
  db: Db,
  userId: string,
  sessionId: string,
  choice: ThreadModelChoice,
) {
  if (!choice.providerID && !choice.modelID && !choice.effort) {
    db.clearThreadModel(userId, sessionId)
    return
  }
  db.setThreadModel({
    userId,
    sessionId,
    providerId: choice.providerID,
    modelId: choice.modelID,
    effort: choice.effort,
  })
}

/**
 * Validates a merged pick for a hot update. An explicitly passed effort the
 * model does not offer is refused (same 400 as start, naming the levels);
 * an effort merely carried over from the stored pick that the new model
 * does not offer is dropped and reported — the dashboard picker's rule, so
 * switching models never strands the caller on a stale variant.
 */
async function resolveModelUpdate(
  db: Db,
  userId: string,
  stored: ThreadModelRow | null,
  update: ThreadModelUpdate,
): Promise<
  | { choice: ThreadModelChoice; effortDropped: string | null }
  | { error: string }
> {
  const merged = mergeThreadModelUpdate(stored, update)
  const error = await validateModelChoice(db, userId, merged)
  if (!error) return { choice: merged, effortDropped: null }
  const effortExplicit = update.effort !== undefined && update.effort !== null
  if (!effortExplicit && merged.effort) {
    const dropped: ThreadModelChoice = { ...merged, effort: null }
    if (!(await validateModelChoice(db, userId, dropped)))
      return { choice: dropped, effortDropped: merged.effort }
  }
  return { error }
}

/**
 * One thread's model view for the agent routes: the effective pick (stored
 * halves over the desktop default) plus the explicit per-thread halves, so
 * the caller can tell what is pinned to this thread from what is inherited.
 */
function threadModelView(db: Db, userId: string, sessionId: string) {
  const desktop = db.desktop(userId)
  const resolved = resolveThreadModel(db.threadModel(userId, sessionId), {
    providerID: desktop?.selectedProvider ?? null,
    modelID: desktop?.selectedModel ?? null,
    thinkingEffort: desktop?.thinkingEffort ?? null,
  })
  return {
    id: sessionId,
    model:
      resolved.providerID && resolved.modelID
        ? `${resolved.providerID}/${resolved.modelID}`
        : null,
    effort: resolved.thinkingEffort,
    thread: {
      model:
        resolved.thread?.providerID && resolved.thread.modelID
          ? `${resolved.thread.providerID}/${resolved.thread.modelID}`
          : null,
      effort: resolved.thread?.effort ?? null,
    },
  }
}

export function hiddenThreadTitle(title: string): string {
  return title
    ? `${WORKER_TITLE_PREFIX}${title}`
    : `${WORKER_TITLE_PREFIX}${new Date().toISOString()}`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function desktopHeaders(opencodePassword: string): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`opencode:${opencodePassword}`).toString("base64")}`,
    "content-type": "application/json",
  }
}

export async function handleThreads(
  req: Request,
  url: URL,
  db: Db,
  agent: User,
): Promise<Response> {
  if (url.pathname === "/api/threads" && req.method === "POST")
    return startThread(req, db, agent)
  if (url.pathname === "/api/threads" && req.method === "GET")
    return listThreads(db, agent)
  if (url.pathname === "/api/threads" && req.method === "DELETE")
    return deleteThreads(req, db, agent)
  const managed = url.pathname.match(
    /^\/api\/threads\/([^/]+)\/(stop|post|notify-parent)$/,
  )
  if (managed && req.method === "POST") {
    const id = decodeURIComponent(managed[1] ?? "")
    if (!id) return json({ error: "not found" }, 404)
    if (managed[2] === "stop") return stopThread(id, db, agent)
    if (managed[2] === "notify-parent") return notifyParent(req, id, db, agent)
    return postThread(req, id, db, agent)
  }
  const status = url.pathname.match(/^\/api\/threads\/([^/]+)\/status$/)
  if (status && req.method === "GET") {
    const id = decodeURIComponent(status[1] ?? "")
    if (!id) return json({ error: "not found" }, 404)
    return threadStatus(id, db, agent)
  }
  const model = url.pathname.match(/^\/api\/threads\/([^/]+)\/model$/)
  if (model && (req.method === "GET" || req.method === "POST")) {
    const id = decodeURIComponent(model[1] ?? "")
    if (!id) return json({ error: "not found" }, 404)
    return req.method === "GET"
      ? getThreadModel(id, db, agent)
      : setThreadModelRoute(req, id, db, agent)
  }
  return json({ error: "not found" }, 404)
}

/** The one opencode passthrough the agent's LLM token may use: reading a
 * managed thread's messages for `ob-thread read`. */
export function isOpencodeReadRequest(
  pathname: string,
  method: string,
): boolean {
  return (
    method === "GET" &&
    /^\/api\/opencode\/session\/[^/]+\/message$/.test(pathname)
  )
}

// `ob-thread read` on the agent token: the same manageable scope as
// wait/post/stop, trimmed like the dashboard's message-list route so the
// CLI's jq sees the identical shape across both auth paths.
export async function handleOpencodeRead(
  req: Request,
  url: URL,
  db: Db,
  agent: User,
): Promise<Response> {
  const ref = url.pathname.match(/^\/api\/opencode\/session\/([^/]+)\/message$/)
  if (!ref || req.method !== "GET") return json({ error: "not found" }, 404)
  const id = decodeURIComponent(ref[1] ?? "")
  if (!id) return json({ error: "not found" }, 404)
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const upstream = await fetch(
    `${base}/session/${encodeURIComponent(id)}/message`,
    { headers, signal: AbortSignal.timeout(30_000) },
  ).catch(() => null)
  if (!upstream || !upstream.ok)
    return json({ error: "message list failed" }, 502)
  const parsed: unknown = await upstream.json().catch(() => null)
  if (!Array.isArray(parsed)) return json({ error: "message list failed" }, 502)
  // Same optional paging as the dashboard route (?limit/&before; see
  // messages-page.ts). No params keeps the plain array `ob-thread read`
  // and its jq pipeline are built on.
  const pageQuery = parseMessagePageQuery(url.searchParams)
  if (!pageQuery) return json(trimDashboardMessages(parsed))
  const page = pageMessages(parsed, pageQuery)
  if (!page)
    return json(
      { error: "unknown before cursor", code: "message_cursor_unknown" },
      400,
    )
  return json({ ...page, messages: trimDashboardMessages(page.messages) })
}

// Runs after opencode confirms a session deletion: drops the control-plane
// rows and side effects tied to that thread. Shared by the dashboard's
// cookie route (server.ts) and the agent's DELETE /api/threads.
export async function cleanupDeletedThread(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<void> {
  db.clearThreadPersona(userId, sessionId)
  db.clearThreadModel(userId, sessionId)
  db.clearThreadQueue(userId, sessionId)
  db.clearThreadTitle(userId, sessionId)
  db.clearThreadDir(userId, sessionId)
  db.clearCouncilMember(userId, sessionId)
  db.deleteDelegationWatches(userId, sessionId)
  db.deleteDelegationWatchesByCreator(userId, sessionId)
  deleteSessionMedia(db, userId, sessionId)
  await stopThreadScreen(db, userId, sessionId)
}

type ResolvedOpencode =
  | { error: Response }
  | { base: string; headers: Record<string, string> }

async function opencodeBase(db: Db, agent: User): Promise<ResolvedOpencode> {
  const desktop = db.desktop(agent.id)
  if (!desktop) return { error: json({ error: "desktop not found" }, 409) }
  const phase = await desktopPhase(agent.id)
  if (phase !== "running") {
    // A bare "not running" reads as a control-plane lie when the workspace
    // (bash, files, OpenViking) is clearly alive (#30) — it is the opencode
    // container that is down. When docker gives a definite answer, say why;
    // the error string stays identical for the CLI's transient-retry match.
    const death = await desktopDeathInfo(agent.id).catch(() => null)
    if (death && !death.running)
      return {
        error: json(
          {
            error: "desktop is not running",
            state: "desktop_down",
            desktop: {
              running: false,
              oomKilled: death.oomKilled,
              exitCode: death.exitCode,
            },
          },
          409,
        ),
      }
    return { error: json({ error: "desktop is not running" }, 409) }
  }
  try {
    return {
      base: await endpoint(agent.id, "opencode", 4096),
      headers: desktopHeaders(desktop.opencodePassword),
    }
  } catch {
    return { error: json({ error: "desktop is not reachable" }, 502) }
  }
}

// The system line every agent-thread prompt carries: persona line (when
// bound) + the screen id line, with the raced screen ensure the dashboard
// prompt path runs. Shared by the first prompt (startThread) and every
// ob-thread post follow-up — posts used to carry no system line at all, so
// a council member briefed via post (or created without --message) never
// learned its own screen/session id and could not drive ob-chrome/ob-vnc.
export async function threadPromptSystem(
  db: Db,
  userId: string,
  sessionId: string,
  persona: PersonaView | null,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const screen = await Promise.race([
    ensureThreadScreen(db, userId, sessionId).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 4000)
    }),
  ])
  clearTimeout(timer)
  return [
    personaSystem(persona),
    screen?.system ??
      `This thread's screen id (also your session id, for ob-thread --from) is ${sessionId}. The screen is still starting: run the browser or screen command again in a moment and it will answer. Do not guess a VNC port. Do not call vncdo.`,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
}

async function startThread(req: Request, db: Db, agent: User) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const title = sanitizeThreadTitle(body.title)
  if (title === null) return json({ error: "title must be a string" }, 400)
  const reserved = threadTitleError(title)
  if (reserved) return json({ error: reserved }, 400)
  if (body.display !== undefined && typeof body.display !== "boolean")
    return json({ error: "display must be a boolean" }, 400)
  const display = body.display === true
  if (body.dir !== undefined && typeof body.dir !== "string")
    return json({ error: "dir must be a string" }, 400)
  const dirName =
    typeof body.dir === "string" ? sanitizeDirName(body.dir) || null : null
  if (dirName && body.display === false)
    return json({ error: "dir requires a visible thread" }, 400)
  const visible = display || Boolean(dirName)
  // Council members are always hidden worker: threads — the council viewer is
  // their dashboard surface, so the main thread list stays clean.
  if (body.council !== undefined && typeof body.council !== "string")
    return json({ error: "council must be a string" }, 400)
  const councilRaw = typeof body.council === "string" ? body.council.trim() : ""
  const councilName = sanitizeCouncilName(body.council) ?? ""
  if (councilName === null)
    return json({ error: "council must be a string" }, 400)
  if (councilRaw && !councilName)
    return json({ error: "council name must include letters or digits" }, 400)
  if (councilName && body.display === true)
    return json(
      { error: "council members are hidden; display cannot be combined" },
      400,
    )
  if (councilName && dirName)
    return json({ error: "dir cannot be combined with council" }, 400)
  if (body.role !== undefined && typeof body.role !== "string")
    return json({ error: "role must be a string" }, 400)
  const role = typeof body.role === "string" ? sanitizeRole(body.role) : ""
  if (role === null) return json({ error: "role must be a string" }, 400)
  // steps:"unlimited" binds the session to the no-step-cap agent variant —
  // long council members and background jobs that would outlive the step cap.
  if (body.steps !== undefined && body.steps !== "unlimited")
    return json({ error: 'steps must be "unlimited" or omitted' }, 400)
  const unlimitedSteps = body.steps === "unlimited"
  // Per-thread model/effort pick — one per council member, so a council can
  // mix a cheap researcher with a deep-reasoning reviewer.
  const parsedChoice = parseThreadModelChoice(body)
  if ("error" in parsedChoice) return json({ error: parsedChoice.error }, 400)
  const modelChoice = parsedChoice.choice
  const effectiveVisible = visible && !councilName
  if (body.message !== undefined && typeof body.message !== "string")
    return json({ error: "message must be a string" }, 400)
  const message = body.message ?? ""
  if (message.length > MESSAGE_LIMIT)
    return json(
      { error: `message is limited to ${MESSAGE_LIMIT} characters` },
      400,
    )
  if (body.persona !== undefined && typeof body.persona !== "string")
    return json({ error: "persona must be a string" }, 400)
  const personaQuery =
    typeof body.persona === "string" ? body.persona.trim() : ""
  let persona: PersonaMatch | null = null
  if (personaQuery) {
    const match = findPersona(db, agent.id, personaQuery)
    if (!match.persona)
      return json(
        {
          error: `unknown persona "${personaQuery}"`,
          suggestions: match.suggestions,
        },
        400,
      )
    persona = match
  }
  if (body.from !== undefined && typeof body.from !== "string")
    return json({ error: "from must be a string" }, 400)
  const fromRaw = typeof body.from === "string" ? body.from.trim() : ""

  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved

  // Refuse a provably wrong model/effort before creating anything, so the
  // caller fixes the flag instead of getting a thread whose first prompt
  // can never run. Unverifiable picks (provider list unreadable) pass.
  const modelError = await validateModelChoice(db, agent.id, modelChoice)
  if (modelError) return json({ error: modelError }, 400)

  // Delegation wake-up: councils and persona teammates re-prompt the
  // coordinating thread when they finish. The creator is the caller's own
  // session (`from`) or, unprovided, the one busy chat on the desktop.
  // An explicit --from is an explicit wake request (#77): it arms (and is
  // acknowledged) even for the Assistant, which otherwise skips inference.
  const watchesDelegation =
    Boolean(councilName) ||
    Boolean(persona && persona.persona.id !== ASSISTANT_ID) ||
    Boolean(fromRaw)
  const delegation = watchesDelegation
    ? await resolveDelegationCreator(base, headers, fromRaw)
    : { creator: null, warning: null }

  // Model inheritance: a delegated member with no explicit --model runs the
  // coordinating thread's own pick, not the desktop default. Members used
  // to start on the default provider even when the parent thread ran
  // another — and died idle on that provider's exhausted quota while the
  // parent's provider had room. An inherited pick that no longer validates
  // (provider since disconnected) drops to the default instead of failing
  // the delegation.
  let effectiveChoice: ThreadModelChoice | null = modelChoice
  let modelInherited = false
  if (!effectiveChoice && delegation.creator) {
    const parent = db.threadModel?.(agent.id, delegation.creator) ?? null
    if (parent && (parent.providerId || parent.modelId || parent.effort)) {
      const inherited: ThreadModelChoice = {
        providerID: parent.providerId,
        modelID: parent.modelId,
        effort: parent.effort,
      }
      if (!(await validateModelChoice(db, agent.id, inherited))) {
        effectiveChoice = inherited
        modelInherited = true
      }
    }
  }

  const effectiveTitle = effectiveVisible ? title : hiddenThreadTitle(title)
  // Overlap guard (best effort): two workers with the same title on the same
  // files corrupt each other's edits, and nothing else warns about it. Never
  // blocks — the coordinator decides.
  const overlapWarning = effectiveVisible
    ? null
    : await hiddenStartWarning(base, headers, effectiveTitle)
  const ruleset = await personaScope(db, agent.id, persona?.persona ?? null)
  let sessionId: string
  try {
    sessionId = await createSession(
      base,
      headers,
      effectiveTitle,
      undefined,
      ruleset,
      unlimitedSteps ? UNLIMITED_STEPS_AGENT : null,
    )
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "session create failed",
      },
      502,
    )
  }
  let warning: string | null = null
  let dir: ThreadDirView | null = null
  let council: CouncilView | null = null
  if (dirName) {
    dir = findOrCreateThreadDir(db, agent.id, dirName)
    db.setThreadDir(agent.id, sessionId, dir.id)
  }
  if (councilName) {
    council = findOrCreateCouncil(db, agent.id, councilName)
    db.setCouncilMember({
      councilId: council.id,
      userId: agent.id,
      sessionId,
      role,
      createdAt: Date.now(),
    })
  }
  if (persona) db.setThreadPersona(agent.id, sessionId, persona.persona.id)
  if (effectiveChoice)
    db.setThreadModel({
      userId: agent.id,
      sessionId,
      providerId: effectiveChoice.providerID,
      modelId: effectiveChoice.modelID,
      effort: effectiveChoice.effort,
    })
  if (delegation.creator) {
    recordDelegation(
      db,
      agent.id,
      councilName ? "council" : "persona",
      delegation.creator,
      sessionId,
      council?.id ?? null,
    )
  }
  if (message) {
    const promptBody: Record<string, unknown> = {
      parts: [{ type: "text", text: message }],
    }
    const line = await threadPromptSystem(
      db,
      agent.id,
      sessionId,
      persona?.persona ?? null,
    )
    if (line) promptBody.system = line
    await applyModelChoice(db, agent.id, promptBody, effectiveChoice)
    const posted = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}/prompt_async`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(promptBody),
        signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
      },
    ).catch(() => null)
    if (!posted || !posted.ok)
      warning = "thread created but the first message failed to post"
  }
  const result: Record<string, unknown> = {
    id: sessionId,
    title: effectiveTitle,
    display: effectiveVisible,
  }
  if (persona) {
    const personaInfo: Record<string, unknown> = {
      id: persona.persona.id,
      name: persona.persona.name,
      matched: persona.matched,
    }
    if (persona.persona.builtin) {
      // Built-ins have a live base, not a stored list — report the default
      // plus the user's additions (or a block-all). The Assistant's skill
      // base is every skill; the others keep the seed default.
      personaInfo.skills = persona.persona.skillsNone
        ? { blocked: true }
        : builtinLoadsAllSkills(persona.persona)
          ? { all: true }
          : {
              seedDefault: true,
              extra: (persona.persona.skillsExtra ?? []).length,
            }
      personaInfo.mcp = persona.persona.mcpNone
        ? { blocked: true }
        : { seedDefault: true, extra: (persona.persona.mcpExtra ?? []).length }
    } else {
      const allowed = persona.persona.skillsEffective
      if (allowed)
        personaInfo.skills = {
          allowed: allowed.length,
          blocked: allowed.length === 0,
        }
      const mcpAllowed = persona.persona.mcpEffective
      if (mcpAllowed)
        personaInfo.mcp = {
          allowed: mcpAllowed.length,
          blocked: mcpAllowed.length === 0,
        }
    }
    result.persona = personaInfo
  }
  if (dir) result.dir = dir
  if (council) result.council = council
  if (effectiveChoice?.providerID && effectiveChoice.modelID)
    result.model = `${effectiveChoice.providerID}/${effectiveChoice.modelID}`
  if (effectiveChoice?.effort) result.effort = effectiveChoice.effort
  if (modelInherited) result.modelInherited = true
  if (watchesDelegation)
    result.wake = {
      armed: Boolean(delegation.creator),
      creator: delegation.creator,
    }
  warning = warning ?? delegation.warning
  if (warning) result.warning = warning
  if (overlapWarning)
    result.warning = result.warning
      ? `${result.warning}; ${overlapWarning}`
      : overlapWarning
  return json(result, 201)
}

// One opencode round trip for a hidden start, best effort (null on any
// failure). A same-titled busy worker gets the specific warning; otherwise
// any busy worker threads are named — every worker shares this desktop's
// filesystem, and parallel members writing one tree silently overwrote
// each other often enough that the coordinator should hear who else is
// live before launching more of them.
async function hiddenStartWarning(
  base: string,
  headers: Record<string, string>,
  effectiveTitle: string,
): Promise<string | null> {
  try {
    const [sessionsRes, statusRes] = await Promise.all([
      fetch(`${base}/session`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null),
      fetch(`${base}/session/status`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null),
    ])
    if (!sessionsRes?.ok) return null
    const sessions = (await sessionsRes.json().catch(() => null)) as
      | { id?: unknown; title?: unknown; parentID?: unknown }[]
      | null
    const statusMap = (await statusRes?.json().catch(() => null)) as Record<
      string,
      { type?: unknown } | undefined
    > | null
    if (!Array.isArray(sessions) || !statusMap) return null
    const busy = (item: { id?: unknown }) =>
      typeof item.id === "string" &&
      statusMap[item.id as string]?.type !== undefined &&
      statusMap[item.id as string]?.type !== "idle"
    const match = sessions.find(
      (item) => !item.parentID && item.title === effectiveTitle && busy(item),
    )
    if (match && typeof match.id === "string")
      return `another worker with this title is already running (${match.id}) — parallel briefs on the same files can corrupt each other's edits`
    const others = sessions.filter(
      (item) =>
        !item.parentID &&
        typeof item.title === "string" &&
        item.title.startsWith(WORKER_TITLE_PREFIX) &&
        busy(item),
    )
    if (others.length === 0) return null
    const titles = others
      .slice(0, 4)
      .map((item) => String(item.title).replace(/^worker:/, ""))
      .join(", ")
    const more = others.length > 4 ? ` and ${others.length - 4} more` : ""
    return `${others.length} other worker thread${others.length === 1 ? " is" : "s are"} running on this shared filesystem right now (${titles}${more}) — parallel members must own separate trees/files or their writes can overwrite each other`
  } catch {
    return null
  }
}

async function listThreads(db: Db, agent: User) {
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const res = await fetch(`${base}/session`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res || !res.ok) return json({ error: "session list failed" }, 502)
  const body = (await res.json().catch(() => null)) as unknown
  if (!Array.isArray(body)) return json({ error: "session list failed" }, 502)
  const threads = body
    .filter((item) => {
      const row = item as { title?: unknown; parentID?: unknown }
      return (
        !row.parentID &&
        typeof row?.title === "string" &&
        row.title.startsWith(WORKER_TITLE_PREFIX)
      )
    })
    .map((item) => {
      const row = item as { id?: unknown; title?: unknown }
      const thread: Record<string, unknown> = { id: row.id, title: row.title }
      // Delegated workers can discover their coordinator here (#62).
      if (typeof row.id === "string") {
        const creator = delegationCreatorOf(db, agent.id, row.id)
        if (creator) thread.creatorSessionId = creator
      }
      return thread
    })
  return json({ threads })
}

// Deletes hidden agent threads in bulk. Only top-level worker:-titled
// sessions are deletable — the same set listThreads returns — so the agent
// can never touch the user's visible threads or cron jobs. Everything else
// comes back skipped with a reason.
async function deleteThreads(req: Request, db: Db, agent: User) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const raw = body.ids
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string"))
    return json({ error: "ids must be an array of strings" }, 400)
  const ids = [...new Set(raw as string[])].filter((id) => id.trim())
  if (ids.length === 0) return json({ error: "ids must not be empty" }, 400)
  if (ids.length > DELETE_LIMIT)
    return json({ error: `ids is limited to ${DELETE_LIMIT} per request` }, 400)

  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const res = await fetch(`${base}/session`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res || !res.ok) return json({ error: "session list failed" }, 502)
  const sessions = (await res.json().catch(() => null)) as unknown
  if (!Array.isArray(sessions))
    return json({ error: "session list failed" }, 502)
  const deletable = new Set(
    sessions
      .filter((item) => {
        const row = item as { title?: unknown; parentID?: unknown }
        return (
          !row.parentID &&
          typeof row?.title === "string" &&
          row.title.startsWith(WORKER_TITLE_PREFIX)
        )
      })
      .map((item) => (item as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string"),
  )
  const deleted: string[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const id of ids) {
    if (!deletable.has(id)) {
      skipped.push({ id, reason: "not a hidden agent thread" })
      continue
    }
    const del = await fetch(`${base}/session/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!del || !del.ok) {
      skipped.push({ id, reason: "delete failed" })
      continue
    }
    try {
      await cleanupDeletedThread(db, agent.id, id)
    } catch {
      // The thread is gone; leftover control-plane rows are harmless.
    }
    deleted.push(id)
  }
  return json({ deleted, skipped })
}

// A top-level session the coordinator may manage with stop/post: its own
// hidden worker: threads (the delete set) and persona-bound teammates.
// Plain user chats and cron-run: sessions stay out of reach — visible threads
// remain the user's to close, cron runs belong to the cron system.
async function manageableThread(
  id: string,
  base: string,
  headers: Record<string, string>,
  db: Db,
  agent: User,
): Promise<Response | { session: { id: string } }> {
  const res = await fetch(`${base}/session/${encodeURIComponent(id)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res || !res.ok) return json({ error: "session not found" }, 404)
  const row = (await res.json().catch(() => null)) as {
    id?: unknown
    title?: unknown
    parentID?: unknown
  } | null
  if (!row || typeof row.id !== "string" || row.id !== id || row.parentID)
    return json({ error: "session not found" }, 404)
  const title = typeof row.title === "string" ? row.title : ""
  if (!title.startsWith(WORKER_TITLE_PREFIX) && !db.threadPersona(agent.id, id))
    return json(
      { error: "only worker: or persona-bound threads can be managed" },
      403,
    )
  return { session: { id } }
}

// How long a prompt may sit with no status entry before it counts as never
// started rather than still starting. A queued prompt behind a busy turn
// keeps that turn's busy entry, so absence plus age means nothing is coming
// to run it (a lost prompt_async, an opencode restart mid-admission).
export const STARTING_GRACE_MS = 120_000

// Turn state read off the message list when the status map has no entry:
// a completed newest assistant turn is idle; a newest prompt (or an
// in-flight-shaped assistant row) older than the grace window is stalled;
// anything fresher — or unreadable — stays starting so the create/post race
// keeps `ob-thread wait` polling.
// Newest message timestamp (completed, else created) in a message list —
// when the thread last did anything, for status reporting (#65).
export function lastActivityAt(messages: unknown): number | null {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const time = (
      messages[i] as {
        info?: { time?: { created?: unknown; completed?: unknown } }
      } | null
    )?.info?.time
    if (typeof time?.completed === "number") return time.completed
    if (typeof time?.created === "number") return time.created
  }
  return null
}

export function turnStateFromMessages(
  messages: unknown,
  now = Date.now(),
): "idle" | "stalled" | "starting" {
  if (!Array.isArray(messages)) return "starting"
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = (
      messages[i] as {
        info?: {
          role?: unknown
          finish?: unknown
          error?: unknown
          summary?: unknown
          time?: { created?: unknown; completed?: unknown }
        }
      } | null
    )?.info
    if (!info || (info.role !== "user" && info.role !== "assistant")) continue
    if (info.role === "assistant" && info.summary === true) continue
    const created =
      typeof info.time?.created === "number" ? info.time.created : null
    if (info.role === "assistant") {
      const done =
        (typeof info.finish === "string" && info.finish !== "") ||
        (typeof info.error === "object" && info.error !== null) ||
        typeof info.time?.completed === "number"
      if (done) return "idle"
    }
    return created !== null && now - created > STARTING_GRACE_MS
      ? "stalled"
      : "starting"
  }
  return "starting"
}

// Reports whether a managed thread is still running a turn. `ob-thread wait`
// polls this to block on a teammate or council member without holding a raw
// sleep loop; the same manageable scope as stop/post applies. A dead desktop
// answers a definite `desktop_down` state (with OOM info) instead of a
// neutral error, so a silently OOM-killed council is visible in wait output.
async function threadStatus(id: string, db: Db, agent: User) {
  const phase = await desktopPhase(agent.id)
  if (phase !== "running") {
    const death = await desktopDeathInfo(agent.id)
    if (death && !death.running)
      return json({
        id,
        running: false,
        state: "desktop_down",
        desktop: {
          running: false,
          oomKilled: death.oomKilled,
          exitCode: death.exitCode,
        },
      })
  }
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const res = await fetch(`${base}/session/status`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res || !res.ok) return json({ error: "status failed" }, 502)
  const body = (await res.json().catch(() => null)) as Record<
    string,
    { type?: unknown } | undefined
  > | null
  if (!body || typeof body !== "object")
    return json({ error: "status failed" }, 502)
  const entry = body[id]
  if (!entry) {
    // Absence from the status map is ambiguous: a just-created session has
    // not registered a turn yet, but opencode also drops the entry once a
    // turn ends (and loses the whole map on restart) — reading every absent
    // entry as "starting" stranded finished teammates there forever. One
    // session read keeps the 404 contract for a just-deleted row; the
    // message list then separates finished (idle) and never-started
    // (stalled) threads from a genuinely starting one.
    const probe = await fetch(`${base}/session/${encodeURIComponent(id)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!probe || !probe.ok) return json({ error: "session not found" }, 404)
    const list = await fetch(
      `${base}/session/${encodeURIComponent(id)}/message`,
      { headers, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null)
    const messages = list?.ok ? await list.json().catch(() => null) : null
    const derived = turnStateFromMessages(messages)
    if (derived === "starting")
      return json({ id, running: true, state: "starting" })
    const body: Record<string, unknown> = {
      id,
      running: false,
      state: derived,
    }
    const creator = delegationCreatorOf(db, agent.id, id)
    if (creator) body.creatorSessionId = creator
    // A turn that ended on a provider limit reads as plain idle otherwise,
    // and the coordinator cannot tell finished from quota-stalled (#65).
    const end = lastTurnEnd(messages)
    if (end.state === "error" || end.state === "cut") {
      if (end.detail) body.lastError = end.detail
      body.providerLimit =
        /usage limit|rate.?limit|quota|too many requests|\b429\b/i.test(
          end.detail,
        )
      const activity = lastActivityAt(messages)
      if (activity !== null) body.lastActivityAt = activity
    }
    return json(body)
  }
  const state = typeof entry.type === "string" ? entry.type : "idle"
  return json({ id, running: state !== "idle", state })
}

async function stopThread(id: string, db: Db, agent: User) {
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const abort = await fetch(`${base}/session/${encodeURIComponent(id)}/abort`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!abort || !abort.ok)
    return json({ error: "stop failed" }, abort?.status === 404 ? 404 : 502)
  return json({ id, stopped: true })
}

async function postThread(req: Request, id: string, db: Db, agent: User) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.message !== "string" || !body.message.trim())
    return json({ error: "message is required" }, 400)
  if (body.message.length > MESSAGE_LIMIT)
    return json(
      { error: `message is limited to ${MESSAGE_LIMIT} characters` },
      400,
    )
  // Optional hot model switch riding this turn: the new pick stamps this
  // prompt and persists for later turns. Absent halves keep the stored pick.
  const parsedUpdate = parseThreadModelUpdate(body)
  if ("error" in parsedUpdate) return json({ error: parsedUpdate.error }, 400)
  const update = parsedUpdate.update
  const hasUpdate = update.model !== undefined || update.effort !== undefined
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  // A provably wrong switch refuses the whole post before anything is sent,
  // like start refuses before creating — the caller fixes the flag and
  // retries instead of the message landing on an unintended model.
  const storedRow = db.threadModel(agent.id, id)
  let choice = threadModelChoice(storedRow)
  let effortDropped: string | null = null
  if (hasUpdate) {
    const next = await resolveModelUpdate(db, agent.id, storedRow, update)
    if ("error" in next) return json({ error: next.error }, 400)
    choice = next.choice
    effortDropped = next.effortDropped
  }
  const promptBody: Record<string, unknown> = {
    parts: [{ type: "text", text: body.message }],
  }
  // Posts carry the same persona + screen system line as the first prompt:
  // a member created without --message is briefed through here, and every
  // member needs its screen/session id on each turn to drive the browser.
  const binding = db.threadPersona(agent.id, id)
  let boundPersona: PersonaView | null = null
  try {
    boundPersona = binding
      ? resolvePersona(db, agent.id, binding.personaId)
      : null
  } catch {
    // The persona line is best effort — a resolution failure must not lose
    // the follow-up prompt itself.
    boundPersona = null
  }
  const line = await threadPromptSystem(db, agent.id, id, boundPersona)
  if (line) promptBody.system = line
  // A follow-up into a member keeps the model/effort it was created with —
  // or the switch this post carries, which then becomes the stored pick.
  await applyModelChoice(db, agent.id, promptBody, choice)
  const posted = await fetch(
    `${base}/session/${encodeURIComponent(id)}/prompt_async`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(promptBody),
      signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
    },
  ).catch(() => null)
  if (!posted || !posted.ok) return json({ error: "post failed" }, 502)
  const result: Record<string, unknown> = { id, posted: true }
  if (hasUpdate && choice) {
    // Persist only once the turn carrying the switch actually landed, so a
    // failed post leaves the thread on its previous pick.
    persistThreadModel(db, agent.id, id, choice)
    if (choice.providerID && choice.modelID)
      result.model = `${choice.providerID}/${choice.modelID}`
    if (choice.effort) result.effort = choice.effort
    if (effortDropped) result.effortDropped = effortDropped
  }
  return json(result)
}

// Interim update from a delegated worker to its coordinator (#62): the
// worker names its OWN thread id; the only reachable target is the creator
// recorded on its delegation watch, prompted with the same [teammate]
// convention the completion wake uses. There is no free-form post into a
// user chat here — manageable scope on the worker plus a recorded creator
// are both required.
async function notifyParent(req: Request, id: string, db: Db, agent: User) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.message !== "string" || !body.message.trim())
    return json({ error: "message is required" }, 400)
  if (body.message.length > MESSAGE_LIMIT)
    return json(
      { error: `message is limited to ${MESSAGE_LIMIT} characters` },
      400,
    )
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const creator = delegationCreatorOf(db, agent.id, id)
  if (!creator)
    return json(
      {
        error:
          "no delegating thread recorded for this thread — it was not started as a delegation",
      },
      404,
    )
  const promptBody: Record<string, unknown> = {
    parts: [
      {
        type: "text",
        text: `[teammate update from ${id}] ${body.message}`,
      },
    ],
  }
  const binding = db.threadPersona(agent.id, creator)
  let creatorPersona: PersonaView | null = null
  try {
    creatorPersona = binding
      ? resolvePersona(db, agent.id, binding.personaId)
      : null
  } catch {
    creatorPersona = null
  }
  const line = await threadPromptSystem(db, agent.id, creator, creatorPersona)
  if (line) promptBody.system = line
  await applyModelChoice(
    db,
    agent.id,
    promptBody,
    threadModelChoice(db.threadModel(agent.id, creator)),
  )
  const posted = await fetch(
    `${base}/session/${encodeURIComponent(creator)}/prompt_async`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(promptBody),
      signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
    },
  ).catch(() => null)
  if (!posted || !posted.ok) return json({ error: "notify failed" }, 502)
  return json({ id, parent: creator, notified: true })
}

// Reads a managed thread's current model pick (`ob-thread model ID`).
async function getThreadModel(id: string, db: Db, agent: User) {
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  return json(threadModelView(db, agent.id, id))
}

// Hot-switches a managed thread's model pick without posting
// (`ob-thread model ID --model …`). The model is stamped per prompt, so the
// change takes effect on the thread's next turn — a turn already running
// keeps its model, and nothing restarts or is recreated.
async function setThreadModelRoute(
  req: Request,
  id: string,
  db: Db,
  agent: User,
) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseThreadModelUpdate(body)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  const update = parsed.update
  if (update.model === undefined && update.effort === undefined)
    return json({ error: "model or effort is required" }, 400)
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const next = await resolveModelUpdate(
    db,
    agent.id,
    db.threadModel(agent.id, id),
    update,
  )
  if ("error" in next) return json({ error: next.error }, 400)
  persistThreadModel(db, agent.id, id, next.choice)
  const view: Record<string, unknown> = threadModelView(db, agent.id, id)
  if (next.effortDropped) view.effortDropped = next.effortDropped
  return json(view)
}
