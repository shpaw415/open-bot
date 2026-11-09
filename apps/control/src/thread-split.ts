import type { Db } from "@open-bot/db"
import { CRON_TITLE_PREFIX, WORKER_TITLE_PREFIX } from "./threads"

// Split a dashboard thread at one message: the new thread ends at the
// selected message (included) and carries every older message; the source
// thread is untouched. The copy itself is opencode's fork
// (`POST /session/:id/fork`). Fork semantics probed against opencode
// 1.19.5 (the desktop image's version): `messageID` is EXCLUSIVE — the
// fork holds the messages strictly before it — and omitting it copies the
// whole thread. So "end at M" forks at the raw message right after M, or
// with no boundary when M is the thread's last raw message. Forked
// sessions are top-level with fresh message ids and the title
// "<source title> (fork #N)".

export type SplitBoundary =
  | { forkMessageId: string | null; copied: number }
  | "missing"
  | "unreadable"

function messageIdOf(raw: unknown): string {
  if (raw == null || typeof raw !== "object") return ""
  const info = (raw as { info?: { id?: unknown } }).info
  return typeof info?.id === "string" ? info.id : ""
}

/**
 * Resolve the fork boundary that makes `messageId` the new thread's last
 * message: fork at the following raw message, or no boundary (full copy)
 * when it already is the last one. `copied` counts the raw messages the
 * new thread will hold.
 */
export function splitForkBoundary(
  messages: unknown[],
  messageId: string,
): SplitBoundary {
  const index = messages.findIndex((item) => messageIdOf(item) === messageId)
  if (index < 0) return "missing"
  const next = messages[index + 1]
  if (next === undefined) return { forkMessageId: null, copied: index + 1 }
  const forkMessageId = messageIdOf(next)
  if (!forkMessageId) return "unreadable"
  return { forkMessageId, copied: index + 1 }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const UPSTREAM_TIMEOUT_MS = 30_000

async function opencodeFetch(
  base: string,
  headers: HeadersInit,
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const merged = new Headers(headers)
  if (init?.body !== undefined && !merged.has("content-type"))
    merged.set("content-type", "application/json")
  return fetch(new URL(path, base), {
    ...init,
    headers: merged,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch(() => null)
}

export async function splitThread(opts: {
  db: Db
  userId: string
  base: string
  headers: HeadersInit
  sessionId: string
  body: Record<string, unknown>
}): Promise<Response> {
  const { db, userId, base, headers, sessionId, body } = opts
  const rawId = body.messageId ?? body.messageID
  const messageId = typeof rawId === "string" ? rawId.trim() : ""
  if (!messageId) return json({ error: "messageId is required" }, 400)
  if (!sessionId) return json({ error: "thread not found" }, 404)

  const sessionRes = await opencodeFetch(
    base,
    headers,
    `/session/${encodeURIComponent(sessionId)}`,
  )
  if (sessionRes?.status === 404)
    return json({ error: "thread not found", code: "thread_not_found" }, 404)
  if (!sessionRes?.ok)
    return json({ error: "thread lookup failed", code: "upstream" }, 502)
  const session = (await sessionRes.json().catch(() => null)) as {
    id?: unknown
    title?: unknown
    parentID?: unknown
  } | null
  if (!session || typeof session.id !== "string")
    return json({ error: "thread lookup failed", code: "upstream" }, 502)
  if (session.parentID)
    return json(
      {
        error: "only a top-level thread can be split",
        code: "not_top_level",
      },
      400,
    )
  const title = typeof session.title === "string" ? session.title : ""
  if (
    title.startsWith(WORKER_TITLE_PREFIX) ||
    title.startsWith(CRON_TITLE_PREFIX)
  )
    return json(
      { error: "a hidden thread cannot be split", code: "hidden_thread" },
      400,
    )

  // A running turn keeps appending raw messages, so the boundary (and a
  // fork of the live tail) could shift under the copy. Refuse while busy;
  // an unreadable status fails closed for the same reason.
  const statusRes = await opencodeFetch(base, headers, "/session/status")
  if (!statusRes?.ok)
    return json({ error: "thread status failed", code: "upstream" }, 502)
  const statuses = (await statusRes.json().catch(() => null)) as Record<
    string,
    { type?: unknown }
  > | null
  const state = statuses?.[sessionId]?.type
  if (typeof state === "string" && state !== "idle")
    return json(
      {
        error:
          "the thread is still working — wait for it to finish or stop it, then split",
        code: "thread_busy",
      },
      409,
    )

  const listRes = await opencodeFetch(
    base,
    headers,
    `/session/${encodeURIComponent(sessionId)}/message`,
  )
  if (!listRes?.ok)
    return json({ error: "message list failed", code: "upstream" }, 502)
  const messages: unknown = await listRes.json().catch(() => null)
  if (!Array.isArray(messages))
    return json({ error: "message list failed", code: "upstream" }, 502)
  const boundary = splitForkBoundary(messages, messageId)
  if (boundary === "missing")
    return json(
      { error: "message not found in this thread", code: "message_not_found" },
      400,
    )
  if (boundary === "unreadable")
    return json({ error: "message list failed", code: "upstream" }, 502)

  const forkRes = await opencodeFetch(
    base,
    headers,
    `/session/${encodeURIComponent(sessionId)}/fork`,
    {
      method: "POST",
      body: JSON.stringify(
        boundary.forkMessageId ? { messageID: boundary.forkMessageId } : {},
      ),
    },
  )
  if (!forkRes?.ok)
    return json(
      {
        error: `thread fork failed (${forkRes?.status ?? "network"})`,
        code: "fork_failed",
      },
      502,
    )
  const forked = (await forkRes.json().catch(() => null)) as {
    id?: unknown
    title?: unknown
  } | null
  if (!forked || typeof forked.id !== "string" || !forked.id)
    return json({ error: "thread fork failed", code: "fork_failed" }, 502)
  const newId = forked.id

  // The branch continues the same conversation, so it inherits the
  // source thread's control-plane bindings: persona (its scope re-applies
  // on the next dashboard prompt), model/effort pick, and folder. Best
  // effort — the fork already exists, so a binding failure must not turn
  // the split into an error that strands it.
  try {
    const persona = db.threadPersona(userId, sessionId)
    if (persona) db.setThreadPersona(userId, newId, persona.personaId)
    const model = db.threadModel(userId, sessionId)
    if (model)
      db.setThreadModel({
        userId,
        sessionId: newId,
        providerId: model.providerId,
        modelId: model.modelId,
        effort: model.effort,
      })
    const assignment = db
      .threadDirAssignments(userId)
      .find((row) => row.sessionId === sessionId)
    if (assignment) db.setThreadDir(userId, newId, assignment.dirId)
  } catch {
    // bindings re-derive on later prompts; never fail the split for them
  }

  return json(
    {
      id: newId,
      title: typeof forked.title === "string" ? forked.title : title,
      sourceId: sessionId,
      messageId,
      copiedMessages: boundary.copied,
    },
    201,
  )
}
