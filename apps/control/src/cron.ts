import type { CronJob, CronNotice, Db } from "@open-bot/db"
import { desktopPhase, endpoint, startDesktop } from "./docker"
import { ensureThreadScreen, stopThreadScreen } from "./screens"

const MINUTE_MS = 60_000
const SWEEP_MS = 30_000
const SEARCH_LIMIT_MS = 4 * 366 * 24 * 60 * 60 * 1000
const PUBLISH_TIMEOUT_MS = 20 * 60 * 1000
const PUBLISH_GRACE_MS = 8_000
const PUBLISH_IDLE_MS = 20_000
const SUMMARY_LIMIT = 500

const PUBLISH_LINE =
  "Do this work in this temporary session. End with what you did and what you found. Do not create another thread. This session is deleted after the result is copied to the user's thread."

export const CRON_RUN_TITLE = "cron-run:"

export function cronResultMessage(name: string, summary: string): string {
  return `[cron-result: ${name}]\n\n${summary}`
}

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

export function cronPrompt(job: Pick<CronJob, "name" | "message">): string {
  return `[cron: ${job.name}]\n${job.message}\n\n${PUBLISH_LINE}`
}

type PublishInput = {
  now: number
  startedAt: number
  desktopUp: boolean
  sessionMissing: boolean
  busy: boolean
  seenBusy: boolean
  summary: string | null
}

/** Whether a fired cron run is ready to notify the user. */
export function publishDecision(input: PublishInput): "wait" | "settle" {
  const age = input.now - input.startedAt
  if (input.summary) return "settle"
  if (!input.desktopUp) return age >= PUBLISH_TIMEOUT_MS ? "settle" : "wait"
  if (input.busy) return age >= PUBLISH_TIMEOUT_MS ? "settle" : "wait"
  if (input.sessionMissing && age >= PUBLISH_GRACE_MS) return "settle"
  if (input.seenBusy && age >= PUBLISH_IDLE_MS) return "settle"
  if (age >= PUBLISH_TIMEOUT_MS) return "settle"
  return "wait"
}

function clip(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  if (trimmed.length <= SUMMARY_LIMIT) return trimmed
  return `${trimmed.slice(0, SUMMARY_LIMIT - 1)}…`
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const parts = (message as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part): part is { text: string } => {
      if (!part || typeof part !== "object") return false
      const row = part as {
        type?: string
        text?: string
        synthetic?: boolean
        ignored?: boolean
      }
      if (row.synthetic || row.ignored) return false
      if (row.type && row.type !== "text") return false
      return typeof row.text === "string" && row.text.length > 0
    })
    .map((part) => part.text)
    .join("\n\n")
}

/** Last finished assistant reply posted after the cron prompt. */
export function publishedSummary(
  messages: unknown,
  afterMs: number,
): string | null {
  if (!Array.isArray(messages)) return null
  let best: { at: number; text: string } | null = null
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const info = (
      message as {
        info?: {
          role?: string
          summary?: unknown
          time?: { created?: number; completed?: number }
        }
      }
    ).info
    if (!info || info.role !== "assistant" || info.summary === true) continue
    if (info.time?.completed == null) continue
    const created = info.time.created ?? 0
    if (created < afterMs - 5_000) continue
    const text = messageText(message).trim()
    if (!text) continue
    if (!best || created >= best.at) best = { at: created, text }
  }
  return best ? clip(best.text) : null
}

function sessionBusy(status: unknown, sessionId: string): boolean {
  if (!status || typeof status !== "object") return false
  const row = (status as Record<string, { type?: string }>)[sessionId]
  return Boolean(row?.type && row.type !== "idle")
}

function noticeText(input: {
  summary: string | null
  sessionMissing: boolean
}): string {
  if (input.summary) return input.summary
  if (input.sessionMissing)
    return "The thread was removed before a result was published."
  return "The job finished, but no result was published."
}

async function readPublish(
  base: string,
  sessionId: string,
  headers: Record<string, string>,
  afterMs: number,
): Promise<{ missing: boolean; busy: boolean; summary: string | null }> {
  const session = await fetch(`${base}/session/${sessionId}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!session.ok) return { missing: true, busy: false, summary: null }
  const [statusRes, messageRes] = await Promise.all([
    fetch(`${base}/session/status`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${base}/session/${sessionId}/message`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }),
  ])
  const status = statusRes.ok ? await statusRes.json() : null
  const messages = messageRes.ok ? await messageRes.json() : null
  return {
    missing: false,
    busy: sessionBusy(status, sessionId),
    summary: publishedSummary(messages, afterMs),
  }
}

const settling = new Set<string>()

async function opencodeJson(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
) {
  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(
      init?.method && init.method !== "GET" ? 30_000 : 10_000,
    ),
  })
  return res
}

async function sessionLive(
  base: string,
  headers: Record<string, string>,
  sessionId: string,
) {
  const check = await opencodeJson(`${base}/session/${sessionId}`, headers)
  return check.ok
}

async function createSession(
  base: string,
  headers: Record<string, string>,
  title: string,
  parentID?: string,
) {
  const created = await opencodeJson(`${base}/session`, headers, {
    method: "POST",
    body: JSON.stringify(parentID ? { parentID, title } : { title }),
  })
  if (!created.ok) throw new Error(`session create failed (${created.status})`)
  const body = (await created.json()) as { id?: string }
  if (!body.id) throw new Error("session create returned no id")
  if (!parentID) {
    await opencodeJson(`${base}/session/${body.id}`, headers, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })
  }
  return body.id
}

async function ensureDeliveryThread(
  base: string,
  headers: Record<string, string>,
  sessionId: string | null,
  title: string,
) {
  if (sessionId && (await sessionLive(base, headers, sessionId)))
    return sessionId
  return createSession(base, headers, title)
}

async function postCronResult(
  base: string,
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  summary: string,
) {
  const posted = await opencodeJson(
    `${base}/session/${sessionId}/prompt_async`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        noReply: true,
        parts: [{ type: "text", text: cronResultMessage(name, summary) }],
      }),
    },
  )
  if (!posted.ok) throw new Error(`result post failed (${posted.status})`)
}

async function deleteRunSession(
  db: Db,
  userId: string,
  base: string,
  headers: Record<string, string>,
  sessionId: string,
) {
  await stopThreadScreen(db, userId, sessionId)
  await opencodeJson(`${base}/session/${sessionId}`, headers, {
    method: "DELETE",
  })
}

async function settleCronNotice(
  db: Db,
  notice: CronNotice,
  opts: { force?: boolean; seenBusy?: boolean } = {},
): Promise<{ done: boolean; busy: boolean }> {
  if (notice.summary) return { done: true, busy: false }
  if (settling.has(notice.id)) return { done: false, busy: false }
  settling.add(notice.id)
  try {
    const current = db.cronNoticeById(notice.id)
    if (!current || current.summary) return { done: true, busy: false }
    const account = db.userById(current.userId)
    const desktop = db.desktop(current.userId)
    const phase =
      account && !account.disabled && desktop
        ? await desktopPhase(current.userId)
        : "sleeping"
    let desktopUp = phase === "running"
    let missing = !current.runSessionId
    let busy = false
    let summary: string | null = null
    const headers = desktop
      ? {
          authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
          "content-type": "application/json",
        }
      : null
    const readRun = async () => {
      if (!desktopUp || !desktop || !headers || !current.runSessionId) return
      const base = await endpoint(current.userId, "opencode", 4096)
      const read = await readPublish(
        base,
        current.runSessionId,
        headers,
        current.createdAt,
      )
      missing = read.missing
      busy = read.busy
      summary = read.summary
    }
    await readRun()
    const decision = opts.force
      ? "settle"
      : publishDecision({
          now: Date.now(),
          startedAt: current.createdAt,
          desktopUp,
          sessionMissing: missing,
          busy,
          seenBusy: Boolean(opts.seenBusy || busy),
          summary,
        })
    if (decision === "wait") return { done: false, busy }
    if (!account || account.disabled || !desktop || !headers)
      throw new Error("account unavailable")
    if (!desktopUp) {
      await startDesktop(
        current.userId,
        desktop,
        db.getVikingProvider(current.userId),
        db.getImageProvider(current.userId),
      )
      desktopUp = true
      await readRun()
    }
    const text = noticeText({ summary, sessionMissing: missing })
    const base = await endpoint(current.userId, "opencode", 4096)
    const delivery = await ensureDeliveryThread(
      base,
      headers,
      current.sessionId,
      current.jobName,
    )
    if (delivery !== current.sessionId) {
      db.setCronNoticeSession(current.id, delivery)
      if (db.cronJobById(current.jobId, current.userId))
        db.setCronSession(current.jobId, delivery)
    }
    await postCronResult(base, headers, delivery, current.jobName, text)
    if (current.runSessionId) {
      await deleteRunSession(
        db,
        current.userId,
        base,
        headers,
        current.runSessionId,
      )
    }
    db.settleCronNotice(current.id, text)
    return { done: true, busy }
  } finally {
    settling.delete(notice.id)
  }
}

async function watchCronPublish(db: Db, noticeId: string) {
  try {
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    let seenBusy = false
    while (Date.now() < deadline) {
      const notice = db.cronNoticeById(noticeId)
      if (!notice || notice.summary) return
      try {
        const settled = await settleCronNotice(db, notice, { seenBusy })
        if (settled.busy) seenBusy = true
        if (settled.done) return
      } catch {
        await Bun.sleep(2_000)
        continue
      }
      await Bun.sleep(2_000)
    }
    const notice = db.cronNoticeById(noticeId)
    if (!notice || notice.summary) return
    await settleCronNotice(db, notice, { force: true, seenBusy })
  } catch {
    return
  }
}

export async function settleCronNotices(db: Db) {
  for (const notice of db.pendingCronNotices()) {
    try {
      await settleCronNotice(db, notice)
    } catch {}
  }
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

    const sessionId = await ensureDeliveryThread(
      base,
      headers,
      job.sessionId,
      job.name,
    )
    if (sessionId !== job.sessionId) db.setCronSession(job.id, sessionId)
    const runSessionId = await createSession(
      base,
      headers,
      `${CRON_RUN_TITLE} ${job.name}`,
      sessionId,
    )
    const screen = await ensureThreadScreen(db, job.userId, runSessionId)
    const prompt = await opencodeJson(
      `${base}/session/${runSessionId}/prompt_async`,
      headers,
      {
        method: "POST",
        body: JSON.stringify({
          parts: [{ type: "text", text: cronPrompt(job) }],
          system: screen.system,
        }),
      },
    )
    if (!prompt.ok) {
      await deleteRunSession(db, job.userId, base, headers, runSessionId)
      throw new Error(`prompt failed (${prompt.status})`)
    }
    const noticeId = crypto.randomUUID()
    db.createCronNotice({
      id: noticeId,
      userId: job.userId,
      jobId: job.id,
      jobName: job.name,
      sessionId,
      runSessionId,
      summary: null,
      createdAt: Date.now(),
      viewedAt: null,
    })
    void watchCronPublish(db, noticeId)
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
        await settleCronNotices(db)
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
