import type { ChatMessage } from "./chat-view"

// Client side of the control plane's paged message list (see
// apps/control/src/messages-page.ts). The transcript keeps a window:
// the newest page first, older pages prepended on demand. These pure
// helpers own the window bookkeeping so Workspace/CouncilView only wire
// fetching and scrolling.
export const MESSAGE_PAGE_SIZE = 100
/** Mirror of the control plane's MESSAGE_PAGE_MAX_LIMIT. */
export const MESSAGE_PAGE_MAX = 1000

export type MessagePageMeta = {
  hasMore: boolean
  nextBefore: string | null
  /** User-role messages before the loaded window (receipt baselines). */
  startUserCount: number
  total: number
}

export type MessagePage = MessagePageMeta & { messages: ChatMessage[] }

export const EMPTY_PAGE_META: MessagePageMeta = {
  hasMore: false,
  nextBefore: null,
  startUserCount: 0,
  total: 0,
}

export function messagePageUrl(
  sessionId: string,
  limit: number,
  before?: string | null,
): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set("before", before)
  return `/api/opencode/session/${encodeURIComponent(sessionId)}/message?${params}`
}

/**
 * Reconciliation ticks re-ask for at least the loaded window (capped at
 * the server max) so an edit or removal inside the window is caught,
 * while a fresh thread open only pays for one page.
 */
export function tailLimit(loaded: number): number {
  return Math.min(Math.max(MESSAGE_PAGE_SIZE, loaded), MESSAGE_PAGE_MAX)
}

function metaNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

/**
 * Parse a message-list response. A bare array (older control plane, or
 * the unpaged route shape) reads as a complete single page, so a deploy
 * mismatch degrades to the old load-everything behavior, never a blank
 * transcript.
 */
export function parseMessagePage(body: unknown): MessagePage {
  if (Array.isArray(body)) {
    return {
      messages: body as ChatMessage[],
      total: body.length,
      hasMore: false,
      nextBefore: null,
      startUserCount: 0,
    }
  }
  if (body && typeof body === "object") {
    const row = body as {
      messages?: unknown
      total?: unknown
      hasMore?: unknown
      nextBefore?: unknown
      startUserCount?: unknown
    }
    if (Array.isArray(row.messages)) {
      const nextBefore =
        typeof row.nextBefore === "string" && row.nextBefore
          ? row.nextBefore
          : null
      return {
        messages: row.messages as ChatMessage[],
        total: metaNumber(row.total) || row.messages.length,
        // A page claiming more history without a cursor cannot be
        // followed; treat it as the start instead of looping on it.
        hasMore: row.hasMore === true && nextBefore !== null,
        nextBefore,
        startUserCount: metaNumber(row.startUserCount),
      }
    }
  }
  return { messages: [], ...EMPTY_PAGE_META }
}

export function pageMeta(page: MessagePage): MessagePageMeta {
  return {
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
    startUserCount: page.startUserCount,
    total: page.total,
  }
}

function messageId(message: ChatMessage): string {
  return typeof message.info?.id === "string" ? message.info.id : ""
}

/** Drop duplicate ids, keeping the last (freshest) occurrence in place. */
function dedupeById(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    const id = messageId(message)
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(message)
  }
  return out.reverse()
}

/**
 * Merge a fresh tail page into the loaded window: everything from the
 * first overlapping message on is replaced by the page (edits,
 * removals, and appends inside the overlap all land), the older prefix
 * the user already loaded is kept. `keptPrefix` tells the caller its
 * window-start meta (cursor, user offset) still describes the result;
 * without overlap there may be a gap, so the window resets to the page
 * and older history simply loads again from its cursor.
 */
export function mergeTailPage(
  window: ChatMessage[],
  page: MessagePage,
): { messages: ChatMessage[]; keptPrefix: boolean } {
  if (window.length === 0)
    return { messages: dedupeById(page.messages), keptPrefix: false }
  if (page.messages.length === 0) return { messages: [], keptPrefix: false }
  const windowIndex = new Map<string, number>()
  window.forEach((message, index) => {
    const id = messageId(message)
    if (id && !windowIndex.has(id)) windowIndex.set(id, index)
  })
  for (let i = 0; i < page.messages.length; i++) {
    const message = page.messages[i]
    if (!message) continue
    const at = windowIndex.get(messageId(message))
    if (at !== undefined) {
      return {
        messages: dedupeById([
          ...window.slice(0, at),
          ...page.messages.slice(i),
        ]),
        keptPrefix: at > 0,
      }
    }
  }
  return { messages: dedupeById(page.messages), keptPrefix: false }
}

/** Prepend an older page; in-window (delta-updated) copies win ties. */
export function mergeOlderPage(
  window: ChatMessage[],
  page: MessagePage,
): ChatMessage[] {
  if (page.messages.length === 0) return window
  if (window.length === 0) return dedupeById(page.messages)
  return dedupeById([...page.messages, ...window])
}

/**
 * True when a live `message.updated` info predates the loaded window.
 * Such deltas (e.g. a compaction touching old history) must not be
 * appended as if new — the caller skips them and the next older-page
 * load or tick reconciles.
 */
export function infoPredatesWindow(
  window: ChatMessage[],
  info: { id?: unknown; time?: { created?: unknown } } | undefined,
): boolean {
  if (window.length === 0 || !info) return false
  const id = typeof info.id === "string" ? info.id : ""
  if (id && window.some((message) => messageId(message) === id)) return false
  const created = info.time?.created
  const firstCreated = window[0]?.info?.time?.created
  return (
    typeof created === "number" &&
    typeof firstCreated === "number" &&
    created < firstCreated
  )
}
