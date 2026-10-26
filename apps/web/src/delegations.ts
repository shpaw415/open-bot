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
