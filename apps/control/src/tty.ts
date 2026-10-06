export function ttySize(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const size = Math.floor(n)
  if (size < 2 || size > 500) return null
  return size
}

export function ttySizeOr(value: unknown, fallback: number) {
  return ttySize(value) ?? fallback
}

export function parseTtyControl(
  text: string,
): { cols: number; rows: number } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  if ((body as { op?: unknown }).op !== "resize") return null
  const cols = ttySize((body as { cols?: unknown }).cols)
  const rows = ttySize((body as { rows?: unknown }).rows)
  if (cols === null || rows === null) return null
  return { cols, rows }
}

export function ttyExitFrame(code: number | null, note?: string) {
  return JSON.stringify(
    note ? { op: "exit", code, note } : { op: "exit", code },
  )
}
