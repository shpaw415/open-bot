// The dashboard refetches a session's whole message list on every stream
// tick, so a thread where the agent read large files (base64 image
// attachments, long tool output) can balloon to tens of MB and stall the
// tab. The chat renders images from `file` parts only, so tool-part bulk is
// safe to slim: cap stored output and stub oversized attachment URLs while
// keeping the attachment labels.
export const TOOL_OUTPUT_CAP = 8_000
export const ATTACHMENT_URL_CAP = 512

export function trimDashboardMessages(
  messages: unknown,
  cap = TOOL_OUTPUT_CAP,
): unknown {
  if (!Array.isArray(messages)) return messages
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const parts = (message as { parts?: unknown }).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      const row = part as {
        type?: unknown
        state?: {
          output?: unknown
          attachments?: unknown
        }
      }
      if (row.type !== "tool" || !row.state || typeof row.state !== "object")
        continue
      const output = row.state.output
      if (typeof output === "string" && output.length > cap) {
        row.state.output = `${output.slice(0, cap)}\n[truncated — ${output.length - cap} more chars]`
      }
      const attachments = row.state.attachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (!attachment || typeof attachment !== "object") continue
        const row = attachment as { url?: unknown }
        if (typeof row.url === "string" && row.url.length > ATTACHMENT_URL_CAP)
          row.url = "data:truncated"
      }
    }
  }
  return messages
}
