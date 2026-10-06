export type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

const DAY = 86_400_000

function num(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

export function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null
  const usage = (value as { usage?: unknown }).usage
  if (!usage || typeof usage !== "object") return null
  const row = usage as Record<string, unknown>
  if (
    row.prompt_tokens === undefined &&
    row.completion_tokens === undefined &&
    row.total_tokens === undefined
  ) {
    return null
  }
  const promptTokens = num(row.prompt_tokens)
  const completionTokens = num(row.completion_tokens)
  const totalTokens = num(row.total_tokens) || promptTokens + completionTokens
  return { promptTokens, completionTokens, totalTokens }
}

export function parseSseUsage(text: string): TokenUsage | null {
  let found: TokenUsage | null = null
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === "[DONE]") continue
    try {
      const parsed = readUsage(JSON.parse(payload))
      if (parsed) found = parsed
    } catch {
      // non-json SSE lines are ignored
    }
  }
  return found
}

export function teeUsage(source: ReadableStream<Uint8Array>) {
  let buffer = ""
  let found: TokenUsage | null = null
  const decoder = new TextDecoder()
  let resolveUsage: (value: TokenUsage | null) => void = () => {}
  const usage = new Promise<TokenUsage | null>((resolve) => {
    resolveUsage = resolve
  })
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    buffer += decoder.decode()
    const parsed = parseSseUsage(buffer)
    if (parsed) found = parsed
    resolveUsage(found)
  }
  const reader = source.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          finish()
          controller.close()
          return
        }
        buffer += decoder.decode(next.value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        const parsed = parseSseUsage(`${lines.join("\n")}\n`)
        if (parsed) found = parsed
        controller.enqueue(next.value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    cancel(reason) {
      finish()
      return reader.cancel(reason)
    },
  })
  return { stream, usage }
}

export function utcDay(ts: number) {
  return Math.floor(ts / DAY) * DAY
}

export function fillDays(now: number, days: number) {
  const end = utcDay(now)
  const start = end - (days - 1) * DAY
  const out: number[] = []
  for (let day = start; day <= end; day += DAY) out.push(day)
  return out
}

export function dayLabel(day: number) {
  return new Date(day).toISOString().slice(0, 10)
}

export function usageDays(value: string | null) {
  const n = Number(value ?? 30)
  if (n === 7 || n === 90) return n
  return 30
}
