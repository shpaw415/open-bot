import type { ChatMessage } from "./chat-view"
import type { MessagePageMeta } from "./message-page"

// In-memory LRU of recently opened threads. Switching back to a thread (or
// flipping the desktop phase) paints the cached transcript instantly while
// the catch-up fetch reconciles against opencode — the fetch stays the
// source of truth, so a stale entry only affects what flashes first.
// Entries hold the loaded window (newest page plus any older pages the
// reader pulled in), never the whole history, with the paging meta that
// describes where the window starts.
export type CachedMessages = {
  payload: string
  messages: ChatMessage[]
  page?: MessagePageMeta
}

const CACHE_MAX = 10

const cache = new Map<string, CachedMessages>()

export function getCachedMessages(
  sessionId: string,
): CachedMessages | undefined {
  if (!sessionId) return undefined
  const hit = cache.get(sessionId)
  if (!hit) return undefined
  cache.delete(sessionId)
  cache.set(sessionId, hit)
  return hit
}

export function putCachedMessages(
  sessionId: string,
  payload: string,
  messages: ChatMessage[],
  page?: MessagePageMeta,
): void {
  if (!sessionId || !payload) return
  cache.delete(sessionId)
  cache.set(sessionId, { payload, messages, page })
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function dropCachedMessages(sessionId: string): void {
  if (!sessionId) return
  cache.delete(sessionId)
}

export function clearCachedMessages(): void {
  cache.clear()
}
