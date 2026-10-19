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
const NEW_THREAD_KEY = "ob-new-thread"

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
 * "Open a blank conversation" intent: the next Workspace mount must not
 * restore the last thread. Session-scoped so a later plain /chat visit
 * still restores normally.
 */
export function markNewThreadIntent(): void {
  try {
    sessionStorage.setItem(NEW_THREAD_KEY, "1")
  } catch {
    // without storage the restore simply happens; harmless
  }
}

export function consumeNewThreadIntent(): boolean {
  try {
    const flag = sessionStorage.getItem(NEW_THREAD_KEY) === "1"
    if (flag) sessionStorage.removeItem(NEW_THREAD_KEY)
    return flag
  } catch {
    return false
  }
}

// ---- Recent conversations (passive /api/threads/recent) --------------------

export type RecentThread = {
  sessionId: string
  title: string
  createdAt: number
}

/** Validate the summary payload; a malformed body is an error, not []. */
export function parseRecentThreads(body: unknown): RecentThread[] {
  const list = (body as { threads?: unknown } | null)?.threads
  if (!Array.isArray(list)) throw new Error("unexpected response shape")
  const out: RecentThread[] = []
  for (const item of list) {
    const row = item as {
      sessionId?: unknown
      title?: unknown
      createdAt?: unknown
    }
    if (
      typeof row.sessionId === "string" &&
      row.sessionId &&
      typeof row.title === "string" &&
      typeof row.createdAt === "number"
    )
      out.push({
        sessionId: row.sessionId,
        title: row.title,
        createdAt: row.createdAt,
      })
  }
  return out.slice(0, 5)
}

// ---- Upcoming automations ---------------------------------------------------

export type UpcomingJob = {
  id: string
  name: string
  nextRunAt: number
  lastError: string | null
}

/**
 * Enabled jobs with a real next run, soonest first. Paused/errored/never
 * scheduled jobs are deliberately not "upcoming" — the Automations view
 * owns those states.
 */
export function pickUpcomingJobs(jobs: JobLike[], limit = 3): UpcomingJob[] {
  return jobs
    .filter(
      (job) =>
        job.enabled &&
        !job.plugin &&
        typeof job.nextRunAt === "number" &&
        job.nextRunAt > 0,
    )
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, limit)
    .map((job) => ({
      id: job.id,
      name: job.name,
      nextRunAt: job.nextRunAt ?? 0,
      lastError: job.lastError,
    }))
}

// ---- Getting-started checklist ---------------------------------------------

export type ChecklistStep = {
  id: "model" | "first-thread" | "app"
  done: boolean
  optional?: boolean
}

/**
 * Effective prerequisites only: a usable model selected (in team mode the
 * admin's shared selection counts — no personal key demanded) and a first
 * conversation started. The app step is optional and never blocks.
 */
export function buildChecklist(input: {
  hasModel: boolean
  hasThreads: boolean
}): ChecklistStep[] {
  return [
    { id: "model", done: input.hasModel },
    { id: "first-thread", done: input.hasThreads },
    { id: "app", done: false, optional: true },
  ]
}

export function checklistComplete(steps: ChecklistStep[]): boolean {
  return steps.filter((step) => !step.optional).every((step) => step.done)
}

// ---- Attention required -----------------------------------------------------

export type HomeAlert = {
  id: string
  severity: "error" | "warning"
  text: string
  actionLabel: string
  actionPath: string
}

/**
 * Real, actionable problems only — server-reported fields, never inferred
 * from message text. Cap three; the exact context is one click away.
 */
export function buildAlerts(input: {
  desktopError?: string | null
  quota?: QuotaState | null
  failedJobs: { id: string; name: string; lastError: string | null }[]
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
      actionPath: "/config",
    })
  for (const job of input.failedJobs) {
    if (alerts.length >= 3) break
    alerts.push({
      id: `cron-${job.id}`,
      severity: "warning",
      text: `L’automatisation « ${job.name} » a échoué.`,
      actionLabel: "Voir l’automatisation",
      actionPath: "/automations",
    })
  }
  return alerts.slice(0, 3)
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
