import type { ChatMessage, StreamEvent } from "./chat-view"
import { visibleText } from "./chat-view"

export const THREAD_KEY = "ob-thread"
export const OPEN_THREAD_EVENT = "ob-open-thread"
export const PREVIEW_LIMIT = 120
export const FRESH_SKEW_MS = 30_000
export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

const CLAIMS_KEY = "ob-notified"
const UNREAD_KEY = "ob-unread"
const unreadListeners = new Set<() => void>()

export type NoticeFocus = {
  path: string
  tab: string
  sessionId: string
}

export type FreshReply = {
  id: string
  text: string
  completedAt: number
}

export type NativePermission = "unsupported" | "default" | "granted" | "denied"

export type ClaimStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type Claim = { at: number; token: string }

let focus: NoticeFocus = { path: "/", tab: "", sessionId: "" }

export function setNoticeFocus(next: Partial<NoticeFocus>) {
  focus = { ...focus, ...next }
}

export function getNoticeFocus(): NoticeFocus {
  return focus
}

export function onWorkspacePath(path: string): boolean {
  return (
    !path.startsWith("/admin") &&
    !path.startsWith("/providers") &&
    !path.startsWith("/config")
  )
}

export function shouldNotify(input: {
  hidden: boolean
  path: string
  tab: string
  viewingSessionId: string
  replySessionId: string
}): boolean {
  if (input.hidden) return true
  if (!onWorkspacePath(input.path)) return true
  if (input.tab !== "chat") return true
  return input.viewingSessionId !== input.replySessionId
}

export function notificationPreview(
  text: string,
  limit = PREVIEW_LIMIT,
): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1).trimEnd()}…`
}

function sessionIdOf(event: StreamEvent): string {
  const props = event.properties
  if (!props || typeof props !== "object") return ""
  const record = props as {
    sessionID?: unknown
    info?: { sessionID?: unknown }
    part?: { sessionID?: unknown }
  }
  for (const id of [
    record.sessionID,
    record.part?.sessionID,
    record.info?.sessionID,
  ]) {
    if (typeof id === "string" && id) return id
  }
  return ""
}

export function armsSession(event: StreamEvent): string {
  const id = sessionIdOf(event)
  if (!id) return ""
  if (event.type === "message.part.updated") return id
  if (event.type !== "session.status") return ""
  const status = (event.properties as { status?: { type?: unknown } }).status
  const type = status && typeof status === "object" ? status.type : ""
  return typeof type === "string" && type && type !== "idle" ? id : ""
}

export function idleSessionId(event: StreamEvent): string {
  if (event.type !== "session.idle") return ""
  return sessionIdOf(event)
}

function messageId(message: ChatMessage): string {
  const id = (message.info as { id?: unknown } | undefined)?.id
  return typeof id === "string" ? id : ""
}

function completedAt(message: ChatMessage): number | null {
  if (message.info?.role !== "assistant") return null
  if (message.info.summary === true) return null
  const completed = message.info.time?.completed
  return typeof completed === "number" && Number.isFinite(completed)
    ? completed
    : null
}

export function freshReply(
  messages: ChatMessage[],
  armedAt: number,
  skewMs = FRESH_SKEW_MS,
): FreshReply | null {
  let best: FreshReply | null = null
  for (const message of messages) {
    const completed = completedAt(message)
    if (completed == null || completed < armedAt - skewMs) continue
    const text = notificationPreview(visibleText(message))
    if (!text) continue
    const id = messageId(message)
    if (!id) continue
    if (!best || completed >= best.completedAt) {
      best = { id, text, completedAt: completed }
    }
  }
  return best
}

function readClaims(storage: ClaimStorage): Record<string, Claim> {
  try {
    const raw = storage.getItem(CLAIMS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}
    const out: Record<string, Claim> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue
      const at = (value as { at?: unknown }).at
      const token = (value as { token?: unknown }).token
      if (typeof at === "number" && typeof token === "string")
        out[id] = { at, token }
    }
    return out
  } catch {
    return {}
  }
}

export function claimNotice(
  storage: ClaimStorage,
  id: string,
  now = Date.now(),
  token = `${now}-${Math.random().toString(36).slice(2)}`,
): boolean {
  if (!id) return false
  try {
    const kept: Record<string, Claim> = {}
    for (const [key, claim] of Object.entries(readClaims(storage))) {
      if (now - claim.at < CLAIM_TTL_MS) kept[key] = claim
    }
    if (kept[id]) {
      storage.setItem(CLAIMS_KEY, JSON.stringify(kept))
      return false
    }
    kept[id] = { at: now, token }
    storage.setItem(CLAIMS_KEY, JSON.stringify(kept))
    return readClaims(storage)[id]?.token === token
  } catch {
    return true
  }
}

function parseUnread(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => typeof id === "string" && id.length > 0)
  } catch {
    return []
  }
}

export function readUnread(storage: ClaimStorage): string[] {
  try {
    return parseUnread(storage.getItem(UNREAD_KEY))
  } catch {
    return []
  }
}

export function markThreadUnread(
  storage: ClaimStorage,
  sessionId: string,
): boolean {
  if (!sessionId) return false
  const ids = readUnread(storage)
  if (ids.includes(sessionId)) return false
  storage.setItem(UNREAD_KEY, JSON.stringify([...ids, sessionId]))
  return true
}

export function clearThreadUnread(
  storage: ClaimStorage,
  sessionId: string,
): boolean {
  if (!sessionId) return false
  const ids = readUnread(storage)
  if (!ids.includes(sessionId)) return false
  storage.setItem(
    UNREAD_KEY,
    JSON.stringify(ids.filter((id) => id !== sessionId)),
  )
  return true
}

function emitUnread() {
  for (const listener of unreadListeners) listener()
}

export function subscribeUnread(listener: () => void): () => void {
  if (unreadListeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onUnreadStorage)
  }
  unreadListeners.add(listener)
  return () => {
    unreadListeners.delete(listener)
    if (unreadListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onUnreadStorage)
    }
  }
}

function onUnreadStorage(event: StorageEvent) {
  if (event.key === UNREAD_KEY || event.key === null) emitUnread()
}

export function noteThreadUnread(sessionId: string) {
  try {
    if (markThreadUnread(localStorage, sessionId)) emitUnread()
  } catch {}
}

export function seenThread(sessionId: string) {
  try {
    if (clearThreadUnread(localStorage, sessionId)) emitUnread()
  } catch {}
}

export function openNotifiedThread(sessionId: string) {
  try {
    localStorage.setItem(THREAD_KEY, sessionId)
  } catch {}
  window.dispatchEvent(
    new CustomEvent(OPEN_THREAD_EVENT, { detail: { sessionId } }),
  )
}

export function readNativePermission(): NativePermission {
  if (typeof window === "undefined" || !window.isSecureContext)
    return "unsupported"
  if (typeof Notification === "undefined") return "unsupported"
  if (
    Notification.permission === "granted" ||
    Notification.permission === "denied"
  ) {
    return Notification.permission
  }
  return "default"
}
