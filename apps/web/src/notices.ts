/**
 * Session-scoped notification center behind the header bell.
 *
 * The control plane has no server-side notification backlog — /api/events is
 * live-only — so this store deliberately holds one session's history in
 * memory. It is capped, dedupeable, and wiped when the signed-in account
 * changes, so one user's notices can never leak into another's view.
 */

export type NoticeKind = "reply" | "plugin" | "security" | "hardware"

export type NoticeItem = {
  id: string
  kind: NoticeKind
  title: string
  body: string
  at: number
  /** Reply notices: the conversation to open. */
  sessionId?: string
  /** Only set when a real destination exists (e.g. security → Watchdog). */
  href?: string
  read: boolean
  /** Internal: repeats inside the dedupe window refresh this entry. */
  dedupeKey?: string
}

export type NoticeInput = {
  id: string
  kind: NoticeKind
  title: string
  body: string
  at?: number
  sessionId?: string
  href?: string
  /** Collapses repeats of the same event inside the dedupe window. */
  dedupeKey?: string
}

export const NOTICE_CAP = 50
export const NOTICE_DEDUPE_MS = 10 * 60 * 1000

const listeners = new Set<() => void>()
let items: NoticeItem[] = []

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // a broken listener must not break the store
    }
  }
}

export function readNotices(): readonly NoticeItem[] {
  return items
}

export function unreadNoticeCount(): number {
  return items.reduce((total, item) => (item.read ? total : total + 1), 0)
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Wipe everything — called when the signed-in account changes. */
export function clearNotices() {
  if (items.length === 0) return
  items = []
  emit()
}

/**
 * Add a notice. A repeat of the same `dedupeKey` inside the dedupe window
 * refreshes the existing entry (time + body) instead of stacking a duplicate;
 * the entry stays unread so the count keeps meaning. The list is capped at
 * NOTICE_CAP by dropping the oldest read entries first, then the oldest.
 */
export function pushNotice(input: NoticeInput, now = Date.now()): NoticeItem {
  const at = input.at ?? now
  if (input.dedupeKey) {
    const existing = items.find(
      (item) =>
        item.dedupeKey === input.dedupeKey && now - item.at < NOTICE_DEDUPE_MS,
    )
    if (existing) {
      const updated: NoticeItem = {
        ...existing,
        title: input.title,
        body: input.body,
        at,
        sessionId: input.sessionId ?? existing.sessionId,
        href: input.href ?? existing.href,
      }
      items = [updated, ...items.filter((item) => item !== existing)]
      emit()
      return updated
    }
  }
  const notice: NoticeItem = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    at,
    sessionId: input.sessionId,
    href: input.href,
    read: false,
    dedupeKey: input.dedupeKey,
  }
  items = [notice, ...items]
  if (items.length > NOTICE_CAP) {
    // Prefer dropping read history; unread entries survive the cap longer.
    const readIndexes: number[] = []
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].read) readIndexes.push(index)
      if (readIndexes.length >= items.length - NOTICE_CAP) break
    }
    const drop = new Set(readIndexes)
    let trimmed = items.filter((_, index) => !drop.has(index))
    if (trimmed.length > NOTICE_CAP) trimmed = trimmed.slice(0, NOTICE_CAP)
    items = trimmed
  }
  emit()
  return notice
}

export function markNoticeRead(id: string, read = true) {
  const item = items.find((entry) => entry.id === id)
  if (!item || item.read === read) return
  items = items.map((entry) => (entry.id === id ? { ...entry, read } : entry))
  emit()
}

export function markAllNoticesRead() {
  if (items.every((item) => item.read)) return
  items = items.map((item) => (item.read ? item : { ...item, read: true }))
  emit()
}

/**
 * Opening a conversation by any path (notice, threads panel, link) clears
 * that thread's reply notices — read state must agree with the view.
 */
export function markNoticesForSession(sessionId: string) {
  if (!sessionId) return
  if (!items.some((item) => item.sessionId === sessionId && !item.read)) return
  items = items.map((item) =>
    item.sessionId === sessionId ? { ...item, read: true } : item,
  )
  emit()
}

// ---- Event → notice mapping (pure, unit-tested) ---------------------------

export type SecurityNoticeProps = {
  findingId?: unknown
  severity?: unknown
  title?: unknown
  action?: unknown
}

/**
 * Watchdog finding → notice. The destination is the Watchdog settings tab,
 * which exists for every signed-in user; no finding content is acted on.
 */
export function noticeFromSecurityEvent(
  props: SecurityNoticeProps | undefined,
  id: string,
): NoticeInput {
  const severity =
    typeof props?.severity === "string" ? props.severity : "finding"
  const title =
    typeof props?.title === "string" && props.title.trim()
      ? props.title.trim().slice(0, 160)
      : "suspicious activity detected"
  const stopped = props?.action === "stopped"
  const findingId = String(props?.findingId ?? "x")
  return {
    id,
    kind: "security",
    title: `Watchdog (${severity})${stopped ? " — turn stopped" : ""}`,
    body: title,
    dedupeKey: `security:${findingId}`,
    href: "/config/security",
  }
}

export type PluginNoticeProps = {
  pluginId?: unknown
  name?: unknown
  title?: unknown
  body?: unknown
}

/**
 * Plugin notice → notice. Plugins have no documented conversation
 * destination, so no sessionId and no fake open action — the entry is
 * informational.
 */
export function noticeFromPluginEvent(
  props: PluginNoticeProps | undefined,
  id: string,
): NoticeInput {
  const name =
    typeof props?.name === "string" && props.name.trim()
      ? props.name.trim()
      : typeof props?.pluginId === "string"
        ? props.pluginId
        : "plugin"
  const heading =
    typeof props?.title === "string" && props.title.trim()
      ? props.title.trim().slice(0, 120)
      : "notification"
  const detail =
    typeof props?.body === "string" && props.body.trim()
      ? props.body.trim().slice(0, 500)
      : ""
  const pluginId = String(props?.pluginId ?? "x")
  return {
    id,
    kind: "plugin",
    title: `${name}: ${heading}`,
    body: detail,
    dedupeKey: `plugin-notice:${pluginId}:${heading}`,
  }
}

export type HardwareNoticeProps = {
  title?: unknown
  body?: unknown
  percent?: unknown
}

/**
 * Hardware pressure (sampler) → notice. Informational; the Hardware tab is
 * the destination for the numbers.
 */
export function noticeFromHardwareEvent(
  props: HardwareNoticeProps | undefined,
  id: string,
): NoticeInput {
  const heading =
    typeof props?.title === "string" && props.title.trim()
      ? props.title.trim().slice(0, 120)
      : "hardware notice"
  const detail =
    typeof props?.body === "string" && props.body.trim()
      ? props.body.trim().slice(0, 500)
      : ""
  const percent = Number(props?.percent)
  return {
    id,
    kind: "hardware",
    title: Number.isFinite(percent)
      ? `${heading} (${Math.round(percent)}%)`
      : heading,
    body: detail,
    dedupeKey: `hardware:${heading}:${Number.isFinite(percent) ? Math.round(percent) : "x"}`,
    href: "/hardware",
  }
}
