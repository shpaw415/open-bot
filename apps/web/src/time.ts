/** Shared relative-time label ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatAgo(ts: number, now = Date.now()): string {
  if (!ts) return ""
  const minutes = Math.round((now - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Short absolute stamp for panels ("Oct 18, 14:05"). */
export function formatWhen(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
