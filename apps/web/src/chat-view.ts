export type ChatPart = {
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
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

export type VisibleMessage = ChatMessage & { text: string }

export function visibleMessages(messages: ChatMessage[]): VisibleMessage[] {
  const out: VisibleMessage[] = []
  for (const message of messages) {
    const text = visibleText(message)
    if (!text.trim()) continue
    out.push({ ...message, text })
  }
  return out
}

export function threadBubbles(messages: ChatMessage[]): VisibleMessage[] {
  const out: VisibleMessage[] = []
  for (const message of visibleMessages(messages)) {
    const role = message.info?.role ?? "message"
    const prev = out[out.length - 1]
    const prevRole = prev?.info?.role ?? "message"
    if (prev && role !== "user" && prevRole !== "user") {
      prev.text = `${prev.text}\n\n${message.text}`
      continue
    }
    out.push({ ...message, text: message.text })
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
