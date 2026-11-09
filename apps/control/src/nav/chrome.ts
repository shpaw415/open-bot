import { unlinkSync } from "node:fs"
import {
  type CdpSocket,
  clearActiveTabId,
  evaluate,
  listPageTargets,
  openSocket,
  type PageTarget,
  pickPageTarget,
  present,
  readActiveTabId,
  writeActiveTabId,
} from "./cdp"
import {
  type BodyResult,
  ensureRecorder,
  eventsDir,
  eventsFile,
  readAppliedSignature,
  readBodyResult,
  readConsole,
  readDesiredViewport,
  readNetwork,
  writeBodyRequest,
  writeDesiredViewport,
} from "./devtools"
import {
  orientationOf,
  parseViewportRequest,
  VIEWPORT_PRESETS,
  type ViewportSpec,
  viewportSignature,
} from "./viewport"

const USAGE =
  "usage: chrome.ts PORT SESSION navigate URL | tab [list|new [URL]|close [N]|switch N] | newtab URL | tabs | switch N | closetab N | url | back | forward | reload [--fresh] | cache clear [--origin URL] [--cookies] [--reload] | console | network [N] | metrics | dom | eval [--raw] JS | viewport [list | mobile [PRESET] | PRESET | WxH [--dpr N] [--landscape] [--desktop] | rotate | off]"

export type PageState = {
  url: string
  title: string
  heading?: string
  text?: string
  via?: string
  browserClosed?: boolean
}

export function normalizeTarget(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  // file:// is allowed — Chromium renders local HTML and ob-page can read
  // and interact with it like any page.
  if (/^(https?|file):\/\//i.test(value)) return value
  if (/^[\w-]+(\.[\w-]+)+/.test(value)) return `https://${value}`
  return null
}

// Navigating a URL the normalizer rejects should explain why, not print the
// bare usage line (the raw usage hides the failure when stderr is dropped).
export function schemeError(raw: string): string | null {
  const value = raw.trim()
  const match = value.match(/^([a-z][a-z0-9+.-]*):/i)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  if (scheme === "http" || scheme === "https" || scheme === "file") return null
  return `unsupported URL scheme '${scheme}:' — use http(s):// or file:// (serve local files over HTTP for full page interactions)`
}

// url, title, heading and the page body text ride back together so "navigate
// then read" is one call instead of two.
const STATE_SCRIPT =
  '({url:location.href,title:document.title,heading:(document.querySelector("h1")?document.querySelector("h1").textContent:"").replace(/\\s+/g," ").trim().slice(0,200),text:(document.body?document.body.innerText:"").replace(/\\s+/g," ").trim().slice(0,2500)})'

export function shapeState(raw: unknown): PageState {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    url: String(row.url ?? ""),
    title: String(row.title ?? ""),
    heading: String(row.heading ?? ""),
    text: String(row.text ?? ""),
  }
}

async function readState(socket: CdpSocket): Promise<PageState> {
  return shapeState(await evaluate(socket, STATE_SCRIPT))
}

async function resolvePage(
  port: number,
  session?: string,
): Promise<{ target: PageTarget; socket: CdpSocket }> {
  const targets = await listPageTargets(port)
  const target = pickPageTarget(targets, readActiveTabId(session))
  if (!target) throw new Error("no page on this screen")
  const socket = await openSocket(target.webSocketDebuggerUrl)
  return { target, socket }
}

async function front(socket: CdpSocket) {
  await present(socket).catch(() => undefined)
}

// One Page.navigate plus a bounded settle loop. The per-call ws timeout in
// cdp.ts turns a crashed renderer into a throw, which is what triggers the
// /json/new fallback below.
async function navigateLive(
  url: string,
  socket: CdpSocket,
): Promise<PageState> {
  await socket.call("Page.navigate", { url })
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      const href = await evaluate(socket, "location.href")
      if (typeof href === "string" && href && !href.startsWith("about:")) break
    } catch (error) {
      // A call timeout means the renderer is gone; a plain context error is
      // the normal navigation teardown and just waits for the next poll.
      if (error instanceof Error && /timed out/i.test(error.message))
        throw error
    }
    if (Date.now() > deadline) break
    await Bun.sleep(120)
  }
  const state = await readState(socket).catch(() => ({ url, title: "" }))
  await front(socket)
  return state
}

async function jsonNew(port: number, url: string): Promise<Response> {
  let made: Response
  try {
    made = await fetch(
      `http://127.0.0.1:${port}/json/new?url=${encodeURIComponent(url)}`,
      { method: "PUT", signal: AbortSignal.timeout(4000) },
    )
  } catch {
    throw new Error("chrome is not reachable on this screen")
  }
  if (!made.ok) {
    throw new Error("page is unresponsive and a fresh tab could not be opened")
  }
  return made
}

async function openFreshTab(
  port: number,
  session: string | undefined,
  url: string,
  dead?: PageTarget,
): Promise<PageState> {
  const made = await jsonNew(port, url)
  // The dead tab would keep winning target selection; close just the one
  // that stopped answering. Other windows stay untouched.
  if (dead) {
    await fetch(`http://127.0.0.1:${port}/json/close/${dead.id}`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined)
  }
  let id = ""
  try {
    const target = (await made.json()) as {
      id?: string
      webSocketDebuggerUrl?: string
    }
    id = target.id ?? ""
    if (target.webSocketDebuggerUrl) {
      const socket = await openSocket(target.webSocketDebuggerUrl)
      try {
        await front(socket)
      } finally {
        socket.close()
      }
    }
  } catch {}
  writeActiveTabId(session, id)
  return { url, title: "", via: "new-tab" }
}

// A new tab becomes the active one, exactly like a real browser: the state
// line answers like navigate, and later ob-page calls land in this tab.
async function newTab(
  port: number,
  session: string | undefined,
  raw: string,
): Promise<PageState> {
  const url = raw.trim() ? normalizeTarget(raw) : "about:blank"
  if (!url) throw new Error(schemeError(raw) ?? USAGE)
  const made = await jsonNew(port, url)
  let id = ""
  let wsUrl = ""
  try {
    const target = (await made.json()) as {
      id?: string
      webSocketDebuggerUrl?: string
    }
    id = target.id ?? ""
    wsUrl = target.webSocketDebuggerUrl ?? ""
  } catch {}
  writeActiveTabId(session, id)
  if (!wsUrl) return { url, title: "", via: "new-tab" }
  const socket = await openSocket(wsUrl)
  try {
    if (url === "about:blank") {
      await front(socket)
      return { url: "about:blank", title: "", via: "new-tab" }
    }
    return { ...(await navigateLive(url, socket)), via: "new-tab" }
  } finally {
    socket.close()
  }
}

export type TabLine = {
  tabs: {
    index: number
    id: string
    url: string
    title: string
    active: boolean
  }[]
}

export async function tabsLine(port: number, session: string | undefined) {
  const targets = await listPageTargets(port)
  const active = pickPageTarget(targets, readActiveTabId(session))
  return {
    tabs: targets.map((target, index) => ({
      index: index + 1,
      // The stable CDP target id: /json/list order shifts as tabs open and
      // close, so the id — not the number — is the handle that keeps
      // listing and acting on the same tab.
      id: target.id,
      url: target.url,
      title: target.title,
      active: target.id === active?.id,
    })),
  }
}

// switch/closetab take the stable tab id `tab list` prints (preferred), the
// 1-based index, or a url/title substring. Both switchTab and closeTab
// resolve against a fresh /json/list inside the same verb and act by the id
// captured from that listing, so a list and an action never interleave over
// mismatched state.
export function matchTab(
  targets: PageTarget[],
  arg: string,
): PageTarget | null {
  const value = arg.trim()
  if (!value) return null
  const byId = targets.find(
    (item) => item.id.toLowerCase() === value.toLowerCase(),
  )
  if (byId) return byId
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1
    return targets[index] ?? null
  }
  const needle = value.toLowerCase()
  return (
    targets.find(
      (item) =>
        item.url.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle),
    ) ?? null
  )
}

// A numeric miss means the numbered tab from the agent's earlier listing is
// gone or the order shifted; name the recovery instead of a bare no-match.
export function tabArgError(arg: string): string {
  const value = arg.trim()
  if (/^\d+$/.test(value))
    return `tab ${value} no longer exists — run tab list again, or pass the tab id it prints`
  return `no tab matches ${arg}`
}

async function switchTab(
  port: number,
  session: string | undefined,
  arg: string,
): Promise<PageState> {
  const targets = await listPageTargets(port)
  const target = matchTab(targets, arg)
  if (!target) throw new Error(tabArgError(arg))
  writeActiveTabId(session, target.id)
  const socket = await openSocket(target.webSocketDebuggerUrl)
  try {
    await front(socket)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

export async function closeTab(
  port: number,
  session: string | undefined,
  arg: string,
): Promise<PageState> {
  const activeId = readActiveTabId(session)
  const targets = await listPageTargets(port)
  const target = arg.trim()
    ? matchTab(targets, arg)
    : pickPageTarget(targets, activeId)
  if (!target) throw new Error(arg.trim() ? tabArgError(arg) : USAGE)
  const gone = await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`, {
    signal: AbortSignal.timeout(4000),
  }).catch(() => null)
  // Closing the last tab exits Chromium, which can drop the close response
  // itself — a failed response is only a failed close when the tab is
  // still listed afterwards. An unreachable browser means the tab went
  // with it: the requested end state, not an error to heal/retry over.
  let rest: PageTarget[] | null = null
  try {
    rest = await listPageTargets(port)
  } catch {
    rest = null
  }
  const closed =
    gone?.ok === true ||
    rest === null ||
    !rest.some((item) => item.id === target.id)
  if (!closed) throw new Error("tab did not close")
  if (target.id === activeId) clearActiveTabId(session)
  const closedState: PageState = { ...shapeState(null), browserClosed: true }
  // The screen should follow the survivor, not a closed tab.
  const survivors = (rest ?? []).filter((item) => item.id !== target.id)
  const next = pickPageTarget(survivors)
  if (!next) return closedState
  writeActiveTabId(session, next.id)
  // The close already succeeded; a browser dying around the survivor must
  // not turn it into a failure (which also made withHeal relaunch it).
  try {
    const socket = await openSocket(next.webSocketDebuggerUrl)
    try {
      await front(socket)
      return await readState(socket).catch(() => shapeState(null))
    } finally {
      socket.close()
    }
  } catch {
    return closedState
  }
}

async function navigate(
  port: number,
  session: string | undefined,
  raw: string,
): Promise<PageState> {
  const url = normalizeTarget(raw)
  if (!url) throw new Error(schemeError(raw) ?? USAGE)
  try {
    const { target, socket } = await resolvePage(port, session)
    try {
      const state = await navigateLive(url, socket)
      writeActiveTabId(session, target.id)
      return state
    } finally {
      socket.close()
    }
  } catch {
    let dead: PageTarget | undefined
    try {
      dead =
        pickPageTarget(await listPageTargets(port), readActiveTabId(session)) ??
        undefined
    } catch {}
    return openFreshTab(port, session, url, dead)
  }
}

async function current(port: number, session?: string): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
  try {
    return await readState(socket)
  } finally {
    socket.close()
  }
}

async function history(
  port: number,
  session: string | undefined,
  delta: -1 | 1,
): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
  try {
    await evaluate(socket, `history.go(${delta})`)
    await Bun.sleep(800)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

async function reload(
  port: number,
  session?: string,
  fresh?: boolean,
): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
  try {
    await socket
      .call("Page.reload", fresh ? { ignoreCache: true } : undefined)
      .catch(() => evaluate(socket, "location.reload()"))
    await Bun.sleep(900)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

// ---- devtools verbs ----

// `console --level error --limit 20` and `network --filter api --limit 10 3
// --body` parse the same way: --key VALUE pairs, bare --flags, everything
// else is positional (the request index for network).
export function flagsFrom(argv: string[]): {
  positional: string[]
  flags: Record<string, string | boolean>
} {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith("--")) {
      positional.push(item)
      continue
    }
    const eq = item.indexOf("=")
    if (eq > 2) {
      flags[item.slice(2, eq)] = item.slice(eq + 1)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith("--")) {
      flags[item.slice(2)] = next
      index += 1
    } else flags[item.slice(2)] = true
  }
  return { positional, flags }
}

function numFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = typeof flags[key] === "string" ? Number(flags[key]) : NaN
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function consoleCmd(
  session: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  ensureRecorder(session)
  if (!session) throw new Error("console needs a session")
  const file = eventsFile(session)
  if (flags.clear === true) {
    try {
      unlinkSync(file)
    } catch {}
    return { cleared: true }
  }
  const level = typeof flags.level === "string" ? flags.level : ""
  return { console: readConsole(file, level, numFlag(flags, "limit", 40)) }
}

const TEXTUAL =
  /json|text|html|xml|javascript|urlencoded|form|csv|event-stream/i

function capBody(text: string): { body: string } {
  return {
    body:
      text.length > 128_000 ? `${text.slice(0, 128_000)}…[truncated]` : text,
  }
}

// Bodies come from the recorder's own Network session (getResponseBody is
// session-scoped), through a one-shot file handshake with a nonce so stale
// results from an earlier CLI run are ignored.
async function fetchBody(
  session: string,
  requestId: string,
  mime: string,
): Promise<{ body: string; bodyBytes?: number }> {
  const dir = eventsDir(session)
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  writeBodyRequest(dir, { nonce, requestId })
  const deadline = Date.now() + 8000
  for (;;) {
    if (Date.now() > deadline)
      throw new Error(
        "no answer from the screen's devtools recorder — retry once",
      )
    await Bun.sleep(200)
    let result: BodyResult | null = null
    try {
      result = readBodyResult(dir, nonce)
    } catch {
      result = null
    }
    if (!result) continue
    if (!result.ok) {
      if (/no resource with given identifier/i.test(result.error ?? ""))
        throw new Error(
          "response body is no longer buffered — run network N --body again right after the request",
        )
      throw new Error(result.error || "body fetch failed")
    }
    if (result.base64) {
      const bytes = Buffer.from(result.body ?? "", "base64")
      if (!TEXTUAL.test(mime))
        return {
          body: `<binary ${bytes.length} bytes>`,
          bodyBytes: bytes.length,
        }
      return capBody(bytes.toString("utf8"))
    }
    return capBody(result.body ?? "")
  }
}

async function networkCmd(
  session: string | undefined,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  ensureRecorder(session)
  if (!session) throw new Error("network needs a session")
  const file = eventsFile(session)
  if (flags.clear === true) {
    try {
      unlinkSync(file)
    } catch {}
    return { cleared: true }
  }
  const filter = typeof flags.filter === "string" ? flags.filter : ""
  const index = positional[0]
  if (index !== undefined) {
    const which = Number(index)
    if (!Number.isInteger(which) || which < 1)
      throw new Error(`bad request index ${index}`)
    // The detail view recomputes the same last-25 window `network` prints, so
    // the printed `n` stays meaningful.
    const list = readNetwork(file, filter, 25)
    const record = list[which - 1]
    if (!record)
      throw new Error(
        `no request ${which} in the current window — run network again to list, passing the same --filter`,
      )
    const out: Record<string, unknown> = {
      n: which,
      method: record.method,
      url: record.url,
      type: record.type,
      status: record.status,
      mime: record.mime,
      bytes: record.bytes,
      ms: record.ms,
      fail: record.fail,
      redirects: record.redirects,
      requestHeaders: record.requestHeaders,
      responseHeaders: record.responseHeaders,
    }
    if (flags.body === true)
      Object.assign(out, await fetchBody(session, record.id, record.mime ?? ""))
    return out
  }
  const limit = numFlag(flags, "limit", 25)
  return {
    requests: readNetwork(file, filter, limit).map((row, i) => ({
      n: i + 1,
      method: row.method,
      url: row.url,
      status: row.status,
      type: row.type,
      bytes: row.bytes,
      ms: row.ms,
      fail: row.fail,
    })),
  }
}

async function metricsCmd(
  port: number,
  session: string | undefined,
): Promise<Record<string, unknown>> {
  const { socket } = await resolvePage(port, session)
  try {
    await socket.call("Performance.enable")
    const result = (await socket.call("Performance.getMetrics")) as {
      metrics?: { name: string; value: number }[]
    }
    const metrics: Record<string, number> = {}
    for (const row of result.metrics ?? [])
      metrics[row.name] = Math.round(row.value * 100) / 100
    const pageMs = await evaluate(
      socket,
      "Math.round(performance.now())",
    ).catch(() => undefined)
    return {
      url: await evaluate(socket, "location.href").catch(() => ""),
      page_ms: typeof pageMs === "number" ? pageMs : undefined,
      metrics,
    }
  } finally {
    socket.close()
  }
}

// `cache clear` is the dev cache-buster. Plain clear wipes the browser-wide
// HTTP cache; --origin wipes one origin's stale app data (cache storage,
// service workers, localStorage, IndexedDB — the layers that survive a
// reload and break dev iterations). Cookies survive unless --cookies, so a
// cache bust never silently logs the page out. --reload lands on fresh
// bytes in the same call.
async function cacheCmd(
  port: number,
  session: string | undefined,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  const sub = positional[0] ?? ""
  if (sub !== "clear") throw new Error("cache takes clear")
  const originFlag = typeof flags.origin === "string" ? flags.origin : ""
  const { socket } = await resolvePage(port, session)
  try {
    let cleared: Record<string, unknown>
    if (originFlag) {
      const origin = devOrigin(originFlag)
      if (!origin)
        throw new Error(
          `bad origin ${originFlag} — use a http(s) url or domain`,
        )
      // Storage types are the CDP names; the HTTP cache has no per-origin
      // clear (browser-wide only), so say so instead of pretending.
      const types = [
        "cache_storage",
        "service_workers",
        "local_storage",
        "indexeddb",
      ]
      if (flags.cookies === true) types.push("cookies")
      await socket.call("Storage.clearDataForOrigin", {
        origin,
        storageTypes: types.join(","),
      })
      cleared = {
        cleared: origin,
        types,
        note: "per-origin app data only — plain `cache clear` wipes the browser HTTP cache too",
      }
    } else {
      await socket.call("Network.clearBrowserCache")
      cleared = { cleared: "browser HTTP cache" }
    }
    if (flags.reload !== true) return cleared
    await socket
      .call("Page.reload", { ignoreCache: true })
      .catch(() => undefined)
    await Bun.sleep(900)
    return {
      ...cleared,
      reloaded: await readState(socket).catch(() => shapeState(null)),
    }
  } finally {
    socket.close()
  }
}

const DOM_TOTAL_MAX = 96_000
const EVAL_MAX = 64_000
const ELEMENT_HTML_MAX = 8_000

export function capText(
  text: string,
  max: number,
): { text: string; truncated?: boolean } {
  if (text.length <= max) return { text }
  return { text: text.slice(0, max), truncated: true }
}

// Storage.clearDataForOrigin needs a scheme+host origin ("https://x.test"),
// never a path; bare domains get the scheme like navigate does. The HTTP
// cache itself is only clearable browser-wide (Network.clearBrowserCache) —
// origin mode targets the stale-app-data layer instead.
export function devOrigin(raw: string): string | null {
  const normalized = normalizeTarget(raw.trim()) ?? raw.trim()
  try {
    const url = new URL(normalized)
    // file:/about: URLs report the literal origin "null" — useless here.
    if (!/^https?:$/.test(url.protocol)) return null
    return url.origin
  } catch {
    return null
  }
}

// `dom` reads the live DOM the navigate state line cannot show: the whole
// document HTML by default, body innerText with --text, or the outerHTML of
// a --selector match set (the cheap way to inspect one widget).
async function domCmd(
  port: number,
  session: string | undefined,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  const { socket } = await resolvePage(port, session)
  try {
    const url = await evaluate(socket, "location.href").catch(() => "")
    const selector =
      typeof flags.selector === "string"
        ? flags.selector
        : (positional[0] ?? "")
    const limit = numFlag(flags, "limit", 20)
    if (selector) {
      const script = `(() => {
        const sel = ${JSON.stringify(selector)}
        const all = document.querySelectorAll(sel)
        const els = [...all].slice(0, ${limit})
        return { count: all.length, html: els.map((el) => el.outerHTML.slice(0, ${ELEMENT_HTML_MAX})) }
      })()`
      const raw = (await evaluate(socket, script)) as {
        count?: number
        html?: string[]
      }
      const html = (raw.html ?? []).join("\n")
      const cap = capText(html, DOM_TOTAL_MAX)
      return {
        url,
        selector,
        count: raw.count ?? 0,
        shown: (raw.html ?? []).length,
        html: cap.text,
        truncated: cap.truncated,
      }
    }
    if (flags.text === true) {
      const raw = await evaluate(
        socket,
        "(document.body ? document.body.innerText : '')",
      )
      const cap = capText(String(raw ?? ""), DOM_TOTAL_MAX)
      return { url, text: cap.text, truncated: cap.truncated }
    }
    const raw = await evaluate(socket, "document.documentElement.outerHTML")
    const cap = capText(String(raw ?? ""), DOM_TOTAL_MAX)
    return { url, html: cap.text, truncated: cap.truncated }
  } finally {
    socket.close()
  }
}

// Splits an eval invocation into expression + raw mode. The generic flag
// parser treats a `--raw` before the expression as taking the expression's
// first token as its value — hand that token back so both
// `eval --raw 'expr'` and `eval 'expr' --raw` work.
export function evalRequest(
  positional: string[],
  flags: Record<string, string | boolean>,
): { expression: string; raw: boolean } {
  if (flags.raw === undefined) {
    return { expression: positional.join(" "), raw: false }
  }
  if (typeof flags.raw === "string") {
    return { expression: [flags.raw, ...positional].join(" "), raw: true }
  }
  return { expression: positional.join(" "), raw: flags.raw === true }
}

// `eval JS` runs in the page: the management lever the DOM read implies —
// set attributes/classes, inject or remove nodes, call the page's own APIs.
// evaluate() surfaces page exceptions with the real message. Default output
// is the {url, value} envelope every verb prints; --raw prints the JSON
// value alone so a poll can read fields at the root (`eval '({mode:1})'
// --raw` -> {"mode":1}).
async function evalCmd(
  port: number,
  session: string | undefined,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  const { expression, raw } = evalRequest(positional, flags)
  if (!expression.trim()) throw new Error("eval needs a JavaScript expression")
  const { socket } = await resolvePage(port, session)
  try {
    const value = await evaluate(socket, expression)
    let serialized: string
    try {
      serialized = JSON.stringify(value) ?? String(value)
    } catch {
      serialized = String(value)
    }
    if (raw) {
      if (serialized.length <= EVAL_MAX) return { __raw: serialized }
      console.error(
        "note: eval result truncated — narrow the expression (slice arrays, pick fields)",
      )
      return { __raw: capText(serialized, EVAL_MAX).text }
    }
    const url = await evaluate(socket, "location.href").catch(() => "")
    if (serialized.length <= EVAL_MAX) return { url, value }
    const cap = capText(serialized, EVAL_MAX)
    return {
      url,
      value: cap.text,
      truncated: true,
      note: "result truncated — narrow the expression (slice arrays, pick fields)",
    }
  } finally {
    socket.close()
  }
}

// ---- viewport (mobile / device emulation) ----
//
// The DevTools device toolbar as a verb. The override itself is held by
// the screen's DevTools recorder (its socket is the one that stays open —
// see devtools.ts); this verb writes the desired spec, makes sure the
// recorder is running, then waits until the recorder reports it applied
// AND the live page measures at the new size, so a printed line is proof,
// not intent. Output is one JSON line shaped like every verb's.

type LiveViewport = {
  url: string
  width: number
  height: number
  dpr: number
  touchPoints: number
  userAgent: string
}

const LIVE_VIEWPORT_SCRIPT =
  "({url:location.href,width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio||1,touchPoints:navigator.maxTouchPoints||0,userAgent:navigator.userAgent||''})"

async function liveViewport(port: number, session: string | undefined) {
  const { socket } = await resolvePage(port, session)
  try {
    const raw = (await evaluate(socket, LIVE_VIEWPORT_SCRIPT)) as
      | Partial<LiveViewport>
      | undefined
    return {
      url: String(raw?.url ?? ""),
      width: Number(raw?.width ?? 0),
      height: Number(raw?.height ?? 0),
      dpr: Number(raw?.dpr ?? 1),
      touchPoints: Number(raw?.touchPoints ?? 0),
      userAgent: String(raw?.userAgent ?? ""),
    } satisfies LiveViewport
  } finally {
    socket.close()
  }
}

function viewportLine(live: LiveViewport, desired: ViewportSpec | null) {
  return {
    url: live.url,
    viewport: {
      mode: !desired ? "desktop" : desired.mobile ? "mobile" : "custom",
      preset: desired?.preset ? desired.preset : null,
      width: live.width,
      height: live.height,
      dpr: live.dpr,
      orientation: orientationOf(live),
      touch: live.touchPoints > 0,
      userAgent: live.userAgent,
    },
  }
}

// Waits for the recorder to apply (or clear) the desired spec. The applied
// signature alone could be stale (a dead browser's file), so setting also
// requires the live page to measure at the spec size; clearing requires
// the live size or UA to have left the cleared spec behind.
async function waitViewportApplied(
  port: number,
  session: string,
  dir: string,
  desired: ViewportSpec | null,
  cleared: ViewportSpec | null,
): Promise<LiveViewport> {
  const expected = viewportSignature(desired)
  const deadline = Date.now() + 8000
  for (;;) {
    const live = await liveViewport(port, session).catch(() => null)
    if (live && readAppliedSignature(dir) === expected) {
      if (desired) {
        if (
          live.width === desired.width &&
          live.height === desired.height &&
          (desired.userAgent === "" || live.userAgent === desired.userAgent)
        )
          return live
      } else if (!cleared) return live
      else if (
        live.width !== cleared.width ||
        live.height !== cleared.height ||
        (cleared.userAgent !== "" && live.userAgent !== cleared.userAgent)
      )
        return live
    }
    if (Date.now() > deadline)
      throw new Error(
        "viewport did not apply — the screen's devtools recorder did not pick it up; retry once",
      )
    await Bun.sleep(250)
  }
}

async function viewportCmd(
  port: number,
  session: string | undefined,
  argv: string[],
): Promise<Record<string, unknown>> {
  if (!session) throw new Error("viewport needs a session")
  const dir = eventsDir(session)
  const current = readDesiredViewport(dir)
  const request = parseViewportRequest(argv, current)
  if (request.kind === "list") {
    return {
      devices: VIEWPORT_PRESETS.map((row) => ({
        name: row.preset,
        label: row.label,
        width: row.width,
        height: row.height,
        dpr: row.dpr,
      })),
    }
  }
  if (request.kind === "status") {
    ensureRecorder(session)
    const live = await liveViewport(port, session)
    return {
      ...viewportLine(live, current),
      applied: readAppliedSignature(dir) === viewportSignature(current),
    }
  }
  const desired = request.kind === "set" ? request.spec : null
  writeDesiredViewport(dir, desired)
  ensureRecorder(session)
  const live = await waitViewportApplied(port, session, dir, desired, current)
  return viewportLine(live, desired)
}

export function verbFrom(argv: string[]): {
  verb: string
  url?: string
  arg?: string
} {
  const [head = "", ...tail] = argv
  // `tab` is the grouped namespace for the flat tab verbs:
  // `tab [list]` -> tabs, `tab new|open [URL]` -> newtab,
  // `tab close [N]` -> closetab, `tab switch|select N` -> switch.
  // The flat verbs stay as aliases so existing calls keep working.
  if (head === "tab") {
    const [sub = "list", ...rest] = tail
    if (sub === "list" || sub === "ls") return { verb: "tabs" }
    if (sub === "new" || sub === "open" || sub === "create")
      return verbFrom(["newtab", ...rest])
    if (sub === "close" || sub === "rm" || sub === "remove")
      return verbFrom(["closetab", ...rest])
    if (sub === "switch" || sub === "select" || sub === "use")
      return verbFrom(["switch", ...rest])
    return { verb: "tab" }
  }
  const verb = head
  const rest = tail
  if (verb === "navigate" || verb === "newtab") {
    let url = ""
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index]
      if (arg === "--url") url = rest[index + 1] ?? ""
      else if (arg.startsWith("--url=")) url = arg.slice(6)
      else if (!arg.startsWith("--") && !url) url = arg
    }
    return { verb, url }
  }
  if (verb === "switch" || verb === "closetab") {
    const arg = rest.find((item) => !item.startsWith("--")) ?? ""
    return { verb, arg }
  }
  return { verb }
}

// One failure is often just a dead screen or browser; healing and retrying
// once inside the same call saves the agent a whole step. Healthy calls pay
// no heal cost at all — the wrappers no longer run it up front.
const UNREACHABLE =
  /unable to connect|not reachable|econnrefused|fetch failed|no page on this screen|cdp connection (timed out|failed)/i

function heal(session: string | undefined) {
  if (!session) return
  try {
    Bun.spawnSync(["/opt/open-bot/screen-heal.sh", session], {
      stdout: "ignore",
      stderr: "inherit",
    })
  } catch {}
}

export async function withHeal<T>(
  session: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!UNREACHABLE.test(message)) throw error
    heal(session)
    return run()
  }
}

async function main() {
  const port = Number(process.argv[2])
  const session = process.argv[3]
  const argv = process.argv.slice(4)
  const { verb, url, arg } = verbFrom(argv)
  if (!Number.isInteger(port) || !verb) throw new Error(USAGE)
  const { positional, flags } = flagsFrom(argv)
  // The verb itself arrives as the first positional; every verb that reads
  // positionals wants the rest.
  const args = positional[0] === verb ? positional.slice(1) : positional
  let state: PageState | TabLine | Record<string, unknown>
  if (verb === "navigate")
    state = await withHeal(session, () => navigate(port, session, url ?? ""))
  else if (verb === "newtab")
    state = await withHeal(session, () => newTab(port, session, url ?? ""))
  else if (verb === "tabs")
    state = await withHeal(session, () => tabsLine(port, session))
  else if (verb === "switch") {
    if (!arg) throw new Error(USAGE)
    state = await withHeal(session, () => switchTab(port, session, arg))
  } else if (verb === "closetab")
    state = await withHeal(session, () => closeTab(port, session, arg ?? ""))
  else if (verb === "url")
    state = await withHeal(session, () => current(port, session))
  else if (verb === "back")
    state = await withHeal(session, () => history(port, session, -1))
  else if (verb === "forward")
    state = await withHeal(session, () => history(port, session, 1))
  else if (verb === "reload")
    state = await withHeal(session, () =>
      reload(port, session, flags.fresh === true),
    )
  else if (verb === "console") state = await consoleCmd(session, flags)
  else if (verb === "network")
    state = await withHeal(session, () => networkCmd(session, args, flags))
  else if (verb === "metrics")
    state = await withHeal(session, () => metricsCmd(port, session))
  else if (verb === "dom")
    state = await withHeal(session, () => domCmd(port, session, args, flags))
  else if (verb === "eval")
    state = await withHeal(session, () => evalCmd(port, session, args, flags))
  else if (verb === "cache")
    state = await withHeal(session, () => cacheCmd(port, session, args, flags))
  // viewport parses its own argv tail: its bare flags (--landscape,
  // --desktop) must not swallow a following preset the way the generic
  // flag parser would.
  else if (verb === "viewport")
    state = await withHeal(session, () =>
      viewportCmd(port, session, argv.slice(1)),
    )
  else throw new Error(USAGE)
  // eval --raw: the JSON value alone on the line, no {url, value} envelope.
  if (typeof state === "object" && state !== null && "__raw" in state) {
    console.log(String((state as { __raw: unknown }).__raw))
    return
  }
  console.log(JSON.stringify(state))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const raw = error instanceof Error ? error.message : "chrome failed"
    let message = raw
    if (/unable to connect|econnrefused|fetch failed/i.test(raw)) {
      message = "chrome is not reachable on this screen"
    }
    console.error(
      /timed out|unresponsive/i.test(message)
        ? `${message}. Recover with ob-chrome --session SESSION navigate URL`
        : message,
    )
    process.exit(1)
  })
}
