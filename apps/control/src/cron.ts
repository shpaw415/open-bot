import type { CronJob, CronNotice, CronRunKind, Db } from "@open-bot/db"
import { desktopPhase, endpoint, opencodeScript, startDesktop } from "./docker"
import type { EventHub } from "./events"
import { personaSystem, resolvePersona } from "./personas"
import { ensureThreadScreen, stopThreadScreen } from "./screens"

const MINUTE_MS = 60_000
const SWEEP_MS = 30_000
const SEARCH_LIMIT_MS = 4 * 366 * 24 * 60 * 60 * 1000
const PUBLISH_TIMEOUT_MS = 20 * 60 * 1000
const PUBLISH_GRACE_MS = 8_000
const PUBLISH_IDLE_MS = 20_000
const SUMMARY_LIMIT = 500
const SCRIPT_TIMEOUT_MS = 120_000
const SCRIPT_OUTPUT_LIMIT = 12_000
const SCRIPT_STORE_LIMIT = 16_000
const MESSAGE_LIMIT = 4_000

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

export function cronPrompt(
  job: Pick<CronJob, "name" | "message"> & {
    scriptOutput?: string
    scriptExit?: number | null
  },
): string {
  const script =
    job.scriptOutput === undefined
      ? ""
      : `\n\nScript output (exit ${job.scriptExit ?? "unknown"}):\n${job.scriptOutput}`
  return `[cron: ${job.name}]\n${job.message}${script}\n\n${PUBLISH_LINE}`
}

export function parseRunKind(value: unknown): CronRunKind | null {
  if (value === "prompt" || value === "script" || value === "both") return value
  return null
}

export function normalizeCronRun(input: {
  runKind: CronRunKind
  message: string
  script: string | null
}): { message: string; script: string | null } | { error: string } {
  const message = input.message.trim().slice(0, MESSAGE_LIMIT)
  const scriptRaw = input.script?.trim() ?? ""
  if (scriptRaw.length > SCRIPT_STORE_LIMIT)
    return { error: "script is too long" }
  const script = scriptRaw || null
  if (input.runKind !== "script" && !message)
    return { error: "message is required" }
  if (input.runKind !== "prompt" && !script)
    return { error: "script is required" }
  return { message, script }
}

export function joinScriptOutput(stdout: string, stderr: string): string {
  const out = stdout.replace(/\s+$/, "")
  const err = stderr.replace(/\s+$/, "")
  if (out && err) return `${out}\n${err}`
  return out || err
}

export function clipScriptOutput(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  if (normalized.length <= SCRIPT_OUTPUT_LIMIT) return normalized
  return `${normalized.slice(0, SCRIPT_OUTPUT_LIMIT - 1)}…`
}

const EXEC_FAILURE =
  /Error response from daemon|No such container|Cannot connect to the Docker daemon|executable file not found|unable to start container|is not running/i

export type ScriptRun = {
  started: boolean
  code: number | null
  timedOut: boolean
  output: string
  error: string | null
}

export function interpretScriptRun(input: {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError: string | null
}): ScriptRun {
  const output = joinScriptOutput(input.stdout, input.stderr)
  if (input.timedOut) {
    return {
      started: true,
      code: input.code,
      timedOut: true,
      output,
      error: "script timed out",
    }
  }
  if (input.spawnError) {
    return {
      started: false,
      code: input.code,
      timedOut: input.timedOut,
      output,
      error: input.spawnError,
    }
  }
  if (!input.timedOut && input.code !== 0 && EXEC_FAILURE.test(input.stderr)) {
    return {
      started: false,
      code: input.code,
      timedOut: false,
      output,
      error: input.stderr.trim() || "script failed to start",
    }
  }
  return {
    started: true,
    code: input.code,
    timedOut: input.timedOut,
    output,
    error: input.timedOut ? "script timed out" : null,
  }
}

export function scriptBlocksAgent(ran: ScriptRun): string | null {
  if (!ran.started) return ran.error ?? "script failed to start"
  if (ran.timedOut) return "script timed out"
  if (ran.code == null) return "script failed"
  return null
}

export function scriptJobError(ran: ScriptRun): string | null {
  const blocked = scriptBlocksAgent(ran)
  if (blocked) return blocked
  if (ran.code !== 0) return `script exited ${ran.code}`
  return null
}

export function scriptThreadText(ran: ScriptRun): string {
  const body = clipScriptOutput(ran.output)
  if (!ran.started) {
    const detail = ran.error ?? "The script could not run."
    return body ? `${body}\n\n${detail}` : detail
  }
  if (ran.timedOut)
    return body ? `${body}\n\nThe script timed out.` : "The script timed out."
  if (!body) {
    return ran.code === 0
      ? "The script finished with no output."
      : `The script exited ${ran.code ?? "unknown"} with no output.`
  }
  return body
}

export function splitModelRef(
  value: string,
): { providerId: string; modelId: string } | { error: string } {
  const trimmed = value.trim()
  const split = trimmed.indexOf("/")
  if (split <= 0) return { error: "model must be provider/model" }
  const providerId = trimmed.slice(0, split).trim()
  const modelId = trimmed.slice(split + 1).trim()
  if (
    !providerId ||
    !modelId ||
    /\s/.test(providerId) ||
    /\s/.test(modelId) ||
    providerId.length > 80 ||
    modelId.length > 200
  )
    return { error: "model must be provider/model" }
  return { providerId, modelId }
}

/** Model fields from a create/update body. Omitted means leave unchanged. */
export function cronModelFields(
  body: Record<string, unknown>,
):
  | { omitted: true }
  | { providerId: string | null; modelId: string | null }
  | { error: string } {
  const pair =
    "providerID" in body ||
    "modelID" in body ||
    "providerId" in body ||
    "modelId" in body
  const combined = "model" in body
  if (!pair && !combined) return { omitted: true }
  if (pair) {
    const providerKey = "providerID" in body ? body.providerID : body.providerId
    const modelKey = "modelID" in body ? body.modelID : body.modelId
    if (
      (providerKey === null || providerKey === "") &&
      (modelKey === null || modelKey === "")
    )
      return { providerId: null, modelId: null }
    const providerId = String(providerKey ?? "").trim()
    const modelId = String(modelKey ?? "").trim()
    if (
      !providerId ||
      !modelId ||
      /\s/.test(providerId) ||
      /\s/.test(modelId) ||
      providerId.length > 80 ||
      modelId.length > 200
    )
      return { error: "provider and model are both required" }
    return { providerId, modelId }
  }
  if (body.model === null || String(body.model).trim() === "")
    return { providerId: null, modelId: null }
  return splitModelRef(String(body.model))
}

/** Personality from a create/update body. Empty or assistant stores null. */
export function cronPersonaFields(
  body: Record<string, unknown>,
  exists: (id: string) => boolean,
): { omitted: true } | { personaId: string | null } | { error: string } {
  if (!("personaId" in body)) return { omitted: true }
  const raw = body.personaId
  if (raw === null || raw === undefined) return { personaId: null }
  const id = String(raw).trim()
  if (!id || id === "assistant") return { personaId: null }
  if (id.length > 80 || !exists(id)) return { error: "personality not found" }
  return { personaId: id }
}

export function cronRunBody(input: {
  name: string
  message: string
  providerId: string | null
  modelId: string | null
  screenSystem: string
  personaLine: string | null
  scriptOutput?: string
  scriptExit?: number | null
}) {
  const system = [input.screenSystem, input.personaLine]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
  const body: {
    parts: { type: "text"; text: string }[]
    system: string
    model?: { providerID: string; modelID: string }
  } = {
    parts: [
      {
        type: "text",
        text: cronPrompt({
          name: input.name,
          message: input.message,
          scriptOutput: input.scriptOutput,
          scriptExit: input.scriptExit,
        }),
      },
    ],
    system,
  }
  if (input.providerId && input.modelId)
    body.model = { providerID: input.providerId, modelID: input.modelId }
  return body
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

async function postDirectResult(
  db: Db,
  hub: EventHub | undefined,
  job: CronJob,
  base: string,
  headers: Record<string, string>,
  sessionId: string,
  text: string,
) {
  await postCronResult(base, headers, sessionId, job.name, text)
  db.createCronNotice({
    id: crypto.randomUUID(),
    userId: job.userId,
    jobId: job.id,
    jobName: job.name,
    sessionId,
    runSessionId: null,
    summary: clip(text),
    createdAt: Date.now(),
    viewedAt: null,
  })
  hub?.emit(job.userId, { type: "cron.notices" })
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
  hub?: EventHub,
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
        db.getSystem1(current.userId),
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
    hub?.emit(current.userId, { type: "cron.notices" })
    return { done: true, busy }
  } finally {
    settling.delete(notice.id)
  }
}

async function watchCronPublish(db: Db, noticeId: string, hub?: EventHub) {
  try {
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    let seenBusy = false
    while (Date.now() < deadline) {
      const notice = db.cronNoticeById(noticeId)
      if (!notice || notice.summary) return
      try {
        const settled = await settleCronNotice(db, notice, { seenBusy }, hub)
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
    await settleCronNotice(db, notice, { force: true, seenBusy }, hub)
  } catch {
    return
  }
}

export async function settleCronNotices(db: Db, hub?: EventHub) {
  for (const notice of db.pendingCronNotices()) {
    try {
      await settleCronNotice(db, notice, {}, hub)
    } catch {}
  }
}

/** Run a due job and publish into its thread. Returns an error message or null. */
export async function fireCronJob(
  db: Db,
  job: CronJob,
  manual = false,
  hub?: EventHub,
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
      db.getSystem1(job.userId),
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
    const runKind =
      job.runKind === "script" || job.runKind === "both"
        ? job.runKind
        : "prompt"
    let personaLine: string | null = null
    if (runKind !== "script" && job.personaId) {
      const persona = resolvePersona(db, job.userId, job.personaId)
      if (!persona) throw new Error("personality not found")
      personaLine = personaSystem(persona)
    }
    let scriptOutput: string | undefined
    let scriptExit: number | null | undefined
    if (runKind !== "prompt") {
      if (!job.script?.trim()) throw new Error("script is empty")
      const ran = interpretScriptRun(
        await opencodeScript(job.userId, job.script, SCRIPT_TIMEOUT_MS),
      )
      if (runKind === "script" || scriptBlocksAgent(ran)) {
        await postDirectResult(
          db,
          hub,
          job,
          base,
          headers,
          sessionId,
          scriptThreadText(ran),
        )
        error = scriptJobError(ran)
      } else {
        scriptOutput = clipScriptOutput(ran.output)
        scriptExit = ran.code
      }
    }
    if (!error && runKind !== "script") {
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
          body: JSON.stringify(
            cronRunBody({
              name: job.name,
              message: job.message,
              providerId: job.providerId,
              modelId: job.modelId,
              screenSystem: screen.system,
              personaLine,
              scriptOutput,
              scriptExit,
            }),
          ),
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
      void watchCronPublish(db, noticeId, hub)
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "cron run failed"
  }
  db.recordCronRun(job.id, error)
  if (!error && job.deleteAfterRun) db.deleteCronJob(job.id, job.userId)
  hub?.emit(job.userId, { type: "cron.changed" })
  return error
}

export function startCronScheduler(db: Db, hub?: EventHub) {
  let sweeping = false
  return setInterval(() => {
    if (sweeping) return
    sweeping = true
    void (async () => {
      try {
        await settleCronNotices(db, hub)
        for (const job of db.dueCronJobs(Date.now())) {
          await fireCronJob(db, job, false, hub)
        }
      } catch {
        // per-job errors are recorded on the job; keep the loop alive
      } finally {
        sweeping = false
      }
    })()
  }, SWEEP_MS)
}
