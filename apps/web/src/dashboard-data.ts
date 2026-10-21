import type { QuotaState } from "./api"

/**
 * Pure helpers behind the Home dashboard. Everything here is a function of
 * already-fetched data so the tests can pin the behavior without a server:
 * which automations are "upcoming", which checklist steps remain, which
 * alerts are real, and how times read in fr-CA.
 */

/** Minimal shape read from /api/cron rows (superset compatible). */
export type JobLike = {
  id: string
  name: string
  enabled: boolean
  nextRunAt: number | null
  lastError: string | null
  plugin?: { id: string; name: string } | null
}

// ---- Composer seed (Home example prompts) ----------------------------------

const SEED_KEY = "ob-composer-seed"

/**
 * Staged text for a brand-new conversation's composer. Consumed exactly
 * once by the Workspace on mount; an existing draft is never overwritten
 * (the seed only fills an empty virgin composer).
 */
export function setComposerSeed(text: string): void {
  try {
    sessionStorage.setItem(SEED_KEY, text)
  } catch {
    // session-only nicety; ignore
  }
}

export function consumeComposerSeed(): string {
  try {
    const text = sessionStorage.getItem(SEED_KEY) ?? ""
    if (text) sessionStorage.removeItem(SEED_KEY)
    return text
  } catch {
    return ""
  }
}

/**
 * Read the staged seed WITHOUT consuming it. A draft blocks the seed, and
 * the resolution (replace or keep) is the user's explicit choice — the
 * composer can remount freely (the app rebuilds its subtree when async
 * state settles) without the blocked seed being lost or resurfacing.
 */
export function peekComposerSeed(): string {
  try {
    return sessionStorage.getItem(SEED_KEY) ?? ""
  } catch {
    return ""
  }
}

export function clearComposerSeed(): void {
  try {
    sessionStorage.removeItem(SEED_KEY)
  } catch {}
}

// ---- Recent conversations (passive /api/threads/recent) --------------------

export type RecentThread = {
  sessionId: string
  title: string
  createdAt: number
}

/**
 * How complete the recent list is:
 * - "full": the desktop's real session list, ordered by actual last
 *   activity — an empty list is a confirmed empty history.
 * - "titles": the control-plane name index only (desktop asleep or the
 *   real list unreachable). Threads are only indexed when they are NAMED,
 *   so an empty "titles" list proves nothing: it is unknown coverage,
 *   never a confirmed "no conversations".
 */
export type RecentCoverage = "full" | "titles"

export type RecentThreadsResult = {
  threads: RecentThread[]
  coverage: RecentCoverage
}

/**
 * Validate the summary payload; a malformed body is an error, not []. A
 * payload without a coverage marker (older server) is "titles" — the
 * conservative reading of an index-only source.
 */
export function parseRecentThreads(body: unknown): RecentThreadsResult {
  if (body == null || typeof body !== "object" || Array.isArray(body))
    throw new Error("unexpected response shape")
  const list = (body as { threads?: unknown }).threads
  if (!Array.isArray(list)) throw new Error("unexpected response shape")
  const coverage: RecentCoverage =
    (body as { coverage?: unknown }).coverage === "full" ? "full" : "titles"
  const out: RecentThread[] = []
  for (const item of list) {
    if (item == null || typeof item !== "object" || Array.isArray(item))
      continue
    const row = item as {
      sessionId?: unknown
      title?: unknown
      createdAt?: unknown
    }
    if (
      typeof row.sessionId === "string" &&
      row.sessionId &&
      typeof row.title === "string" &&
      typeof row.createdAt === "number" &&
      Number.isFinite(row.createdAt)
    )
      out.push({
        sessionId: row.sessionId,
        title: row.title,
        createdAt: row.createdAt,
      })
  }
  return { threads: out.slice(0, 5), coverage }
}

// ---- Upcoming automations ---------------------------------------------------

export type UpcomingJob = {
  id: string
  name: string
  nextRunAt: number
  lastError: string | null
}

/** A run this far in the past is overdue (an alert), not "upcoming". */
export const OVERDUE_GRACE_MS = 30 * 60_000

/**
 * Enabled plugin-free jobs with a real next run, soonest first. Runs past
 * now by more than OVERDUE_GRACE_MS are overdue — the alerts own them —
 * so the "À venir" cards never call a broken schedule "upcoming".
 */
export function pickUpcomingJobs(
  jobs: JobLike[],
  limit = 3,
  now = Date.now(),
): UpcomingJob[] {
  return jobs
    .filter(
      (job) =>
        job.enabled &&
        !job.plugin &&
        typeof job.nextRunAt === "number" &&
        job.nextRunAt > 0,
    )
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .filter((job) => (job.nextRunAt ?? 0) > now - OVERDUE_GRACE_MS)
    .slice(0, limit)
    .map((job) => ({
      id: job.id,
      name: job.name,
      nextRunAt: job.nextRunAt ?? 0,
      lastError: job.lastError,
    }))
}

/** Validate /api/cron; a wrong-shaped 200 is a contract error, never []. */
export function parseJobs(body: unknown): JobLike[] {
  if (!Array.isArray(body)) throw new Error("unexpected response shape")
  const out: JobLike[] = []
  for (const item of body) {
    if (item == null || typeof item !== "object" || Array.isArray(item))
      continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || !row.id) continue
    if (typeof row.name !== "string") continue
    // The full row is kept (kind, atMs, cronExpr, message… — CronView needs
    // them); only the envelope and identity are validated here.
    out.push(item as JobLike)
  }
  return out
}

/** A run later than this grace window is "late", stated as such. */
export function splitJobProblems(
  jobs: JobLike[],
  now = Date.now(),
): {
  failed: {
    id: string
    name: string
    lastError: string
    nextRunAt: number | null
    enabled: boolean
  }[]
  overdue: { id: string; name: string; nextRunAt: number }[]
} {
  const failed: {
    id: string
    name: string
    lastError: string
    nextRunAt: number | null
    enabled: boolean
  }[] = []
  const overdue: { id: string; name: string; nextRunAt: number }[] = []
  for (const job of jobs) {
    // A lastError is a real failure regardless of pause state, plugin origin
    // or position in the upcoming cap — the full source, not a slice.
    if (job.lastError)
      failed.push({
        id: job.id,
        name: job.name,
        lastError: job.lastError,
        nextRunAt: job.nextRunAt,
        enabled: job.enabled,
      })
    else if (
      job.enabled &&
      typeof job.nextRunAt === "number" &&
      job.nextRunAt > 0 &&
      job.nextRunAt < now - OVERDUE_GRACE_MS
    )
      overdue.push({ id: job.id, name: job.name, nextRunAt: job.nextRunAt })
  }
  return { failed, overdue }
}

// ---- Getting-started checklist ---------------------------------------------

export type ChecklistStepState = "done" | "todo" | "unknown"

export type ChecklistStep = {
  id: "model" | "first-thread"
  state: ChecklistStepState
  /** Convenience for existing renderers; state === "done". */
  done: boolean
  optional?: boolean
}

/**
 * Effective prerequisites only, with honest knowledge states: a usable model
 * selected (in team mode the admin's shared selection counts) and a first
 * conversation started — known only when the list actually loaded. An
 * unknown state never blocks the guide and never pushes an existing account
 * to "start their first conversation" because a list request failed.
 */
export function buildChecklist(input: {
  hasModel: boolean
  hasThreads: boolean
  threadsKnown: boolean
}): ChecklistStep[] {
  return [
    {
      id: "model",
      state: input.hasModel ? "done" : "todo",
      done: input.hasModel,
    },
    {
      id: "first-thread",
      state: !input.threadsKnown
        ? "unknown"
        : input.hasThreads
          ? "done"
          : "todo",
      done: input.threadsKnown && input.hasThreads,
    },
  ]
}

export function checklistComplete(steps: ChecklistStep[]): boolean {
  return steps.every((step) => step.state !== "todo")
}

// ---- Attention required -----------------------------------------------------

export type HomeAlert = {
  id: string
  severity: "error" | "warning"
  text: string
  actionLabel: string
  actionPath: string
}

/** Deep link to one automations job; parseRoute sees only the path. */
export function jobDeepLink(jobId: string): string {
  return `/automations?job=${encodeURIComponent(jobId)}`
}

/** Read the ?job= deep link back ("" when absent/invalid). */
export function jobIdFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("job")
  return typeof value === "string" && /^[\w:-]{1,80}$/.test(value) ? value : ""
}

/** Time-of-day label used inside alert texts. */
function frClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Real, actionable problems only — server-reported fields, never inferred
 * from message text. Derived from the FULL validated job list, capped at
 * three visible alerts with an honest "and N more" line when truncated.
 */
export function buildAlerts(input: {
  desktopError?: string | null
  quota?: QuotaState | null
  failedJobs: {
    id: string
    name: string
    lastError: string
    nextRunAt: number | null
    enabled: boolean
  }[]
  overdueJobs?: { id: string; name: string; nextRunAt: number }[]
}): HomeAlert[] {
  const alerts: HomeAlert[] = []
  if (input.desktopError)
    alerts.push({
      id: "desktop-error",
      severity: "error",
      text: `L’environnement n’a pas démarré : ${input.desktopError}`,
      actionLabel: "Voir l’environnement",
      actionPath: "/chat",
    })
  if (input.quota?.over)
    alerts.push({
      id: "quota",
      severity: input.quota.behavior === "block" ? "error" : "warning",
      text:
        input.quota.behavior === "block"
          ? "Le quota hebdomadaire est atteint. Les envois sont bloqués jusqu’au lundi suivant."
          : "Le quota hebdomadaire est dépassé; les envois continuent en avertissement.",
      actionLabel: "Voir les détails",
      actionPath: "/config/keys",
    })
  for (const job of input.failedJobs) {
    const scheduled =
      job.enabled && typeof job.nextRunAt === "number" && job.nextRunAt > 0
    alerts.push({
      id: `cron-${job.id}`,
      severity: "warning",
      text: scheduled
        ? `L’automatisation « ${job.name} » a échoué. Prochaine exécution maintenue à ${frClock(job.nextRunAt ?? 0)}.`
        : `L’automatisation « ${job.name} » a échoué et n’a pas d’exécution programmée.`,
      actionLabel: "Voir l’automatisation",
      actionPath: jobDeepLink(job.id),
    })
  }
  for (const job of input.overdueJobs ?? []) {
    alerts.push({
      id: `cron-late-${job.id}`,
      severity: "warning",
      text: `L’automatisation « ${job.name} » est en retard — elle s’exécutera dès que l’environnement reprend.`,
      actionLabel: "Voir l’automatisation",
      actionPath: jobDeepLink(job.id),
    })
  }
  if (alerts.length > 3) {
    const extra = alerts.length - 3
    const kept = alerts.slice(0, 2)
    kept.push({
      id: "alerts-more",
      severity: "warning",
      text: `${extra + 1} autres éléments demandent votre attention.`,
      actionLabel: "Tout voir",
      actionPath: "/automations",
    })
    return kept
  }
  return alerts
}

// ---- fr-CA time labels -------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat("fr-CA", { numeric: "auto" })

/** "à l’instant", "il y a 5 min", "il y a 2 h", "hier", then a short date. */
export function formatFrAgo(ts: number, now = Date.now()): string {
  if (!ts) return ""
  const minutes = Math.round((now - ts) / 60_000)
  if (minutes < 1) return "à l’instant"
  if (minutes < 60) return rtf.format(-minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, "hour")
  const days = Math.round(hours / 24)
  if (days < 7) return rtf.format(-days, "day")
  return new Date(ts).toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "short",
  })
}

/**
 * Recent-threads caption. The source stores when the thread was NAMED, not
 * its last activity — the label says exactly that instead of pretending.
 */
export function formatFrNamedAgo(ts: number, now = Date.now()): string {
  const ago = formatFrAgo(ts, now)
  return ago ? `nommée ${ago}` : ""
}

/** "18 oct., 09:00 (HAE)" — the zone abbreviation is part of the truth. */
export function formatFrWhen(ts: number | null): string {
  if (!ts) return "—"
  const formatted = new Date(ts).toLocaleString("fr-CA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
  const zone = new Date(ts)
    .toLocaleTimeString("fr-CA", { timeZoneName: "short" })
    .match(/\s([^\s]+)$/)?.[1]
  return zone ? `${formatted} (${zone})` : formatted
}

// ---- datetime-local roundtrip (one-shot schedule edit) ----------------------

/**
 * Instant → <input type="datetime-local"> value in the VIEWER'S zone. Not
 * toISOString().slice — that would relabel UTC as local and shift the
 * instant by the zone offset.
 */
export function atMsToLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local value → instant (local zone), null when malformed. */
export function localInputToMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : null
}
