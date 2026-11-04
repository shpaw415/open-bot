// Delegated-busy indicator: a council member (or a hidden persona teammate)
// runs as a hidden `worker:` session that the thread list filters out, and
// the coordinating thread itself sits idle while the team works — so no row
// ever showed the activity. These helpers lift a hidden subject's busy state
// onto the creator's row using the control plane's delegation watch rows
// (GET /api/delegations). Subjects the list does show (visible teammates)
// already spin on their own row and are skipped, so one spinner always means
// one actually-working session.

export type DelegationWatch = {
  kind: "council" | "persona"
  creator: string
  subject: string
  councilId: string | null
}

export function parseDelegationWatches(raw: unknown): DelegationWatch[] {
  const body = raw as { watches?: unknown } | null
  const list = body?.watches
  if (!Array.isArray(list)) return []
  const out: DelegationWatch[] = []
  for (const item of list) {
    const row = item as Record<string, unknown>
    if (typeof row.creator !== "string" || typeof row.subject !== "string")
      continue
    if (row.creator === row.subject) continue
    out.push({
      kind: row.kind === "persona" ? "persona" : "council",
      creator: row.creator,
      subject: row.subject,
      councilId: typeof row.councilId === "string" ? row.councilId : null,
    })
  }
  return out
}

/** One row of GET /api/councils: a council plus its member count. */
export type CouncilSummary = {
  id: string
  name: string
  members: number
  createdAt: number
}

export function parseCouncilSummaries(raw: unknown): CouncilSummary[] {
  const body = raw as { councils?: unknown } | null
  const list = body?.councils
  if (!Array.isArray(list)) return []
  const out: CouncilSummary[] = []
  for (const item of list) {
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.name !== "string") continue
    if (!row.id || !row.name) continue
    out.push({
      id: row.id,
      name: row.name,
      members:
        typeof row.members === "number" && Number.isFinite(row.members)
          ? row.members
          : 0,
      createdAt:
        typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
          ? row.createdAt
          : 0,
    })
  }
  return out
}

/** A council attached to the open thread, ready for the floating list. */
export type ThreadCouncil = {
  id: string
  name: string
  members: number
  running: number
}

/**
 * The open thread's councils: teams it created (delegation watches whose
 * creator is this thread) union teams its replies announced (council
 * markers) — the second source still lists a council whose wake never
 * armed. Several councils can belong to one thread at once; order is
 * creation order (watches first, then marker-only councils in reply
 * order). `running` counts busy members known through the watches.
 */
export function threadCouncils(input: {
  // null = the councils list has not loaded yet: rows are derived from
  // watches/markers alone. Once loaded, a watch or marker whose council
  // row is gone means the council was closed — it drops out of the list.
  councils: readonly CouncilSummary[] | null
  watches: readonly DelegationWatch[]
  markerNames: readonly string[]
  creatorId: string
  isBusy: (sessionId: string) => boolean
}): ThreadCouncil[] {
  if (!input.creatorId) return []
  const loaded = input.councils !== null
  const summaries = input.councils ?? []
  const byId = new Map(summaries.map((row) => [row.id, row]))
  const byName = new Map(summaries.map((row) => [row.name.toLowerCase(), row]))
  const out: ThreadCouncil[] = []
  const seen = new Set<string>()
  const subjects = new Map<string, string[]>()
  for (const watch of input.watches) {
    if (watch.kind !== "council" || !watch.councilId) continue
    if (watch.creator !== input.creatorId) continue
    const list = subjects.get(watch.councilId) ?? []
    list.push(watch.subject)
    subjects.set(watch.councilId, list)
  }
  const push = (row: ThreadCouncil, key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    out.push(row)
  }
  for (const [councilId, memberIds] of subjects) {
    const summary = byId.get(councilId)
    if (!summary && loaded) continue
    push(
      {
        id: councilId,
        name: summary?.name ?? councilId,
        members: summary?.members ?? memberIds.length,
        running: memberIds.filter((id) => input.isBusy(id)).length,
      },
      councilId,
    )
  }
  for (const name of input.markerNames) {
    const slug = name.toLowerCase()
    if (!slug) continue
    const summary = byName.get(slug)
    if (summary) {
      if (seen.has(summary.id)) continue
      push(
        {
          id: summary.id,
          name: summary.name,
          members: summary.members,
          running: 0,
        },
        summary.id,
      )
    } else if (
      !loaded &&
      !seen.has(slug) &&
      !out.some((row) => row.name === slug)
    ) {
      // Marker before the first list load: openable by name, counts unknown.
      push({ id: "", name: slug, members: 0, running: 0 }, slug)
    }
  }
  return out
}

export function delegatedBusyIds(
  watches: readonly DelegationWatch[],
  isBusy: (sessionId: string) => boolean,
  visibleIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const busy = new Set<string>()
  for (const watch of watches) {
    if (visibleIds.has(watch.subject)) continue
    if (!isBusy(watch.subject)) continue
    busy.add(watch.creator)
  }
  return busy
}
