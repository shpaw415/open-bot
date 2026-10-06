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
