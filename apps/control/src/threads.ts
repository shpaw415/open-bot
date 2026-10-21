import type { Db, User } from "@open-bot/db"
import {
  type CouncilView,
  findOrCreateCouncil,
  sanitizeCouncilName,
  sanitizeRole,
} from "./councils"
import { createSession } from "./cron"
import { recordDelegation, resolveDelegationCreator } from "./delegations"
import { desktopPhase, endpoint } from "./docker"
import { applyThinkingEffort } from "./effort"
import { trimDashboardMessages } from "./messages-trim"
import {
  ASSISTANT_ID,
  findPersona,
  type PersonaMatch,
  personaScope,
  personaSystem,
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
  return (
    method === "POST" && /^\/api\/threads\/[^/]+\/(?:stop|post)$/.test(pathname)
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
  const managed = url.pathname.match(/^\/api\/threads\/([^/]+)\/(stop|post)$/)
  if (managed && req.method === "POST") {
    const id = decodeURIComponent(managed[1] ?? "")
    if (!id) return json({ error: "not found" }, 404)
    return managed[2] === "stop"
      ? stopThread(id, db, agent)
      : postThread(req, id, db, agent)
  }
  const status = url.pathname.match(/^\/api\/threads\/([^/]+)\/status$/)
  if (status && req.method === "GET") {
    const id = decodeURIComponent(status[1] ?? "")
    if (!id) return json({ error: "not found" }, 404)
    return threadStatus(id, db, agent)
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
  return json(trimDashboardMessages(parsed))
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
  if (phase !== "running")
    return { error: json({ error: "desktop is not running" }, 409) }
  try {
    return {
      base: await endpoint(agent.id, "opencode", 4096),
      headers: desktopHeaders(desktop.opencodePassword),
    }
  } catch {
    return { error: json({ error: "desktop is not reachable" }, 502) }
  }
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

  // Delegation wake-up: councils and persona teammates re-prompt the
  // coordinating thread when they finish. The creator is the caller's own
  // session (`from`) or, unprovided, the one busy chat on the desktop.
  const watchesDelegation =
    Boolean(councilName) ||
    Boolean(persona && persona.persona.id !== ASSISTANT_ID)
  const delegation = watchesDelegation
    ? await resolveDelegationCreator(base, headers, fromRaw)
    : { creator: null, warning: null }

  const effectiveTitle = effectiveVisible ? title : hiddenThreadTitle(title)
  const ruleset = await personaScope(agent.id, persona?.persona ?? null)
  let sessionId: string
  try {
    sessionId = await createSession(
      base,
      headers,
      effectiveTitle,
      undefined,
      ruleset,
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
  if (persona && persona.persona.id !== ASSISTANT_ID)
    db.setThreadPersona(agent.id, sessionId, persona.persona.id)
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
    // Same raced ensure the dashboard prompt path runs: agent-started threads
    // (ob-thread start, council members, persona teammates) carry the screen
    // id line from the first prompt, so the browser CLIs work immediately. A
    // failed ensure never fails the thread — the fallback line covers it.
    let timer: ReturnType<typeof setTimeout> | undefined
    const screen = await Promise.race([
      ensureThreadScreen(db, agent.id, sessionId).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 4000)
      }),
    ])
    clearTimeout(timer)
    const promptBody: Record<string, unknown> = {
      parts: [{ type: "text", text: message }],
    }
    const personaLine = personaSystem(persona?.persona ?? null)
    const line = [
      personaLine,
      screen?.system ??
        `This thread's screen id (also your session id, for ob-thread --from) is ${sessionId}. The screen is still starting: run the browser or screen command again in a moment and it will answer. Do not guess a VNC port. Do not call vncdo.`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n\n")
    if (line) promptBody.system = line
    await applyThinkingEffort(db, agent.id, promptBody)
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
    const allowed = persona.persona.skillsEffective
    if (allowed) personaInfo.skills = { allowed: allowed.length }
    const mcpAllowed = persona.persona.mcpEffective
    if (mcpAllowed) personaInfo.mcp = { allowed: mcpAllowed.length }
    result.persona = personaInfo
  }
  if (dir) result.dir = dir
  if (council) result.council = council
  if (watchesDelegation)
    result.wake = {
      armed: Boolean(delegation.creator),
      creator: delegation.creator,
    }
  warning = warning ?? delegation.warning
  if (warning) result.warning = warning
  return json(result, 201)
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
      return { id: row.id, title: row.title }
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

// Reports whether a managed thread is still running a turn. `ob-thread wait`
// polls this to block on a teammate or council member without holding a raw
// sleep loop; the same manageable scope as stop/post applies.
async function threadStatus(id: string, db: Db, agent: User) {
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
    // A session absent from the status map has not registered a turn yet —
    // one session read separates a just-created row (still starting, so
    // `ob-thread wait` must keep polling) from a just-deleted one, which
    // keeps the 404 contract instead of faking a done idle.
    const probe = await fetch(`${base}/session/${encodeURIComponent(id)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!probe || !probe.ok) return json({ error: "session not found" }, 404)
    return json({ id, running: true, state: "starting" })
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
  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved
  const allowed = await manageableThread(id, base, headers, db, agent)
  if (!("session" in allowed)) return allowed
  const promptBody: Record<string, unknown> = {
    parts: [{ type: "text", text: body.message }],
  }
  await applyThinkingEffort(db, agent.id, promptBody)
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
  return json({ id, posted: true })
}
