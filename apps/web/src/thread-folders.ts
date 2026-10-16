// Threads-panel folder collapse state: parsing the persisted key list and
// opening one folder inside an immutable set. Notification navigation is the
// only caller of expandFolder — collapsing the active thread's folder by hand
// must stick across refreshes and thread switches.

export function parseCollapsedFolders(raw: string | null): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((item): item is string => typeof item === "string"),
    )
  } catch {
    return new Set()
  }
}

// Returns the same set when nothing changed so React state can bail out.
export function expandFolder(
  collapsed: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (!collapsed.has(key)) return collapsed
  const next = new Set(collapsed)
  next.delete(key)
  return next
}
