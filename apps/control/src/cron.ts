import type { CronJob, Db } from "@open-bot/db"
import { endpoint, startDesktop } from "./docker"

const MINUTE_MS = 60_000
const SWEEP_MS = 30_000
const SEARCH_LIMIT_MS = 4 * 366 * 24 * 60 * 60 * 1000

type CronFields = {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domStar: boolean
  dowStar: boolean
}

function parseField(
  field: string,
  min: number,
  max: number,
  name: string,
): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(",")) {
    if (part === "") throw new Error(`empty item in ${name} field`)
    const slash = part.indexOf("/")
    const range = slash === -1 ? part : part.slice(0, slash)
    const stepText = slash === -1 ? undefined : part.slice(slash + 1)
    const step = stepText === undefined ? 1 : Number.parseInt(stepText, 10)
    if (
      stepText !== undefined &&
      (!Number.isInteger(step) || String(step) !== stepText || step < 1)
    ) {
      throw new Error(`invalid step in ${name} field`)
    }
    let lo = min
    let hi = max
    if (range !== "*" && range !== "") {
      const dash = range.indexOf("-")
      const loText = dash === -1 ? range : range.slice(0, dash)
      const hiText = dash === -1 ? undefined : range.slice(dash + 1)
      lo = Number.parseInt(loText, 10)
      if (!Number.isInteger(lo) || String(lo) !== loText)
        throw new Error(`invalid value in ${name} field`)
      if (hiText === undefined) {
        hi = slash === -1 ? lo : max
      } else {
        hi = Number.parseInt(hiText, 10)
        if (!Number.isInteger(hi) || String(hi) !== hiText)
          throw new Error(`invalid value in ${name} field`)
      }
    }
    if (lo < min || hi > max || lo > hi)
      throw new Error(`${name} field out of range (${min}-${max})`)
    for (let value = lo; value <= hi; value += step) values.add(value)
  }
  return values
}

/** Parse a 5-field cron expression (minute hour dom month dow, UTC). */
export function parseCron(expr: string): CronFields {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5)
    throw new Error("cron expression must have exactly 5 fields")
  const dow = parseField(fields[4] ?? "", 0, 7, "day-of-week")
  if (dow.has(7)) {
    dow.delete(7)
    dow.add(0)
  }
  return {
    minute: parseField(fields[0] ?? "", 0, 59, "minute"),
    hour: parseField(fields[1] ?? "", 0, 23, "hour"),
    dom: parseField(fields[2] ?? "", 1, 31, "day-of-month"),
    month: parseField(fields[3] ?? "", 1, 12, "month"),
    dow,
    domStar: (fields[2] ?? "") === "*",
    dowStar: (fields[4] ?? "") === "*",
  }
}

/** Next matching minute strictly after afterMs, or null within ~4 years. */
export function nextCronTime(expr: string, afterMs: number): number | null {
  let fields: CronFields
  try {
    fields = parseCron(expr)
  } catch {
    return null
  }
  const limit = afterMs + SEARCH_LIMIT_MS
  let t = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS
  while (t <= limit) {
    const d = new Date(t)
    if (!fields.month.has(d.getUTCMonth() + 1)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      continue
    }
    const domOk = fields.domStar || fields.dom.has(d.getUTCDate())
    const dowOk = fields.dowStar || fields.dow.has(d.getUTCDay())
    const dayOk =
      fields.domStar && fields.dowStar
        ? true
        : fields.domStar
          ? dowOk
          : fields.dowStar
            ? domOk
            : domOk || dowOk
    if (!dayOk) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
      continue
    }
    if (!fields.hour.has(d.getUTCHours())) {
      t = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours() + 1,
      )
      continue
    }
    if (!fields.minute.has(d.getUTCMinutes())) {
      t += MINUTE_MS
      continue
    }
    return t
  }
  return null
}

/** When the job should run next, or null when it never runs again. */
export function nextRunMs(job: CronJob, fromMs = Date.now()): number | null {
  if (job.kind === "every") {
    if (!job.everySeconds || job.everySeconds < 1) return null
    return fromMs + job.everySeconds * 1000
  }
  if (job.kind === "cron")
    return job.cronExpr ? nextCronTime(job.cronExpr, fromMs) : null
  return job.atMs
}

/** Deliver a job's prompt to the user's opencode agent; returns an error message or null. */
export async function fireCronJob(
  db: Db,
  job: CronJob,
  manual = false,
): Promise<string | null> {
  if (!manual) {
    db.setCronNextRun(job.id, job.kind === "at" ? null : nextRunMs(job))
  }
  let error: string | null = null
  try {
    const account = db.userById(job.userId)
    if (!account || account.disabled) throw new Error("account unavailable")
    const desktop = db.desktop(job.userId)
    if (!desktop) throw new Error("desktop record missing")
    await startDesktop(
      job.userId,
      desktop,
      db.getVikingProvider(job.userId),
      db.getImageProvider(job.userId),
    )
    db.touchDesktop(job.userId)
    const headers = {
      authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
      "content-type": "application/json",
    }
    const base = await endpoint(job.userId, "opencode", 4096)

    let sessionId = job.sessionId
    if (sessionId) {
      const check = await fetch(`${base}/session/${sessionId}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      if (!check.ok) sessionId = null
    }
    if (!sessionId) {
      const created = await fetch(`${base}/session`, {
        method: "POST",
        headers,
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      })
      if (!created.ok)
        throw new Error(`session create failed (${created.status})`)
      const body = (await created.json()) as { id?: string }
      if (!body.id) throw new Error("session create returned no id")
      sessionId = body.id
      db.setCronSession(job.id, sessionId)
      await fetch(`${base}/session/${sessionId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ title: job.name }),
        signal: AbortSignal.timeout(10_000),
      })
    }

    const prompt = await fetch(`${base}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        parts: [{ type: "text", text: `[cron: ${job.name}]\n${job.message}` }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!prompt.ok) throw new Error(`prompt failed (${prompt.status})`)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "cron run failed"
  }
  db.recordCronRun(job.id, error)
  if (!error && job.deleteAfterRun) db.deleteCronJob(job.id, job.userId)
  return error
}

export function startCronScheduler(db: Db) {
  let sweeping = false
  return setInterval(() => {
    if (sweeping) return
    sweeping = true
    void (async () => {
      try {
        for (const job of db.dueCronJobs(Date.now())) {
          await fireCronJob(db, job)
        }
      } catch {
        // per-job errors are recorded on the job; keep the loop alive
      } finally {
        sweeping = false
      }
    })()
  }, SWEEP_MS)
}
