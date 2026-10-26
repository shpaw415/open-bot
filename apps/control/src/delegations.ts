import type { Db, DelegationKind, User } from "@open-bot/db"
import { desktopPhase, endpoint } from "./docker"
import { applyThinkingEffort } from "./effort"

// Delegation wake-ups: when a delegated session (a council member or a
// persona teammate) finishes its current work, the coordinating thread is
// re-prompted so it can read the results and report to the user — without
// this, the coordinator ends its turn after starting the team and nothing
// ever brings it back.
//
// Mechanics mirror the stuck-turn watchdog and plugin hooks: the opencode SSE
// pump feeds every forwarded event here; `session.idle` for a watched subject
// triggers a wake once every sibling subject of the same delegation is idle,
// delivered as a prompt_async into the creator (deferred with `pending` while
// the creator itself is busy). Any other event for a subject re-arms its rows
// so follow-up work (`ob-thread post`, dashboard prompts) wakes again.

const REPLY_TAIL = 400

const inFlight = new Set<string>()

export type ResolvedCreator = {
  creator: string | null
  warning: string | null
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

export function eventSessionId(event: {
  type?: unknown
  properties?: unknown
}): string | null {
  const props = event.properties as
    | { sessionID?: unknown; info?: { id?: unknown } }
    | undefined
  if (typeof props?.sessionID === "string" && props.sessionID)
    return props.sessionID
  if (typeof props?.info?.id === "string" && props.info.id) return props.info.id
  return null
}

// A session may anchor a wake only if it is a top-level chat thread: not a
// subagent (parentID) and not a hidden worker:/cron-run: session.
export function wakeableSessionRow(row: {
  id?: unknown
  parentID?: unknown
  title?: unknown
}): boolean {
  if (typeof row.id !== "string" || !row.id) return false
  if (row.parentID) return false
  if (typeof row.title !== "string") return false
  return !row.title.startsWith("worker:") && !row.title.startsWith("cron-run:")
}

async function fetchJson<T>(
  base: string,
  headers: Record<string, string>,
  path: string,
): Promise<T | null> {
  const res = await fetch(`${base}${path}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok) return null
  return (await res.json().catch(() => null)) as T | null
}

async function opencodeContext(
  db: Db,
  userId: string,
): Promise<{ base: string; headers: Record<string, string> } | null> {
  if ((await desktopPhase(userId)) !== "running") return null
  const desktop = db.desktop(userId)
  if (!desktop) return null
  try {
    return {
      base: await endpoint(userId, "opencode", 4096),
      headers: { authorization: basicAuth(desktop.opencodePassword) },
    }
  } catch {
    return null
  }
}

// The caller is busy awaiting the ob-thread call, so /session/status lists it
// as busy; exactly one busy top-level chat pins the creator. Ambiguous or
// quiet moments return null and the wake simply never arms.
async function inferBusyChat(
  base: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const status = await fetchJson<Record<string, { type?: string }>>(
    base,
    headers,
    "/session/status",
  )
  if (!status) return null
  const busy = new Set(
    Object.entries(status)
      .filter(([, row]) => row?.type && row.type !== "idle")
      .map(([id]) => id),
  )
  const sessions = await fetchJson<
    { id?: unknown; parentID?: unknown; title?: unknown }[]
  >(base, headers, "/session")
  if (!sessions || !Array.isArray(sessions)) return null
  // Members and helpers of earlier delegations may legitimately be busy —
  // they can never be creators, so only wakeable chat sessions compete.
  const candidates = sessions
    .filter(
      (row) =>
        typeof row?.id === "string" &&
        busy.has(row.id) &&
        wakeableSessionRow(row),
    )
    .map((row) => row.id as string)
  return candidates.length === 1 ? candidates[0] : null
}

// `--from` (the coordinating agent's own session id) wins when valid; a
// missing or invalid value falls back to busy-chat inference. A warning is
// surfaced to the caller so a wrong id is visible in the CLI output instead
// of silently disabling the wake.
export async function resolveDelegationCreator(
  base: string,
  headers: Record<string, string>,
  fromRaw: string,
): Promise<ResolvedCreator> {
  if (fromRaw) {
    const row = await fetchJson<{
      id?: unknown
      parentID?: unknown
      title?: unknown
    }>(base, headers, `/session/${encodeURIComponent(fromRaw)}`)
    if (row && wakeableSessionRow(row))
      return { creator: fromRaw, warning: null }
  }
  const inferred = await inferBusyChat(base, headers)
  if (!fromRaw) return { creator: inferred, warning: null }
  return {
    creator: inferred,
    warning: `--from ignored: ${fromRaw} is not a top-level chat session`,
  }
}

export function recordDelegation(
  db: Db,
  userId: string,
  kind: DelegationKind,
  creatorSessionId: string,
  subjectSessionId: string,
  councilId: string | null,
): void {
  db.createDelegationWatch({
    id: crypto.randomUUID(),
    userId,
    kind,
    creatorSessionId,
    subjectSessionId,
    councilId,
    createdAt: Date.now(),
    wokenAt: null,
    pending: false,
  })
}

// Dashboard read for the thread list's delegated-busy indicator: every
// delegation watch row as creator → subject pairs. The client lifts a hidden
// subject's busy state onto the creator's row (a council member's `worker:`
// thread never appears in the list, so the coordinating thread is the only
// place its activity can show). Cookie and LLM-token auth, like councils.
export function isDelegationsPath(pathname: string): boolean {
  return pathname === "/api/delegations"
}

export function handleDelegations(
  req: Request,
  url: URL,
  db: Db,
  user: User,
): Response | null {
  if (url.pathname !== "/api/delegations" || req.method !== "GET") return null
  const watches = db.delegationWatchesAll(user.id).map((row) => ({
    kind: row.kind,
    creator: row.creatorSessionId,
    subject: row.subjectSessionId,
    councilId: row.councilId,
  }))
  return Response.json({ watches })
}

export function dispatchDelegationWakes(
  db: Db,
  userId: string,
  event: { type?: unknown; properties?: unknown },
): void {
  const type = typeof event.type === "string" ? event.type : ""
  const sessionId = eventSessionId(event)
  if (!sessionId) return
  if (type === "session.idle") {
    void handleDelegationIdle(db, userId, sessionId)
    return
  }
  // Any other activity from a watched subject (a follow-up prompt, streamed
  // message parts) re-arms its rows so the next idle wakes again.
  db.rearmDelegation(userId, sessionId)
}

type StatusMap = Record<string, { type?: string }>

function isBusy(status: StatusMap, sessionId: string): boolean {
  const type = status[sessionId]?.type
  return Boolean(type && type !== "idle")
}

export async function handleDelegationIdle(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<void> {
  const rows = db.delegationWatchesBySubject(userId, sessionId)
  const pending = db.pendingDelegationWatches(userId, sessionId)
  if (rows.length === 0 && pending.length === 0) return
  const ctx = await opencodeContext(db, userId)
  if (!ctx) return
  const status =
    (await fetchJson<StatusMap>(ctx.base, ctx.headers, "/session/status")) ?? {}
  if (pending.length > 0) await deliver(db, userId, ctx, status, pending)
  const unwoken = rows.filter((row) => row.wokenAt === null && !row.pending)
  if (unwoken.length > 0) await deliver(db, userId, ctx, status, unwoken)
}

// Last assistant text part in a session's message list — the member's answer
// for the status view. Textless assistant messages (tool-call-only) are
// skipped; an unreadable list degrades to "".
export function lastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ""
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      info?: { role?: unknown }
      parts?: unknown
    } | null
    if (!message || typeof message !== "object") continue
    if (message.info?.role !== "assistant") continue
    if (!Array.isArray(message.parts)) continue
    const text = message.parts
      .map((part) =>
        part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim()
    if (text) return text.slice(-REPLY_TAIL)
  }
  return ""
}

type WatchRow = {
  id: string
  kind: DelegationKind
  creatorSessionId: string
  subjectSessionId: string
  councilId: string | null
  wokenAt: number | null
  pending: boolean
}

async function deliver(
  db: Db,
  userId: string,
  ctx: { base: string; headers: Record<string, string> },
  status: StatusMap,
  rows: WatchRow[],
): Promise<void> {
  const groups = new Map<
    string,
    {
      kind: DelegationKind
      creator: string
      councilId: string | null
      rows: WatchRow[]
    }
  >()
  for (const row of rows) {
    const key = `${row.kind}:${row.creatorSessionId}:${row.councilId ?? ""}`
    const group = groups.get(key) ?? {
      kind: row.kind,
      creator: row.creatorSessionId,
      councilId: row.councilId,
      rows: [],
    }
    group.rows.push(row)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    let rows2Wake: WatchRow[]
    if (group.kind === "council" && group.councilId) {
      const siblings = db.delegationWatchesByCouncil(userId, group.councilId)
      // Marking the whole group (not just the idling member's row) is what
      // makes the wake once-per-completion: a member that idled earlier in
      // this cycle must not re-arm a duplicate wake later. Pending rows are
      // included — they are the deferred delivery itself.
      rows2Wake = siblings.filter((row) => row.wokenAt === null)
      const allIdle = siblings.every(
        (row) => !isBusy(status, row.subjectSessionId),
      )
      if (!allIdle) continue
    } else {
      rows2Wake = group.rows
    }
    if (rows2Wake.length === 0) continue
    if (isBusy(status, group.creator)) {
      // The coordinator is mid-turn; deliver on its next idle instead of
      // injecting into a running conversation.
      db.markDelegationsPending(
        userId,
        rows2Wake.map((row) => row.id),
      )
      continue
    }
    const flightKey = `${userId}:${group.creator}`
    if (inFlight.has(flightKey)) continue
    inFlight.add(flightKey)
    try {
      const ok = await promptCreator(db, userId, ctx, group, rows2Wake)
      if (ok)
        db.markDelegationsWoken(
          userId,
          rows2Wake.map((row) => row.id),
          Date.now(),
        )
      else
        console.error(
          `delegation wake to ${group.creator} failed — rows stay armed`,
        )
    } finally {
      inFlight.delete(flightKey)
    }
  }
}

// Subject titles + last-reply tails for the wake text: the coordinator gets
// the report even before it reads anything, and the session ids it needs for
// `ob-thread read` are spelled out instead of assumed.
async function subjectSummaries(
  ctx: { base: string; headers: Record<string, string> },
  subjects: string[],
): Promise<Map<string, { title: string; reply: string }>> {
  const sessions = await fetchJson<{ id?: unknown; title?: unknown }[]>(
    ctx.base,
    ctx.headers,
    "/session",
  )
  const titles = new Map<string, string>()
  if (Array.isArray(sessions)) {
    for (const item of sessions) {
      if (typeof item?.id === "string" && typeof item.title === "string")
        titles.set(item.id, item.title.replace(/^worker:/, ""))
    }
  }
  const summaries = new Map<string, { title: string; reply: string }>()
  for (const id of subjects) {
    const messages = await fetchJson(
      ctx.base,
      ctx.headers,
      `/session/${encodeURIComponent(id)}/message`,
    )
    summaries.set(id, {
      title: titles.get(id) ?? "",
      reply: lastAssistantText(messages),
    })
  }
  return summaries
}

async function promptCreator(
  db: Db,
  userId: string,
  ctx: { base: string; headers: Record<string, string> },
  group: {
    kind: DelegationKind
    councilId: string | null
    rows: WatchRow[]
    creator: string
  },
  rowsToWake: WatchRow[],
): Promise<boolean> {
  const subjects = [
    ...new Set(
      (group.kind === "council" && group.councilId
        ? db.delegationWatchesByCouncil(userId, group.councilId)
        : rowsToWake
      ).map((row) => row.subjectSessionId),
    ),
  ]
  const summaries = await subjectSummaries(ctx, subjects)
  const text = wakeText(db, userId, group, subjects, summaries)
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text }],
  }
  await applyThinkingEffort(db, userId, body)
  const res = await fetch(
    `${ctx.base}/session/${encodeURIComponent(group.creator)}/prompt_async`,
    {
      method: "POST",
      headers: { ...ctx.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null)
  return Boolean(res?.ok)
}

function wakeText(
  db: Db,
  userId: string,
  group: {
    kind: DelegationKind
    councilId: string | null
    rows: WatchRow[]
    creator: string
  },
  subjects: string[],
  summaries: Map<string, { title: string; reply: string }>,
): string {
  if (group.kind === "persona") {
    const lines: string[] = []
    for (const id of subjects) {
      const summary = summaries.get(id)
      const label = summary?.title
        ? `"${summary.title}"`
        : "your delegated teammate"
      lines.push(`Teammate ${label} (${id}) finished its current work.`)
      lines.push(
        summary?.reply
          ? `Last reply:\n${summary.reply}`
          : "(no text reply — read the full transcript)",
      )
    }
    lines.push(
      "This is an automatic wake-up, not a user reply. Read the full transcript with `ob-thread read <session-id>` (the ids are above) — or the files you asked for — then report the outcome to the user in this thread. If a read says the session is gone, the workspace files are still there.",
    )
    return `[teammate] ${lines.join("\n")}`
  }
  const council = group.councilId
    ? db.councilById(group.councilId, userId)
    : null
  const name = council?.name ?? group.councilId ?? "council"
  const count = group.councilId
    ? db.delegationWatchesByCouncil(userId, group.councilId).length
    : subjects.length
  const idList = subjects
    .map((id) => {
      const summary = summaries.get(id)
      return summary?.title ? `${id} (${summary.title})` : id
    })
    .join(", ")
  return `[council: ${name}] All ${count} member${count === 1 ? "" : "s"} finished their work. This is an automatic wake-up, not a user reply. Member session ids: ${idList}. Read what they produced — \`ob-thread council status ${name}\` prints each member's status and last reply, \`ob-thread read <session-id>\` prints a transcript, and files you asked them to write are on disk — then report the outcome to the user in this thread. Close the team with \`ob-thread council close ${name}\` once the work is delivered.`
}
