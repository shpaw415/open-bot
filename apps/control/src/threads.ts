import type { Db, User } from "@open-bot/db"
import { createSession } from "./cron"
import { desktopPhase, endpoint } from "./docker"

// Hidden threads reuse the worker: title prefix. The dashboard thread list and
// the media vault already skip worker:/cron-run: titled sessions, so a hidden
// thread never appears there and never files media.
export const WORKER_TITLE_PREFIX = "worker:"
const CRON_TITLE_PREFIX = "cron-run:"
const TITLE_LIMIT = 80
const MESSAGE_LIMIT = 8000
const PROMPT_TIMEOUT_MS = 30_000

export function isThreadRequest(pathname: string, method: string): boolean {
  return pathname === "/api/threads" && (method === "GET" || method === "POST")
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
  return json({ error: "not found" }, 404)
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
  if (body.message !== undefined && typeof body.message !== "string")
    return json({ error: "message must be a string" }, 400)
  const message = body.message ?? ""
  if (message.length > MESSAGE_LIMIT)
    return json(
      { error: `message is limited to ${MESSAGE_LIMIT} characters` },
      400,
    )

  const resolved = await opencodeBase(db, agent)
  if ("error" in resolved) return resolved.error
  const { base, headers } = resolved

  const effectiveTitle = display ? title : hiddenThreadTitle(title)
  let sessionId: string
  try {
    sessionId = await createSession(base, headers, effectiveTitle)
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "session create failed",
      },
      502,
    )
  }
  let warning: string | null = null
  if (message) {
    const posted = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}/prompt_async`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ parts: [{ type: "text", text: message }] }),
        signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
      },
    ).catch(() => null)
    if (!posted || !posted.ok)
      warning = "thread created but the first message failed to post"
  }
  return json(
    warning
      ? { id: sessionId, title: effectiveTitle, display, warning }
      : { id: sessionId, title: effectiveTitle, display },
    201,
  )
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
