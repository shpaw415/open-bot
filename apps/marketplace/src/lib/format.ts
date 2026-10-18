// Shared formatting helpers. Kept dependency-free so both server and client
// bundles stay small and every surface renders prices and dates identically.

export function priceText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function isPaid(cents: number | null | undefined): boolean {
  return typeof cents === "number" && cents > 0
}

// Truthful date rendering: timestamps are ms since epoch; unknown stays empty
// instead of inventing a date.
export function dateText(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return ""
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

// Review statuses actually returned by the pipeline, translated to explicit
// labels. Unknown statuses fall back to their raw text — never renamed into
// something that sounds more reassuring.
export const reviewLabels: Record<string, string> = {
  queued: "Queued for review",
  running: "Review in progress",
  pass: "Passed automated review",
  approved: "Approved",
  pending: "Awaiting review",
  concern: "Review raised concerns",
  rejected: "Rejected",
  error: "Review failed",
  revoked: "Revoked",
}

export function reviewLabel(status: string | null | undefined): string {
  if (!status) return "No automated review recorded"
  return reviewLabels[status.toLowerCase()] ?? status
}

export function installCommand(pluginId: string): string {
  return `ob-plugin install ${pluginId}`
}
