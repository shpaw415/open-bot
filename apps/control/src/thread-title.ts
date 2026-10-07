import type { Db } from "@open-bot/db"

export function isStockTitle(title: string) {
  const trimmed = title.trim()
  return trimmed === "" || /^New session\b/i.test(trimmed)
}

export function titleFromPrompt(text: string) {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return ""
  const compact = line.replace(/\s+/g, " ")
  return compact.length > 80 ? `${compact.slice(0, 79).trimEnd()}…` : compact
}

export function promptText(body: Record<string, unknown>) {
  const parts = body.parts
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const text = (part as { text?: unknown }).text
      return typeof text === "string" ? text.trim() : ""
    })
    .filter(Boolean)
    .join("\n")
}

export const titleGuardDelays = [20_000, 60_000, 180_000]

export const TITLE_RUN_TITLE = "ob-naming-run"

const TITLE_RUN_AGENT = "namer"

export function sanitizeLlmTitle(raw: string) {
  const line = raw
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !/^`+$/.test(item))
  if (!line) return ""
  const cleaned = line
    .replace(/^#+\s*/, "")
    .replace(/^(?:title|titre)\s*[:\-–—]\s*/i, "")
    .replace(/^["'`“”‘’*([]+/, "")
    .replace(/["'`“”‘’*)\]]+$/, "")
    .replace(/[.。!！?？:；]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return ""
  return cleaned.length > 80 ? `${cleaned.slice(0, 79).trimEnd()}…` : cleaned
}

export function nameMessage(text: string) {
  const clipped = text.length > 400 ? `${text.slice(0, 400)}…` : text
  return [
    "A conversation starts with the message below.",
    "Reply with only a short title for that conversation: two to six words in the message's language, plain text, no quotes, no prefix, no trailing punctuation, nothing else.",
    "Do not answer the message. Do not explain.",
    "",
    clipped,
  ].join("\n")
}

async function fetchSessionTitle(
  base: string,
  auth: HeadersInit,
  sessionId: string,
) {
  const res = await fetch(`${base}/session/${encodeURIComponent(sessionId)}`, {
    headers: auth,
    signal: AbortSignal.timeout(2000),
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as {
    title?: unknown
  } | null
  return typeof body?.title === "string" ? body.title : null
}

async function patchSessionTitle(
  base: string,
  auth: HeadersInit,
  sessionId: string,
  title: string,
) {
  const res = await fetch(`${base}/session/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { ...new Headers(auth), "content-type": "application/json" },
    body: JSON.stringify({ title }),
    signal: AbortSignal.timeout(2000),
  })
  return res.ok
}

async function deleteTitleRunSessions(base: string, auth: HeadersInit) {
  try {
    const res = await fetch(`${base}/session`, {
      headers: auth,
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return
    const body = (await res.json().catch(() => null)) as unknown
    if (!Array.isArray(body)) return
    for (const item of body) {
      if (!item || typeof item !== "object") continue
      const row = item as { id?: unknown; title?: unknown }
      if (row.title !== TITLE_RUN_TITLE || typeof row.id !== "string") continue
      await fetch(`${base}/session/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: auth,
        signal: AbortSignal.timeout(2000),
      }).catch(() => null)
    }
  } catch {
    // cleanup is best effort
  }
}

async function createTitleRunSession(base: string, auth: HeadersInit) {
  const res = await fetch(`${base}/session`, {
    method: "POST",
    headers: { ...new Headers(auth), "content-type": "application/json" },
    body: JSON.stringify({ title: TITLE_RUN_TITLE }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null
  return typeof body?.id === "string" ? body.id : null
}

async function assistantRunTitle(
  base: string,
  auth: HeadersInit,
  sessionId: string,
) {
  const res = await fetch(
    `${base}/session/${encodeURIComponent(sessionId)}/message`,
    { headers: auth, signal: AbortSignal.timeout(3000) },
  )
  if (!res.ok) return ""
  const body = (await res.json().catch(() => null)) as
    | {
        info?: { role?: unknown }
        parts?: { type?: unknown; text?: unknown }[]
      }[]
    | null
  if (!Array.isArray(body)) return ""
  const texts = body
    .filter((item) => item?.info?.role === "assistant")
    .flatMap((item) => item.parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
  return texts.join("\n").trim()
}

async function pollRunTitle(
  base: string,
  auth: HeadersInit,
  sessionId: string,
  deadlineMs: number,
  pollMs: number,
) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const text = await assistantRunTitle(base, auth, sessionId)
    if (text) return text
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return ""
}

export async function claimThreadTitle(
  base: string,
  auth: HeadersInit,
  db: Db,
  userId: string,
  sessionId: string,
  text: string,
): Promise<boolean> {
  const title = titleFromPrompt(text)
  if (!title || db.threadTitle(userId, sessionId)) return false
  try {
    const current = await fetchSessionTitle(base, auth, sessionId)
    if (current === null || !isStockTitle(current)) return false
    if (!(await patchSessionTitle(base, auth, sessionId, title))) return false
    if (db.threadTitle(userId, sessionId)) return false
    db.setThreadTitle({
      userId,
      sessionId,
      title,
      author: "ob",
      createdAt: Date.now(),
    })
    scheduleTitleGuard(base, auth, db, userId, sessionId)
    return true
  } catch {
    // the prompt is already accepted; a stock title can be renamed later
    return false
  }
}

export async function refineThreadTitle(
  base: string,
  auth: HeadersInit,
  db: Db,
  userId: string,
  sessionId: string,
  text: string,
  opts: { deadlineMs?: number; pollMs?: number } = {},
) {
  const row = db.threadTitle(userId, sessionId)
  if (!row || row.author !== "ob") return
  try {
    const runId = await createTitleRunSession(base, auth)
    if (!runId) return
    try {
      const posted = await fetch(
        `${base}/session/${encodeURIComponent(runId)}/prompt_async`,
        {
          method: "POST",
          headers: { ...new Headers(auth), "content-type": "application/json" },
          body: JSON.stringify({
            agent: TITLE_RUN_AGENT,
            parts: [{ type: "text", text: nameMessage(text) }],
          }),
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!posted.ok) return
      const raw = await pollRunTitle(
        base,
        auth,
        runId,
        opts.deadlineMs ?? 40_000,
        opts.pollMs ?? 1_500,
      )
      const title = sanitizeLlmTitle(raw)
      if (!title) return
      if (db.threadTitle(userId, sessionId)?.author !== "ob") return
      if (!(await patchSessionTitle(base, auth, sessionId, title))) return
      db.setThreadTitle({
        userId,
        sessionId,
        title,
        author: "ob",
        createdAt: Date.now(),
      })
    } finally {
      await fetch(`${base}/session/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        headers: auth,
        signal: AbortSignal.timeout(2000),
      }).catch(() => null)
    }
  } catch {
    // naming is best effort; the claimed title stands
  } finally {
    await deleteTitleRunSessions(base, auth)
  }
}

export function scheduleTitleGuard(
  base: string,
  auth: HeadersInit,
  db: Db,
  userId: string,
  sessionId: string,
) {
  for (const delay of titleGuardDelays) {
    const timer = setTimeout(() => {
      void guardThreadTitle(base, auth, db, userId, sessionId)
    }, delay)
    timer.unref?.()
  }
}

export async function guardThreadTitle(
  base: string,
  auth: HeadersInit,
  db: Db,
  userId: string,
  sessionId: string,
) {
  try {
    const row = db.threadTitle(userId, sessionId)
    if (!row || row.author !== "ob") return
    const current = await fetchSessionTitle(base, auth, sessionId)
    if (current === null || current === row.title) return
    await patchSessionTitle(base, auth, sessionId, row.title)
  } catch {
    // best effort; the title guard never blocks the prompt
  }
}
