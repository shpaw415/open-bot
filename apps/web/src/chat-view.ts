const WORKSPACE = "/home/agent/workspace/"
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
const VIDEO_EXT = /\.(mp4|webm)$/i
const MODEL3D_EXT = /\.glb$/i
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i

export type ChatPart = {
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
  mime?: string
  url?: string
  filename?: string
}

export type ChatMessage = {
  info?: {
    role?: string
    summary?: boolean | { diffs?: unknown[] }
    time?: { created?: number; completed?: number }
  }
  parts?: ChatPart[]
}

export type ModelActivity = "initialize" | "working" | "done"

export const ACTIVITY_LABEL: Record<ModelActivity, string> = {
  initialize: "Initialize",
  working: "Working",
  done: "Done",
}

const STICK_PX = 48

export function nearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < STICK_PX
}

function isCompaction(message: ChatMessage): boolean {
  return message.info?.summary === true
}

export function visibleText(message: ChatMessage): string {
  if (isCompaction(message)) return ""
  return (message.parts ?? [])
    .filter(
      (part) =>
        !part.synthetic &&
        !part.ignored &&
        (!part.type || part.type === "text") &&
        Boolean(part.text),
    )
    .map((part) => part.text ?? "")
    .join("\n\n")
}

const SCREEN_IMAGE = /!\[[^\]]*\]\(open-bot:\/\/screen\)/g
const SCREEN_LINK = /\[[^\]]*\]\(open-bot:\/\/screen\)/g
const SCREEN_LINE = /(^|\n)\s*open-bot:\/\/screen\s*(?=\n|$)/g

export type VisibleMessage = ChatMessage & {
  text: string
  images: string[]
  handoff: boolean
  sentAt: number | null
}

export type SendStatus = "sending" | "sent" | "failed"

export type SendReceipt = {
  id: string
  text: string
  files?: string[]
  status: SendStatus
  sentAt: number
  baseline: number
}

export type TranscriptEntry = {
  message: VisibleMessage
  mark: SendStatus | null
  pendingId: string | null
}

export function showLiveScreen(input: {
  handoff: boolean
  isLast: boolean
  held: boolean
  dismissed: boolean
}): boolean {
  return input.handoff && input.isLast && !input.held && !input.dismissed
}

export function handoffStamp(message: {
  text: string
  sentAt: number | null
}): string {
  return `${message.sentAt ?? 0}:${message.text.slice(0, 80)}`
}

export function vncFrameSrc(path: string, interactive: boolean): string {
  const query = new URLSearchParams({
    autoconnect: "1",
    resize: "scale",
    path,
    view_only: interactive ? "0" : "1",
  })
  return `/desktop/view/vnc.html?${query}`
}

export function splitScreenHandoff(text: string): {
  text: string
  handoff: boolean
} {
  const handoff =
    SCREEN_IMAGE.test(text) || SCREEN_LINK.test(text) || SCREEN_LINE.test(text)
  SCREEN_IMAGE.lastIndex = 0
  SCREEN_LINK.lastIndex = 0
  SCREEN_LINE.lastIndex = 0
  if (!handoff) return { text, handoff: false }
  const stripped = text
    .replace(SCREEN_IMAGE, "")
    .replace(SCREEN_LINK, "")
    .replace(SCREEN_LINE, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  SCREEN_IMAGE.lastIndex = 0
  SCREEN_LINK.lastIndex = 0
  SCREEN_LINE.lastIndex = 0
  return { text: stripped, handoff: true }
}

export function workspaceImagePath(raw: string): string | null {
  return workspaceMediaPath(raw, IMAGE_EXT)
}

export function workspaceVideoPath(raw: string): string | null {
  return workspaceMediaPath(raw, VIDEO_EXT)
}

export function workspaceModel3dPath(raw: string): string | null {
  return workspaceMediaPath(raw, MODEL3D_EXT)
}

function workspaceMediaPath(raw: string, ext: RegExp): string | null {
  let path = raw.trim()
  if (!path || path.includes("\0") || path.includes("\\")) return null
  if (path.startsWith("file://")) {
    try {
      const url = new URL(path)
      if (url.protocol !== "file:") return null
      path = decodeURIComponent(url.pathname)
    } catch {
      return null
    }
  } else {
    if (path.includes("?") || path.includes("#")) return null
    try {
      path = decodeURIComponent(path)
    } catch {
      return null
    }
  }
  if (!path.startsWith(WORKSPACE)) return null
  const rest = path.slice(WORKSPACE.length)
  if (!rest) return null
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (!ext.test(rest)) return null
  return `${WORKSPACE}${rest}`
}

export function workspaceImageSrc(path: string): string {
  return `/api/workspace/image?path=${encodeURIComponent(path)}`
}

export function workspaceVideoSrc(path: string): string {
  return `/api/workspace/video?path=${encodeURIComponent(path)}`
}

export function workspaceModel3dSrc(path: string): string {
  return `/api/workspace/model3d?path=${encodeURIComponent(path)}`
}

export function chatImageUrl(url: string): string {
  const local = workspaceImagePath(url)
  if (local) return workspaceImageSrc(local)
  const video = workspaceVideoPath(url)
  if (video) return workspaceVideoSrc(video)
  const model = workspaceModel3dPath(url)
  if (model) return workspaceModel3dSrc(model)
  const trimmed = url.trim()
  if (/^https:\/\//i.test(trimmed)) return trimmed
  return ""
}

export function embedWorkspaceImages(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      const bare = trimmed.replace(/^`|`$/g, "")
      const path = workspaceImagePath(bare) ?? workspaceModel3dPath(bare)
      if (!path || (trimmed !== path && trimmed !== `\`${path}\``)) return line
      const name = path.slice(path.lastIndexOf("/") + 1)
      return `![${name}](${path})`
    })
    .join("\n")
}

export function visibleImages(message: ChatMessage): string[] {
  if (isCompaction(message)) return []
  const out: string[] = []
  for (const part of message.parts ?? []) {
    if (part.synthetic || part.ignored || part.type !== "file" || !part.url)
      continue
    const data = safeDataImage(part.url, part.mime)
    if (data) {
      out.push(data)
      continue
    }
    const path = workspaceImagePath(part.url)
    if (path) out.push(workspaceImageSrc(path))
  }
  return out
}

function safeDataImage(url: string, mime?: string): string | null {
  const compact = url.trim().replace(/\s/g, "")
  const match = DATA_IMAGE.exec(compact)
  if (!match || !mime) return null
  if (`image/${match[1]?.toLowerCase()}` !== mime.toLowerCase()) return null
  return compact
}

export function visibleMessages(messages: ChatMessage[]): VisibleMessage[] {
  const out: VisibleMessage[] = []
  for (const message of messages) {
    const parsed = splitScreenHandoff(
      embedWorkspaceImages(visibleText(message)),
    )
    const images = visibleImages(message)
    if (!parsed.text.trim() && images.length === 0 && !parsed.handoff) continue
    out.push({
      ...message,
      text: parsed.text,
      images,
      handoff: parsed.handoff,
      sentAt: messageSentAt(message),
    })
  }
  return out
}

export function cronResultBody(text: string): string | null {
  if (!text.startsWith("[cron-result:")) return null
  const split = text.indexOf("\n")
  return (split === -1 ? "" : text.slice(split)).trim()
}

export type PluginCardBlock = {
  plugin: string
  type: string
  data: Record<string, unknown>
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "plugin-card"; block: PluginCardBlock }

const PLUGIN_CARD_FENCE =
  /```plugin-card[ \t]*:?[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g

/** Parses ```plugin-card fenced blocks the agent emits into chat replies. */
export function splitPluginCards(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let cursor = 0
  PLUGIN_CARD_FENCE.lastIndex = 0
  for (const match of text.matchAll(PLUGIN_CARD_FENCE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, start) })
    }
    let parsed: unknown = null
    try {
      parsed = JSON.parse(match[2] ?? "")
    } catch {
      parsed = null
    }
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    const data =
      record.data &&
      typeof record.data === "object" &&
      !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : {}
    out.push({
      kind: "plugin-card",
      block: {
        plugin:
          typeof record.plugin === "string" ? record.plugin : (match[1] ?? ""),
        type: typeof record.type === "string" ? record.type : "",
        data,
      },
    })
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) })
  }
  return out.length > 0 ? out : [{ kind: "text", text }]
}

const BUBBLE_GAP_MS = 5 * 60_000

function messageSentAt(message: ChatMessage): number | null {
  const created = message.info?.time?.created
  return typeof created === "number" && Number.isFinite(created)
    ? created
    : null
}

function sameBurst(prevAt: number | null, nextAt: number | null): boolean {
  if (prevAt == null || nextAt == null) return true
  return nextAt - prevAt < BUBBLE_GAP_MS
}

export function userMessageCount(messages: ChatMessage[]): number {
  return messages.reduce(
    (count, message) => (message.info?.role === "user" ? count + 1 : count),
    0,
  )
}

export function receiptMatches(
  message: ChatMessage,
  receipt: SendReceipt,
): boolean {
  const got = visibleText(message).trim()
  const want = receipt.text.trim()
  const files = receipt.files ?? []
  if (files.length === 0) return got === want
  if (!got.includes("Joined file:")) return false
  if (!want) return true
  return got.startsWith(want)
}

function pendingParts(receipt: SendReceipt): ChatPart[] {
  const text = [
    receipt.text.trim(),
    ...(receipt.files ?? []).map((name) => `Joined file: ${name}`),
  ]
    .filter(Boolean)
    .join("\n\n")
  if (!text) return []
  return [{ type: "text", text }]
}

function receiptBubbleIndex(
  messages: ChatMessage[],
  shown: VisibleMessage[],
  receipt: SendReceipt,
): number | null {
  let seen = 0
  let target: ChatMessage | null = null
  for (const message of messages) {
    if (message.info?.role !== "user") continue
    if (seen === receipt.baseline) {
      target = message
      break
    }
    seen++
  }
  if (!target || !receiptMatches(target, receipt)) return null
  const index = shown.findIndex(
    (bubble) => bubble.info === target.info && bubble.parts === target.parts,
  )
  return index === -1 ? null : index
}

export function transcriptBubbles(
  messages: ChatMessage[],
  receipts: SendReceipt[],
): TranscriptEntry[] {
  const shown = threadBubbles(messages)
  const marks = new Map<number, SendStatus>()
  const pending: SendReceipt[] = []
  for (const receipt of receipts) {
    const index = receiptBubbleIndex(messages, shown, receipt)
    if (index != null) {
      marks.set(index, receipt.status === "failed" ? "sent" : receipt.status)
      continue
    }
    if (
      receipt.status === "sent" &&
      messages.length === 0 &&
      receipt.baseline > 0
    ) {
      continue
    }
    pending.push(receipt)
  }
  const out: TranscriptEntry[] = shown.map((message, index) => ({
    message,
    mark: marks.get(index) ?? null,
    pendingId: null,
  }))
  for (const receipt of pending) {
    const [bubble] = threadBubbles([
      {
        info: { role: "user", time: { created: receipt.sentAt } },
        parts: pendingParts(receipt),
      },
    ])
    if (!bubble) continue
    out.push({
      message: bubble,
      mark: receipt.status,
      pendingId: receipt.id,
    })
  }
  return out
}

export function threadBubbles(messages: ChatMessage[]): VisibleMessage[] {
  const out: VisibleMessage[] = []
  const burstAt = new Map<VisibleMessage, number | null>()
  for (const message of visibleMessages(messages)) {
    const result = cronResultBody(message.text)
    if (result !== null) {
      const bubble: VisibleMessage = {
        ...message,
        info: { ...message.info, role: "assistant" },
        text: result,
        images: [...message.images],
      }
      burstAt.set(bubble, bubble.sentAt)
      out.push(bubble)
      continue
    }
    const role = message.info?.role ?? "message"
    const prev = out[out.length - 1]
    const prevRole = prev?.info?.role ?? "message"
    if (
      prev &&
      role !== "user" &&
      prevRole !== "user" &&
      sameBurst(burstAt.get(prev) ?? null, message.sentAt)
    ) {
      if (message.text.trim()) {
        prev.text = prev.text.trim()
          ? `${prev.text}\n\n${message.text}`
          : message.text
      }
      prev.images = [...prev.images, ...message.images]
      prev.handoff = prev.handoff || message.handoff
      if (prev.sentAt == null && message.sentAt != null)
        prev.sentAt = message.sentAt
      if (message.sentAt != null) burstAt.set(prev, message.sentAt)
      continue
    }
    const bubble: VisibleMessage = {
      ...message,
      text: message.text,
      images: [...message.images],
      handoff: message.handoff,
    }
    burstAt.set(bubble, bubble.sentAt)
    out.push(bubble)
  }
  return out
}

const STALE_TURN_MS = 15_000

export function modelActivity(input: {
  phase: "starting" | "running" | "sleeping"
  sending: boolean
  status?: { type?: string }
  messages: ChatMessage[]
  now?: number
}): ModelActivity | null {
  if (input.phase === "starting") return "initialize"
  if (input.phase !== "running") return null
  if (input.sending) return "working"
  const status = input.status?.type
  if (status && status !== "idle") return "working"
  const now = input.now ?? Date.now()
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const info = input.messages[i]?.info
    if (info?.role !== "assistant" || info.summary === true) continue
    const created = info.time?.created
    if (
      info.time &&
      info.time.completed == null &&
      created != null &&
      now - created < STALE_TURN_MS
    ) {
      return "working"
    }
    break
  }
  return "done"
}

export function samePayload(prev: string, next: unknown): boolean {
  return prev === JSON.stringify(next)
}

export type StreamEvent = { type?: string; properties?: unknown }

/** True when an opencode stream event carries data for the given session. */
export function eventTouchesSession(
  event: StreamEvent,
  sessionId: string,
): boolean {
  if (!sessionId) return false
  const props = event.properties
  if (!props || typeof props !== "object") return false
  const record = props as {
    sessionID?: unknown
    info?: { id?: unknown; sessionID?: unknown }
    part?: { sessionID?: unknown }
  }
  return [
    record.sessionID,
    record.info?.id,
    record.info?.sessionID,
    record.part?.sessionID,
  ].some((id) => typeof id === "string" && id === sessionId)
}
