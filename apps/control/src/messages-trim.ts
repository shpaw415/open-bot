// The dashboard refetches a session's whole message list on every stream
// tick, so a thread where the agent read large files (base64 image
// attachments, long tool output) can balloon to tens of MB and stall the
// tab. The chat renders images from `file` parts only, so tool-part bulk is
// safe to slim: cap stored output and stub oversized attachment URLs while
// keeping the attachment labels.
export const TOOL_OUTPUT_CAP = 8_000
export const ATTACHMENT_URL_CAP = 512

type PartLike = {
  type?: unknown
  state?: {
    output?: unknown
    attachments?: unknown
  }
}

function trimToolPart(part: object, cap: number): void {
  const row = part as PartLike
  if (row.type !== "tool" || !row.state || typeof row.state !== "object") return
  const output = row.state.output
  if (typeof output === "string" && output.length > cap) {
    row.state.output = `${output.slice(0, cap)}\n[truncated — ${output.length - cap} more chars]`
  }
  const attachments = row.state.attachments
  if (!Array.isArray(attachments)) return
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue
    const row = attachment as { url?: unknown }
    if (typeof row.url === "string" && row.url.length > ATTACHMENT_URL_CAP)
      row.url = "data:truncated"
  }
}

function trimParts(parts: unknown, cap: number): void {
  if (!Array.isArray(parts)) return
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    trimToolPart(part, cap)
  }
}

export function trimDashboardMessages(
  messages: unknown,
  cap = TOOL_OUTPUT_CAP,
): unknown {
  if (!Array.isArray(messages)) return messages
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    trimParts((message as { parts?: unknown }).parts, cap)
  }
  return messages
}

type EventLike = { type?: unknown; properties?: unknown }

/** Copy-on-write twin of trimToolPart: returns a trimmed clone, or null when
 * the part is already lean enough to send as is. */
function cloneTrimmedToolPart(part: object, cap: number): object | null {
  const row = part as PartLike
  if (row.type !== "tool" || !row.state || typeof row.state !== "object")
    return null
  const state = row.state as { output?: unknown; attachments?: unknown }
  let nextState: Record<string, unknown> | null = null
  const output = state.output
  if (typeof output === "string" && output.length > cap) {
    nextState = {
      ...state,
      output: `${output.slice(0, cap)}\n[truncated — ${output.length - cap} more chars]`,
    }
  }
  const attachments = state.attachments
  if (Array.isArray(attachments)) {
    let nextAttachments: unknown[] | null = null
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i]
      if (!attachment || typeof attachment !== "object") continue
      const url = (attachment as { url?: unknown }).url
      if (typeof url === "string" && url.length > ATTACHMENT_URL_CAP) {
        nextAttachments ??= attachments.slice()
        nextAttachments[i] = {
          ...(attachment as object),
          url: "data:truncated",
        }
      }
    }
    if (nextAttachments)
      nextState = { ...(nextState ?? state), attachments: nextAttachments }
  }
  if (!nextState) return null
  return { ...(part as object), state: nextState }
}

function cloneTrimmedParts(parts: unknown, cap: number): unknown {
  if (!Array.isArray(parts)) return parts
  let next: unknown[] | null = null
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || typeof part !== "object") continue
    const cloned = cloneTrimmedToolPart(part, cap)
    if (!cloned) continue
    next ??= parts.slice()
    next[i] = cloned
  }
  return next ?? parts
}

/**
 * Trim a forwarded opencode event so dashboard sockets never carry megabyte
 * base64 attachments (same caps as the messages route, so a delta and a
 * later refetch agree). Copy-on-write: observers keep their untouched event.
 * Returns the frame to send — the same object when nothing needed trimming.
 */
export function trimDashboardEvent<T extends EventLike>(
  event: T,
  cap = TOOL_OUTPUT_CAP,
): T {
  if (!event || typeof event !== "object") return event
  const type = event.type
  if (type !== "message.updated" && type !== "message.part.updated")
    return event
  const props = event.properties
  if (!props || typeof props !== "object") return event
  const record = props as { info?: unknown; part?: unknown }
  let nextProps: Record<string, unknown> | null = null
  const info = record.info
  if (info && typeof info === "object") {
    const row = info as { parts?: unknown }
    const parts = cloneTrimmedParts(row.parts, cap)
    if (parts !== row.parts)
      nextProps = { ...record, info: { ...(info as object), parts } }
  }
  const part = record.part
  if (part && typeof part === "object") {
    const cloned = cloneTrimmedToolPart(part, cap)
    if (cloned) nextProps = { ...(nextProps ?? record), part: cloned }
  }
  if (!nextProps) return event
  return { ...event, properties: nextProps }
}
