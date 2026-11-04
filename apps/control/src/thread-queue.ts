import type { Db, ThreadQueueItem, User } from "@open-bot/db"
import { eventSessionId, lastTurnEnd, type TurnEnd } from "./delegations"
import { desktopPhase, endpoint } from "./docker"
import { basicOpencodeAuth } from "./effort"
import type { EventHub } from "./events"
import { sendDashboardPrompt } from "./prompt-send"

// The persisted waiting list behind a running turn (T3-style queued
// runs). The dashboard used to hold this queue in browser state and
// flush it itself on idle; it now lives in the control-plane DB
// (thread_queue) so it survives reloads and closed browsers, and the
// flush rides the same session.idle pump as delegation wakes. A flush
// sends through sendDashboardPrompt, so a queued message is stamped
// (persona, screen, references, thread model) exactly like a direct
// send — with the model pick current at flush time, as the old
// client-side flush behaved.

export const MAX_QUEUED_MESSAGES = 10
export const QUEUE_TEXT_LIMIT = 200_000
const QUEUE_FILES_LIMIT = 5
const QUEUE_FILE_URL_LIMIT = 6_000_000

export type QueuedFile = {
  id: string
  name: string
  mime: string
  url: string
}

export type QueueSubmission = { text: string; files: QueuedFile[] }

export type ThreadQueueView = {
  id: string
  sessionId: string
  text: string
  files: QueuedFile[]
  createdAt: number
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function isThreadQueuePath(pathname: string): boolean {
  return (
    pathname === "/api/thread-queue" ||
    pathname.startsWith("/api/thread-queue/")
  )
}

function parseQueuedFile(raw: unknown, index: number): QueuedFile | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === "string" ? row.name.trim() : ""
  const mime = typeof row.mime === "string" ? row.mime.trim() : ""
  const url = typeof row.url === "string" ? row.url : ""
  if (
    !name ||
    !mime ||
    !url.startsWith("data:") ||
    url.length > QUEUE_FILE_URL_LIMIT
  )
    return null
  const id =
    typeof row.id === "string" && row.id.trim() && row.id.length <= 64
      ? row.id
      : `qfile-${index}`
  return { id, name: name.slice(0, 255), mime: mime.slice(0, 128), url }
}

export function parseQueueSubmission(
  body: unknown,
): QueueSubmission | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "body must be an object" }
  const row = body as Record<string, unknown>
  if (row.text !== undefined && typeof row.text !== "string")
    return { error: "text must be a string" }
  const text = typeof row.text === "string" ? row.text : ""
  if (text.length > QUEUE_TEXT_LIMIT)
    return { error: `text is limited to ${QUEUE_TEXT_LIMIT} characters` }
  if (row.files !== undefined && !Array.isArray(row.files))
    return { error: "files must be an array" }
  const rawFiles = Array.isArray(row.files) ? row.files : []
  if (rawFiles.length > QUEUE_FILES_LIMIT)
    return { error: `at most ${QUEUE_FILES_LIMIT} files can be queued` }
  const files: QueuedFile[] = []
  for (let i = 0; i < rawFiles.length; i++) {
    const file = parseQueuedFile(rawFiles[i], i)
    if (!file) return { error: "a queued file is malformed or too large" }
    files.push(file)
  }
  if (!text.trim() && files.length === 0)
    return { error: "a queued message needs text or a file" }
  return { text, files }
}

/** Same double-Enter guard the client queue had: identical tail text, no files either side. */
export function isTailDuplicate(
  items: readonly { text: string; files: readonly unknown[] }[],
  next: { text: string; files: readonly unknown[] },
): boolean {
  const last = items[items.length - 1]
  return Boolean(
    last &&
      last.text.trim() === next.text.trim() &&
      last.files.length === 0 &&
      next.files.length === 0,
  )
}

export function queueFilesOf(row: ThreadQueueItem): QueuedFile[] {
  try {
    const parsed: unknown = JSON.parse(row.files)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((file, index) => {
      const valid = parseQueuedFile(file, index)
      return valid ? [valid] : []
    })
  } catch {
    return []
  }
}

export function queueView(row: ThreadQueueItem): ThreadQueueView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    text: row.text,
    files: queueFilesOf(row),
    createdAt: row.createdAt,
  }
}

/** Mirrors the web composer's promptParts: file parts first, then the text. */
export function queuedPromptParts(text: string, files: QueuedFile[]) {
  const parts: {
    type: string
    text?: string
    mime?: string
    filename?: string
    url?: string
  }[] = []
  for (const file of files) {
    parts.push({
      type: "file",
      mime: file.mime,
      filename: file.name,
      url: file.url,
    })
  }
  const trimmed = text.trim()
  if (trimmed) parts.push({ type: "text", text: trimmed })
  return parts
}

/**
 * When the head of a queue may become the next turn. Busy (or an
 * unreadable status — fail closed, like the screen evictor) never
 * flushes. An errored last turn holds the queue: the dashboard's
 * dead-turn banner/resume flow owns that window, exactly as the old
 * client flush behaved; an explicit send-now (force) steps over it.
 */
export function queueFlushAllowed(input: {
  busy: boolean | null
  end: TurnEnd | null
  force?: boolean
}): boolean {
  if (input.busy !== false) return false
  if (!input.force && input.end?.state === "error") return false
  return true
}

const flushing = new Set<string>()

async function fetchJson(
  base: string,
  headers: Record<string, string>,
  path: string,
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok) return null
  return res.json().catch(() => null)
}

async function opencodeContext(
  db: Db,
  userId: string,
): Promise<{
  base: string
  headers: Record<string, string>
  password: string
} | null> {
  if ((await desktopPhase(userId)) !== "running") return null
  const desktop = db.desktop(userId)
  if (!desktop) return null
  try {
    return {
      base: await endpoint(userId, "opencode", 4096),
      headers: basicOpencodeAuth(desktop.opencodePassword),
      password: desktop.opencodePassword,
    }
  } catch {
    return null
  }
}

/** True = busy, false = idle, null = unreadable (treated as busy). */
async function sessionBusy(
  ctx: { base: string; headers: Record<string, string> },
  sessionId: string,
): Promise<boolean | null> {
  const status = await fetchJson(ctx.base, ctx.headers, "/session/status")
  if (!status || typeof status !== "object") return null
  const row = (status as Record<string, { type?: unknown }>)[sessionId]
  if (!row) return false
  return row.type !== "idle"
}

/**
 * Sends the head of a session's queue as the next turn when the gate
 * allows it. One message per call — its own turn ending fires the next
 * session.idle, which flushes the next head. The row is deleted only
 * after opencode accepts the prompt; a failed send leaves the queue
 * intact for the next idle (or an explicit send-now). Returns true
 * when a message was sent.
 */
export async function flushThreadQueue(
  db: Db,
  hub: EventHub,
  userId: string,
  sessionId: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const key = `${userId}:${sessionId}`
  if (flushing.has(key)) return false
  const head = db.threadQueue(userId, sessionId)[0]
  if (!head) return false
  const user = db.userById(userId)
  if (!user) return false
  flushing.add(key)
  try {
    const ctx = await opencodeContext(db, userId)
    if (!ctx) return false
    const busy = await sessionBusy(ctx, sessionId)
    const end =
      busy === false
        ? lastTurnEnd(
            await fetchJson(
              ctx.base,
              ctx.headers,
              `/session/${encodeURIComponent(sessionId)}/message`,
            ),
          )
        : null
    if (!queueFlushAllowed({ busy, end, force: opts.force })) return false
    // Re-read under the lock: an edit/remove may have landed meanwhile.
    const current = db.threadQueueItem(userId, head.id)
    if (!current || current.sessionId !== sessionId) return false
    const sent = await sendDashboardPrompt(
      db,
      user,
      ctx.password,
      ctx.base,
      sessionId,
      { parts: queuedPromptParts(current.text, queueFilesOf(current)) },
    )
    if (!sent) return false
    db.deleteThreadQueueItem(userId, current.id)
    hub.emit(userId, {
      type: "queue.changed",
      properties: { sessionId },
    })
    return true
  } finally {
    flushing.delete(key)
  }
}

/**
 * Wake-time flush: a queue left behind while the desktop slept has no
 * session.idle coming (no turn is running), so every queued session
 * gets one flush attempt when its desktop becomes ready.
 */
export function flushThreadQueuesForUser(
  db: Db,
  hub: EventHub,
  userId: string,
): void {
  for (const sessionId of db.threadQueueSessions(userId)) {
    void flushThreadQueue(db, hub, userId, sessionId).catch(() => {})
  }
}

/** SSE-pump observer: a session going idle flushes its queue head. */
export function dispatchThreadQueueFlush(
  db: Db,
  hub: EventHub,
  userId: string,
  event: { type?: unknown; properties?: unknown },
): void {
  if (event.type !== "session.idle") return
  const sessionId = eventSessionId(event)
  if (!sessionId) return
  if (db.threadQueue(userId, sessionId).length === 0) return
  void flushThreadQueue(db, hub, userId, sessionId).catch(() => {})
}

function emitQueueChanged(hub: EventHub, userId: string, sessionId: string) {
  hub.emit(userId, { type: "queue.changed", properties: { sessionId } })
}

export async function handleThreadQueue(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response | null> {
  const sessionMatch = url.pathname.match(/^\/api\/thread-queue\/([^/]+)$/)
  const itemMatch = url.pathname.match(
    /^\/api\/thread-queue\/([^/]+)\/([^/]+)$/,
  )
  const sendNowMatch = url.pathname.match(
    /^\/api\/thread-queue\/([^/]+)\/([^/]+)\/send-now$/,
  )

  if (sessionMatch && req.method === "GET") {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? "")
    return json({
      items: db.threadQueue(user.id, sessionId).map(queueView),
    })
  }

  if (sessionMatch && req.method === "POST") {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? "")
    const parsed = parseQueueSubmission(await req.json().catch(() => null))
    if ("error" in parsed) return json({ error: parsed.error }, 400)
    const existing = db.threadQueue(user.id, sessionId)
    const tail = existing[existing.length - 1]
    if (
      tail &&
      isTailDuplicate(
        existing.map((row) => ({ text: row.text, files: queueFilesOf(row) })),
        parsed,
      )
    ) {
      return json({ item: queueView(tail), duplicate: true })
    }
    if (existing.length >= MAX_QUEUED_MESSAGES)
      return json(
        {
          error: `the queue is full (${MAX_QUEUED_MESSAGES} messages)`,
          code: "queue_full",
        },
        409,
      )
    const row = db.enqueueThreadMessage({
      id: crypto.randomUUID(),
      userId: user.id,
      sessionId,
      text: parsed.text,
      files: JSON.stringify(parsed.files),
      createdAt: Date.now(),
    })
    emitQueueChanged(hub, user.id, sessionId)
    // The turn may have ended between the composer's busy check and
    // this POST landing; an opportunistic flush keeps such a message
    // from waiting for an idle event that already fired.
    void flushThreadQueue(db, hub, user.id, sessionId).catch(() => {})
    return json({ item: queueView(row), duplicate: false }, 201)
  }

  if (itemMatch && req.method === "PATCH") {
    const sessionId = decodeURIComponent(itemMatch[1] ?? "")
    const itemId = decodeURIComponent(itemMatch[2] ?? "")
    const item = db.threadQueueItem(user.id, itemId)
    if (!item || item.sessionId !== sessionId)
      return json({ error: "queued message not found" }, 404)
    const parsed = parseQueueSubmission(await req.json().catch(() => null))
    if ("error" in parsed) return json({ error: parsed.error }, 400)
    const updated = db.updateThreadQueueItem(user.id, itemId, {
      text: parsed.text,
      files: JSON.stringify(parsed.files),
    })
    if (!updated) return json({ error: "queued message not found" }, 404)
    emitQueueChanged(hub, user.id, sessionId)
    return json({ item: queueView(updated) })
  }

  if (itemMatch && req.method === "DELETE") {
    const sessionId = decodeURIComponent(itemMatch[1] ?? "")
    const itemId = decodeURIComponent(itemMatch[2] ?? "")
    const item = db.threadQueueItem(user.id, itemId)
    if (!item || item.sessionId !== sessionId)
      return json({ error: "queued message not found" }, 404)
    db.deleteThreadQueueItem(user.id, itemId)
    emitQueueChanged(hub, user.id, sessionId)
    return json({ ok: true })
  }

  if (sendNowMatch && req.method === "POST") {
    const sessionId = decodeURIComponent(sendNowMatch[1] ?? "")
    const itemId = decodeURIComponent(sendNowMatch[2] ?? "")
    const item = db.threadQueueItem(user.id, itemId)
    if (!item || item.sessionId !== sessionId)
      return json({ error: "queued message not found" }, 404)
    db.promoteThreadQueueItem(user.id, itemId)
    emitQueueChanged(hub, user.id, sessionId)
    const ctx = await opencodeContext(db, user.id)
    if (ctx && (await sessionBusy(ctx, sessionId))) {
      // Interrupt the running turn; its session.idle flushes the
      // promoted head (the old client force-send did exactly this).
      await fetch(
        `${ctx.base}/session/${encodeURIComponent(sessionId)}/abort`,
        {
          method: "POST",
          headers: ctx.headers,
          signal: AbortSignal.timeout(10_000),
        },
      ).catch(() => null)
      return json({ ok: true, sent: false })
    }
    const sent = await flushThreadQueue(db, hub, user.id, sessionId, {
      force: true,
    })
    return json({ ok: true, sent })
  }

  return null
}
