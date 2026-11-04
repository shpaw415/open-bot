// Cursor paging for the dashboard message-list route. A long thread can
// hold thousands of opencode messages; shipping the whole list on every
// open (and every reconciliation tick) makes the browser tab parse, hold,
// and render all of it. With `?limit=N` the route returns only the newest
// N messages, and `?before=<messageId>&limit=N` returns the N messages
// right before that id, so older history loads on scroll. No paging
// params means the legacy full-array response every other caller
// (`ob-thread read`, older dashboards) still expects. The upstream
// opencode call still returns the full list — its API has no paging —
// so the saving is on the control→browser hop, which is where the
// memory pressure is.
export const MESSAGE_PAGE_DEFAULT_LIMIT = 100
export const MESSAGE_PAGE_MAX_LIMIT = 1000

export type MessagePageQuery = { limit: number; before: string | null }

/** Null when the request carries no paging params (legacy full list). */
export function parseMessagePageQuery(
  search: URLSearchParams,
): MessagePageQuery | null {
  if (!search.has("limit") && !search.has("before")) return null
  const raw = Number(search.get("limit"))
  const limit =
    Number.isFinite(raw) && raw >= 1
      ? Math.min(Math.floor(raw), MESSAGE_PAGE_MAX_LIMIT)
      : MESSAGE_PAGE_DEFAULT_LIMIT
  const beforeRaw = search.get("before")
  const before = beforeRaw?.trim() ? beforeRaw : null
  return { limit, before }
}

export type MessagePage = {
  messages: unknown[]
  total: number
  hasMore: boolean
  /** Oldest returned message id; pass it as `before` for the next page. */
  nextBefore: string | null
  /** User-role messages before the first returned one. The dashboard's
   * send receipts count user messages absolutely, so a windowed
   * transcript needs the count it skipped to keep matching. */
  startUserCount: number
}

function messageId(message: unknown): string | null {
  if (!message || typeof message !== "object") return null
  const info = (message as { info?: unknown }).info
  if (!info || typeof info !== "object") return null
  const id = (info as { id?: unknown }).id
  return typeof id === "string" && id ? id : null
}

function isUserMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false
  const info = (message as { info?: unknown }).info
  if (!info || typeof info !== "object") return false
  return (info as { role?: unknown }).role === "user"
}

/**
 * Slice one page out of the full list. Returns null when `before` names
 * a message the list no longer has (deleted since the cursor was
 * issued) — the caller answers 400 and the client reopens the thread
 * window instead of silently skipping history.
 */
export function pageMessages(
  messages: unknown[],
  query: MessagePageQuery,
): MessagePage | null {
  const total = messages.length
  let end = total
  if (query.before) {
    end = messages.findIndex((message) => messageId(message) === query.before)
    if (end === -1) return null
  }
  const start = Math.max(0, end - query.limit)
  const slice = messages.slice(start, end)
  let startUserCount = 0
  for (let i = 0; i < start; i++) {
    if (isUserMessage(messages[i])) startUserCount++
  }
  const firstId = slice.length > 0 ? messageId(slice[0]) : null
  // Without an id on the oldest returned message there is no cursor to
  // page from; report no older page rather than a dead cursor.
  const hasMore = start > 0 && firstId !== null
  return {
    messages: slice,
    total,
    hasMore,
    nextBefore: hasMore ? firstId : null,
    startUserCount,
  }
}
