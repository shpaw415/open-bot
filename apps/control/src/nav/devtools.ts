// DevTools recorder for ob-chrome screens.
//
// Console messages, uncaught exceptions and network traffic only flow while a
// CDP session has the domains enabled — every ob-chrome/ob-page call opens and
// closes its socket, so events between calls are lost. This recorder holds one
// page socket open per screen, follows the active tab the same way the CLIs
// pick it (.tab file + pickPageTarget), and buffers everything as JSONL under
// ~/.open-bot/devtools/<session>/events.jsonl. `ob-chrome console|network`
// read that buffer; `network N --body` and `metrics` attach live instead.
//
// The process is passive and loopback-only: apart from applying the
// `ob-chrome viewport` emulation (below), it never drives the page, and it
// exits on its own after 2 minutes of an unreachable CDP endpoint (stopped
// screen), so lazy spawns cannot leak.

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  type CdpSocket,
  evaluate,
  listPageTargets,
  openSocket,
  type PageTarget,
  pickPageTarget,
  readActiveTabId,
} from "./cdp"
import {
  emulationAction,
  metricsOverride,
  shapeSpec,
  userAgentOverride,
  type ViewportSpec,
  viewportSignature,
} from "./viewport"

const MAX_LOG_BYTES = 2_000_000
const SWEEP_MS = 5000
const OPEN_STALE_MS = 10_000
const DEAD_SCREEN_MS = 120_000
const POLL_MS = 1000

export type RequestEvent = {
  ts: number
  kind: "request"
  id: string
  method: string
  url: string
  type: string
  status?: number
  mime?: string
  bytes?: number
  ms?: number
  fail?: string
  redirects?: number
  flushed?: boolean
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
}

export type DevEvent =
  | { ts: number; kind: "console"; level: string; text: string; url: string }
  | { ts: number; kind: "error"; text: string; url: string }
  | {
      ts: number
      kind: "log"
      level: string
      source: string
      text: string
      url: string
    }
  | RequestEvent

function homeDir() {
  return process.env.HOME || "/home/agent"
}

export function eventsDir(session: string) {
  return join(homeDir(), ".open-bot/devtools", session)
}

export function eventsFile(session: string) {
  return join(eventsDir(session), "events.jsonl")
}

// ---- recorder-mediated body fetch ----
//
// Network.getResponseBody only answers in the CDP session that saw the
// request, so the CLI cannot fetch bodies with its own socket. It drops a
// one-shot request file and the recorder (which holds the live session)
// answers it. The nonce lets a late CLI ignore stale results.

export type BodyRequest = { nonce: string; requestId: string }

export type BodyResult = {
  nonce: string
  ok: boolean
  body?: string
  base64?: boolean
  error?: string
}

const BODY_RESULT_MAX = 1_000_000

// Chrome evicts a response body from the network stack the moment the page
// consumes it (fetch().then(r => r.json())), so a CLI ask seconds later gets
// "No resource found". The recorder therefore snapshots small textual bodies
// in memory at loadingFinished — never on disk, never auto-printed — and the
// handshake serves them when the live lookup has already been evicted.
const SNAPSHOT_RAW_MAX = 64_000
const SNAPSHOT_KEEP = 32
const SNAPSHOTABLE =
  /json|text|html|xml|javascript|urlencoded|form|csv|event-stream/i

type BodySnapshot = { body: string; base64: boolean }

function bodyRequestFile(dir: string) {
  return join(dir, "body.json")
}

function bodyResultFile(dir: string) {
  return join(dir, "body-result.json")
}

export function writeBodyRequest(dir: string, request: BodyRequest) {
  try {
    unlinkSync(bodyResultFile(dir))
  } catch {}
  writeFileSync(bodyRequestFile(dir), JSON.stringify(request))
}

// Returns the matching result or null while nothing has arrived yet.
export function readBodyResult(dir: string, nonce: string): BodyResult | null {
  let raw = ""
  try {
    raw = readFileSync(bodyResultFile(dir), "utf8")
  } catch {
    return null
  }
  let result: BodyResult
  try {
    result = JSON.parse(raw) as BodyResult
  } catch {
    return null
  }
  if (result.nonce !== nonce) return null
  try {
    unlinkSync(bodyResultFile(dir))
  } catch {}
  return result
}

async function serveBodyRequest(
  socket: CdpSocket,
  dir: string,
  snapshots: Map<string, BodySnapshot>,
) {
  let raw = ""
  try {
    raw = readFileSync(bodyRequestFile(dir), "utf8")
  } catch {
    return
  }
  let request: BodyRequest
  try {
    request = JSON.parse(raw) as BodyRequest
  } catch {
    try {
      unlinkSync(bodyRequestFile(dir))
    } catch {}
    return
  }
  try {
    unlinkSync(bodyRequestFile(dir))
  } catch {}
  if (!request.requestId || !request.nonce) return
  let result: BodyResult
  try {
    const response = (await socket.call("Network.getResponseBody", {
      requestId: request.requestId,
    })) as { body?: string; base64Encoded?: boolean }
    const body = response.body ?? ""
    result = {
      nonce: request.nonce,
      ok: true,
      body: body.slice(0, BODY_RESULT_MAX),
      base64: response.base64Encoded,
    }
  } catch {
    const snapshot = snapshots.get(request.requestId)
    result = snapshot
      ? {
          nonce: request.nonce,
          ok: true,
          body: snapshot.body.slice(0, BODY_RESULT_MAX),
          base64: snapshot.base64,
        }
      : {
          nonce: request.nonce,
          ok: false,
          error: "No resource with given identifier found",
        }
  }
  try {
    writeFileSync(bodyResultFile(dir), JSON.stringify(result))
  } catch {}
}

async function snapshotBody(
  socket: CdpSocket,
  requestId: string,
  snapshots: Map<string, BodySnapshot>,
) {
  try {
    const response = (await socket.call("Network.getResponseBody", {
      requestId,
    })) as { body?: string; base64Encoded?: boolean }
    const body = response.body ?? ""
    if (body.length === 0 || body.length > SNAPSHOT_RAW_MAX) return
    snapshots.set(requestId, {
      body,
      base64: Boolean(response.base64Encoded),
    })
    while (snapshots.size > SNAPSHOT_KEEP) {
      const oldest = snapshots.keys().next().value
      if (oldest === undefined) break
      snapshots.delete(oldest)
    }
  } catch {}
}

// ---- recorder-held viewport emulation ----
//
// CDP emulation overrides die with the socket that set them, and every CLI
// call closes its own — so the recorder (the one socket that stays open)
// holds the `ob-chrome viewport` override. The CLI writes the desired spec
// to viewport.json beside the body handshake files; the recorder applies
// or clears it on its poll loop and on every (re)attach, and reports what
// it applied in viewport-applied.json for the CLI to wait on. Deleting the
// desired file is "off".

function viewportFile(dir: string) {
  return join(dir, "viewport.json")
}

function viewportAppliedFile(dir: string) {
  return join(dir, "viewport-applied.json")
}

export function writeDesiredViewport(dir: string, spec: ViewportSpec | null) {
  mkdirSync(dir, { recursive: true })
  if (!spec) {
    try {
      unlinkSync(viewportFile(dir))
    } catch {}
    return
  }
  writeFileSync(viewportFile(dir), JSON.stringify(spec))
}

export function readDesiredViewport(dir: string): ViewportSpec | null {
  let raw = ""
  try {
    raw = readFileSync(viewportFile(dir), "utf8")
  } catch {
    return null
  }
  try {
    return shapeSpec(JSON.parse(raw))
  } catch {
    return null
  }
}

export function readAppliedSignature(dir: string): string {
  try {
    const row = JSON.parse(readFileSync(viewportAppliedFile(dir), "utf8")) as {
      signature?: unknown
    }
    return typeof row.signature === "string" ? row.signature : "off"
  } catch {
    return "off"
  }
}

function writeAppliedSignature(
  dir: string,
  signature: string,
  targetId: string,
) {
  try {
    writeFileSync(
      viewportAppliedFile(dir),
      JSON.stringify({ signature, targetId, at: Date.now() }),
    )
  } catch {}
}

// Applies or clears the override to match the desired file; returns the
// signature now in effect on this socket. Each CDP call is best-effort: a
// browser that rejects the UA metadata still gets its metrics, and the
// metrics call is the one that decides success — on its failure the old
// signature stands, so the next poll retries.
async function syncViewport(
  socket: CdpSocket,
  dir: string,
  appliedSignature: string,
  targetId: string,
): Promise<string> {
  const desired = readDesiredViewport(dir)
  const action = emulationAction(appliedSignature, desired)
  if (action === "none") return appliedSignature
  if (action === "clear") {
    await socket
      .call("Emulation.clearDeviceMetricsOverride")
      .catch(() => undefined)
    await socket
      .call("Emulation.setUserAgentOverride", { userAgent: "" })
      .catch(() => undefined)
    await socket
      .call("Emulation.setTouchEmulationEnabled", { enabled: false })
      .catch(() => undefined)
    writeAppliedSignature(dir, "off", targetId)
    return "off"
  }
  if (!desired) return appliedSignature
  try {
    await socket.call(
      "Emulation.setDeviceMetricsOverride",
      metricsOverride(desired),
    )
  } catch {
    return appliedSignature
  }
  await socket
    .call("Emulation.setUserAgentOverride", userAgentOverride(desired))
    .catch(() => undefined)
  await socket
    .call("Emulation.setTouchEmulationEnabled", {
      enabled: desired.mobile,
      ...(desired.mobile ? { maxTouchPoints: 5 } : {}),
    })
    .catch(() => undefined)
  const signature = viewportSignature(desired)
  writeAppliedSignature(dir, signature, targetId)
  return signature
}

function cdpPort(session: string): number {
  try {
    return Number(
      readFileSync(join(homeDir(), ".open-bot/cdp", session), "utf8").trim(),
    )
  } catch {
    return 0
  }
}

// ---- pure shaping (unit-tested) ----

function trimHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined
  const out: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(
    headers as Record<string, unknown>,
  )) {
    if (count >= 16) break
    out[key] = String(value).slice(0, 200)
    count += 1
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// consoleAPICalled args are RemoteObjects: primitives carry `value`, objects
// only a `description` preview. Join and cap — the agent needs the message,
// not the whole object graph.
export function consoleText(args: unknown): string {
  const list = Array.isArray(args) ? args : []
  const parts = list.map((item) => {
    const row = (item ?? {}) as {
      value?: unknown
      description?: string
    }
    if (typeof row.value === "string") return row.value
    if (row.value !== undefined) {
      const text = JSON.stringify(row.value)
      return text === undefined ? String(row.value) : text
    }
    if (row.description) return row.description
    return "?"
  })
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 400)
}

export function shapeConsole(params: Record<string, unknown>): DevEvent {
  const stack = params.stackTrace as
    | { callFrames?: { url?: string }[] }
    | undefined
  return {
    ts: Date.now(),
    kind: "console",
    level: String(params.type ?? "log"),
    text: consoleText(params.args),
    url: String(stack?.callFrames?.[0]?.url ?? ""),
  }
}

export function shapeException(params: Record<string, unknown>): DevEvent {
  const details = (params.exceptionDetails ?? {}) as {
    text?: string
    url?: string
    exception?: { description?: string; className?: string }
  }
  const raw =
    details.exception?.description ||
    details.exception?.className ||
    details.text ||
    "exception"
  return {
    ts: Date.now(),
    kind: "error",
    text: raw.replace(/\s+/g, " ").trim().slice(0, 400),
    url: String(details.url ?? ""),
  }
}

// Log.entryAdded nests the fields under `entry` ({source, level, text, url}).
export function shapeLogEntry(params: Record<string, unknown>): DevEvent {
  const entry = (params.entry ?? {}) as Record<string, unknown>
  return {
    ts: Date.now(),
    kind: "log",
    level: String(entry.level ?? params.level ?? "info"),
    source: String(entry.source ?? ""),
    text: String(entry.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400),
    url: String(entry.url ?? params.url ?? ""),
  }
}

export type NetMap = Map<string, RequestEvent>

// Merges Network domain events into one record per request id. Returns the
// record when it is final (loadingFinished/loadingFailed) so the caller can
// write it exactly once; everything else stays in the map until then, or
// until staleRequests flushes a hung request.
export function mergeNetworkEvent(
  map: NetMap,
  method: string,
  params: Record<string, unknown>,
): DevEvent | null {
  if (method === "Network.requestWillBeSent") {
    const id = String(params.requestId ?? "")
    if (!id) return null
    const existing = map.get(id)
    if (existing) {
      // A redirect reuses the request id: fold the interim response in and
      // count the hop.
      if (params.redirectResponse) {
        const redirect = params.redirectResponse as Record<string, unknown>
        existing.status = Number(redirect.status) || existing.status
        existing.mime = String(redirect.mimeType ?? existing.mime ?? "")
        existing.redirects = (existing.redirects ?? 0) + 1
      }
      return null
    }
    const request = (params.request ?? {}) as Record<string, unknown>
    map.set(id, {
      ts: Date.now(),
      kind: "request",
      id,
      method: String(request.method ?? ""),
      url: String(request.url ?? ""),
      type: String(params.type ?? ""),
      requestHeaders: trimHeaders(request.headers),
    })
    return null
  }
  const id = String(params.requestId ?? "")
  const record = map.get(id)
  if (!record) return null
  if (method === "Network.responseReceived") {
    const response = (params.response ?? {}) as Record<string, unknown>
    record.status = Number(response.status) || record.status
    record.mime = String(response.mimeType ?? record.mime ?? "")
    record.responseHeaders = trimHeaders(response.headers)
    return null
  }
  if (method === "Network.loadingFinished") {
    record.bytes = Number(params.encodedDataLength ?? 0) || undefined
    record.ms = Date.now() - record.ts
    map.delete(id)
    return record
  }
  if (method === "Network.loadingFailed") {
    record.fail = String(params.errorText ?? "failed")
    record.ms = Date.now() - record.ts
    map.delete(id)
    return record
  }
  return null
}

// Hung requests (a fetch that never settles) get one flushed line so the
// buffer still shows them; `flushed` keeps later sweeps from rewriting, and
// a late completion writes a second line the reader folds by id.
export function staleRequests(map: NetMap, now: number): RequestEvent[] {
  const out: RequestEvent[] = []
  for (const record of map.values()) {
    if (!record.flushed && now - record.ts >= OPEN_STALE_MS) {
      record.flushed = true
      record.ms = now - record.ts
      out.push(record)
    }
  }
  return out
}

// ---- buffered reads (unit-tested) ----

function tailLines(file: string, max: number): string[] {
  let raw = ""
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return []
  }
  const lines = raw.split("\n").filter((line) => line.trim() !== "")
  return lines.slice(-max)
}

export type ConsoleRow = { n: number; level: string; text: string; url: string }

export function readConsole(
  file: string,
  level: string,
  limit: number,
): ConsoleRow[] {
  const out: Omit<ConsoleRow, "n">[] = []
  for (const line of tailLines(file, 600)) {
    let event: DevEvent
    try {
      event = JSON.parse(line) as DevEvent
    } catch {
      continue
    }
    if (event.kind === "console") {
      if (level && event.level !== level) continue
      out.push({ level: event.level, text: event.text, url: event.url })
    } else if (event.kind === "error") {
      if (level && level !== "error") continue
      out.push({ level: "error", text: event.text, url: event.url })
    } else if (event.kind === "log") {
      if (level && event.level !== level) continue
      out.push({ level: event.level, text: event.text, url: event.url })
    }
  }
  return out.slice(-limit).map((row, index) => ({ ...row, n: index + 1 }))
}

export type RequestRow = Omit<RequestEvent, "kind" | "flushed">

// Duplicate ids (sweep flush + late completion) fold to the last line while
// keeping first-appearance order, so the printed window reads chronologically.
export function readNetwork(
  file: string,
  filter: string,
  limit: number,
): RequestRow[] {
  const byId = new Map<string, RequestEvent>()
  const order: string[] = []
  for (const line of tailLines(file, 600)) {
    let event: DevEvent
    try {
      event = JSON.parse(line) as DevEvent
    } catch {
      continue
    }
    if (event.kind !== "request") continue
    if (filter && !event.url.toLowerCase().includes(filter.toLowerCase()))
      continue
    if (!byId.has(event.id)) order.push(event.id)
    const { kind: _kind, flushed: _flushed, ...rest } = event
    byId.set(event.id, rest as RequestEvent)
  }
  return order
    .map((id) => byId.get(id))
    .filter((row): row is RequestEvent => row !== undefined)
    .slice(-limit)
}

// ---- writer ----

function prevFile(file: string) {
  return file.replace(/\.jsonl$/, ".1.jsonl")
}

function writeEvent(file: string, event: DevEvent) {
  try {
    if (statSync(file).size > MAX_LOG_BYTES) {
      try {
        unlinkSync(prevFile(file))
      } catch {}
      try {
        renameSync(file, prevFile(file))
      } catch {}
    }
  } catch {}
  try {
    appendFileSync(file, `${JSON.stringify(event)}\n`)
  } catch {}
}

// ---- recorder loop ----

function handleEvent(
  open: NetMap,
  file: string,
  raw: unknown,
  snapshots: Map<string, BodySnapshot>,
  socket: () => CdpSocket | null,
) {
  const message = (raw ?? {}) as {
    method?: string
    params?: Record<string, unknown>
  }
  const method = message.method ?? ""
  const params = message.params ?? {}
  let event: DevEvent | null = null
  if (method === "Runtime.consoleAPICalled") event = shapeConsole(params)
  else if (method === "Runtime.exceptionThrown") event = shapeException(params)
  else if (method === "Log.entryAdded") event = shapeLogEntry(params)
  else event = mergeNetworkEvent(open, method, params)
  if (!event) return
  writeEvent(file, event)
  // Snapshot candidates right away: consumed fetch bodies are unretained
  // within moments of this event.
  if (
    event.kind === "request" &&
    !event.fail &&
    SNAPSHOTABLE.test(event.mime ?? "") &&
    (event.bytes ?? 0) <= SNAPSHOT_RAW_MAX
  ) {
    const live = socket()
    if (live) void snapshotBody(live, event.id, snapshots)
  }
}

async function attach(
  target: PageTarget,
  onMessage: (raw: unknown) => void,
): Promise<CdpSocket> {
  const socket = await openSocket(target.webSocketDebuggerUrl, onMessage)
  // Order matters: Runtime first so console calls during the page's own boot
  // are caught once Network is on too.
  await socket.call("Runtime.enable").catch(() => undefined)
  await socket.call("Log.enable").catch(() => undefined)
  await socket.call("Network.enable").catch(() => undefined)
  return socket
}

export async function record(session: string): Promise<void> {
  const dir = eventsDir(session)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "recorder.pid"), String(process.pid))
  } catch {}
  const file = eventsFile(session)
  const open: NetMap = new Map()
  const snapshots = new Map<string, BodySnapshot>()
  const onMessage = (raw: unknown) =>
    handleEvent(open, file, raw, snapshots, () => socket)
  let socket: CdpSocket | null = null
  let bound = ""
  // Emulation in effect on the live socket; a fresh socket has none, so
  // every (re)attach resets it and syncViewport re-applies the desired file.
  let appliedViewport = "off"
  let deadSince = 0
  let lastSweep = 0
  let poll = 0
  for (;;) {
    const now = Date.now()
    try {
      const targets = await listPageTargets(cdpPort(session))
      deadSince = 0
      const target = pickPageTarget(targets, readActiveTabId(session))
      if (target && bound !== target.id) {
        try {
          socket?.close()
        } catch {}
        socket = null
        appliedViewport = "off"
        try {
          socket = await attach(target, onMessage)
          bound = target.id
          // A fresh socket carries no override: say so before re-applying,
          // so a stale applied file never claims a dead browser's viewport.
          writeAppliedSignature(dir, "off", bound)
          appliedViewport = await syncViewport(socket, dir, "off", bound)
        } catch {
          socket = null
          bound = ""
        }
      } else if (poll % 5 === 0 && socket) {
        // Cheap liveness ping: a crashed renderer closes the ws, but a wedged
        // one stops answering without closing. Re-attach on connection errors
        // only; a mid-navigation context error is normal and kept.
        await evaluate(socket, "1").catch((error: unknown) => {
          const message = error instanceof Error ? error.message : ""
          if (/connection|timed out|closed/i.test(message)) {
            socket = null
            bound = ""
            appliedViewport = "off"
          }
        })
      }
    } catch {
      if (deadSince === 0) deadSince = now
      else if (now - deadSince > DEAD_SCREEN_MS) break
    }
    if (now - lastSweep > SWEEP_MS) {
      lastSweep = now
      for (const event of staleRequests(open, now)) writeEvent(file, event)
    }
    if (socket) {
      appliedViewport = await syncViewport(socket, dir, appliedViewport, bound)
      await serveBodyRequest(socket, dir, snapshots)
    }
    poll += 1
    await Bun.sleep(POLL_MS)
  }
  try {
    socket?.close()
  } catch {}
}

// Lazy start used by the CLI verbs: a recorder the screen-up script started
// (run_dir pid group) or one a previous call spawned keeps running; only a
// dead one is replaced. Same-user pidfiles make kill(0) a reliable probe.
export function ensureRecorder(session: string | undefined) {
  if (!session || !/^[\w-]+$/.test(session)) return
  const pidFile = join(eventsDir(session), "recorder.pid")
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim())
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 0)
      return
    }
  } catch {}
  try {
    const child = Bun.spawn(
      [
        "setsid",
        process.execPath,
        join(import.meta.dir, "devtools.ts"),
        session,
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    )
    child.unref()
  } catch {}
}

if (import.meta.main) {
  const session = process.argv[2] ?? ""
  if (!/^[\w-]+$/.test(session)) {
    console.error("usage: devtools.ts SESSION")
    process.exit(1)
  }
  record(session)
}
