import type { Db, InstalledPlugin, User } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { desktopPhase, endpoint } from "./docker"
import { names } from "./env"
import { HttpError } from "./http-error"
import { randomToken } from "./passwords"
import {
  rewritePreviewCss,
  rewritePreviewHtml,
  type UpgradeServer,
} from "./preview"
import { sh } from "./shell"

// Minimal hub shape so routes holding a plain {emit} can defer restarts too
// (EventHub satisfies it structurally).
type PageHub = {
  emit: (userId: string, event: { type: string; properties?: unknown }) => void
}

// Plugin page servers: one Bun HTTP server per plugin (manifest
// dashboard.pages.entry) on the desktop, proxied to the dashboard under
// /api/pages/<pluginId>/… with streaming (SSE) and WebSocket pass-through.

export const PAGE_PORT_MIN = 4740
export const PAGE_PORT_MAX = 4759
const PAGE_HEALTH_TTL_MS = 5_000
const PAGE_START_THROTTLE_MS = 5_000
const PAGE_START_TIMEOUT_MS = 15_000

// Surfaced with the install/update responses so harnesses see the page
// server's port and health instead of polling blind.
export type PluginPageStartStatus = {
  attempted: boolean
  running: boolean
  port: number | null
  error?: string
}

export function pluginPagePath(pluginId: string) {
  return `/home/agent/.open-bot/pages/${pluginId}`
}

export function pluginPageBin(pluginId: string, entry: string) {
  return `/usr/local/bin/ob-plugin-${pluginId}-${entry}`
}

// Local installs run the page server straight from the checkout so edits show
// up without a reinstall. Returns the checkout entry's absolute path, or null
// for marketplace installs and unsafe paths (the source itself is schema-validated
// relative, but the localPath arrives from the outside and gets quoted into a
// shell command — refuse quotes, backslashes, and escapes from the plugin root).
export function pageCheckoutEntry(
  row: Pick<InstalledPlugin, "source" | "localPath">,
  manifest: PluginManifest,
  entry: string,
): string | null {
  if (row.source !== "local" || !row.localPath) return null
  if (row.localPath.includes("'") || row.localPath.includes("\\")) return null
  const source = (manifest.files ?? []).find(
    (file) => file.name === entry,
  )?.source
  if (!source || source.includes("'")) return null
  return `${row.localPath}/${source}`
}

// The exact bun command line the exec'd server ends up with (exec replaces
// the shell, argv space-joined) — recorded in <id>.cmd so the stop path can
// pkill an orphan even when its pidfile was clobbered by a failed spawn.
export function pageServerCmdline(opts: {
  bin: string
  checkoutEntry?: string | null
}) {
  return opts.checkoutEntry
    ? `bun --hot run ${opts.checkoutEntry}`
    : `bun run ${opts.bin}`
}

// The in-container shell line that runs the page server: records the pid,
// token, resolved port, and exact bun command line next to each other
// (~/.open-bot/pages/<id>.{pid,token,port,cmd}), then execs bun. Local
// checkouts run with --hot so edits apply live; the installed bin (frozen
// payload copy) is the default and the fallback when the checkout file
// disappeared.
export function pageServerCommand(opts: {
  pidFile: string
  token: string
  port: number
  bin: string
  checkoutEntry?: string | null
}) {
  const run = opts.checkoutEntry
    ? `exec bun --hot run '${opts.checkoutEntry}'`
    : `exec bun run '${opts.bin}'`
  const cmdline = pageServerCmdline(opts)
  return [
    `echo $$ > '${opts.pidFile}.pid'`,
    `printf '%s' '${opts.token}' > '${opts.pidFile}.token'`,
    `printf '%s' '${opts.port}' > '${opts.pidFile}.port'`,
    `printf '%s' '${cmdline}' > '${opts.pidFile}.cmd'`,
    run,
    `> '${opts.pidFile}.log' 2>&1`,
  ].join(" && ")
}

export function parsePluginPagePath(pathname: string) {
  const match = pathname.match(/^\/api\/pages\/([^/]+)(\/.*)?$/)
  if (!match?.[1]) return null
  const pluginId = match[1]
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) return null
  let rest = match[2] && match[2] !== "/" ? match[2] : "/"
  if (rest.includes("\0") || rest.includes("\\") || rest.includes(".."))
    return null
  try {
    rest = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (rest.includes("..") || !rest.startsWith("/")) return null
  return { pluginId, rest }
}

// Deterministic port per plugin inside the page range; collisions with an
// already-started sibling server linear-probe upward (in-memory only — the
// assignment is stable for one control lifetime, and servers die with the
// desktop anyway).
export function basePluginPagePort(pluginId: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < pluginId.length; index++) {
    hash ^= pluginId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  const span = PAGE_PORT_MAX - PAGE_PORT_MIN + 1
  return PAGE_PORT_MIN + ((hash >>> 0) % span)
}

type PageState = { port: number; token: string; startedAt: number }

const states = new Map<string, PageState>()
const lastStart = new Map<string, number>()
const healthCache = new Map<string, { ok: boolean; at: number }>()

function stateKey(userId: string, pluginId: string) {
  return `${userId}\0${pluginId}`
}

export function pageStateFor(userId: string, pluginId: string) {
  return states.get(stateKey(userId, pluginId)) ?? null
}

async function pickPort(userId: string, pluginId: string) {
  const taken = new Set<number>()
  for (const [key, state] of states) {
    if (key.startsWith(`${userId}\0`) && key !== stateKey(userId, pluginId)) {
      taken.add(state.port)
    }
  }
  let port = basePluginPagePort(pluginId)
  const span = PAGE_PORT_MAX - PAGE_PORT_MIN + 1
  for (let attempt = 0; attempt < span; attempt++) {
    if (!taken.has(port)) return port
    port = port >= PAGE_PORT_MAX ? PAGE_PORT_MIN : port + 1
  }
  throw new HttpError(
    502,
    "no free plugin page port on this desktop",
    "plugin_page_port",
  )
}

async function healthy(userId: string, pluginId: string, port: number) {
  const key = stateKey(userId, pluginId)
  const hit = healthCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < PAGE_HEALTH_TTL_MS) return hit.ok
  let ok = false
  try {
    const base = await endpoint(userId, "opencode", port)
    await fetch(`${base}/healthz`, {
      signal: AbortSignal.timeout(1_500),
    })
    // Any HTTP response proves the server is up — plugins do not have to
    // implement /healthz (the seed skill recommends it anyway).
    ok = true
  } catch {
    ok = false
  }
  healthCache.set(key, { ok, at: now })
  return ok
}

function emitChanged(hub: PageHub, userId: string) {
  try {
    hub.emit(userId, { type: "pages.changed" })
  } catch {
    // hub down — status refreshes on the next poll anyway
  }
}

// Starts (or confirms) the plugin's page server. Returns the port.
// One spawn per (user, plugin) at a time. Concurrent callers — a restart
// route racing the boot re-sync, a lazy proxy start racing a settings save —
// would each spawn: the second server dies on EADDRINUSE and its dead pid
// overwrites the pidfile while the health probe celebrates the first spawn's
// server. Late callers share the in-flight promise instead.
const inFlightEnsures = new Map<string, Promise<number>>()

export function ensurePluginPageServer(
  userId: string,
  row: InstalledPlugin,
  hub?: PageHub,
): Promise<number> {
  const key = stateKey(userId, row.pluginId)
  const existing = inFlightEnsures.get(key)
  if (existing) return existing
  const promise = ensurePluginPageServerInner(userId, row, hub).finally(() => {
    inFlightEnsures.delete(key)
  })
  inFlightEnsures.set(key, promise)
  return promise
}

async function ensurePluginPageServerInner(
  userId: string,
  row: InstalledPlugin,
  hub?: PageHub,
): Promise<number> {
  const manifest = row.manifest as PluginManifest
  const entry = manifest.dashboard?.pages?.entry
  if (!entry || !row.enabled) {
    throw new HttpError(404, "this plugin has no page server", "plugin_page")
  }
  const pluginId = row.pluginId
  const key = stateKey(userId, pluginId)
  const state = states.get(key)
  if (state && (await healthy(userId, pluginId, state.port))) {
    return state.port
  }
  // A just-waking desktop can report "sleeping" mid-restart (docker ps races
  // the container's boot); give it one short grace pass before failing the
  // install/enable that triggered this.
  if ((await desktopPhase(userId)) !== "running") {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    if ((await desktopPhase(userId)) !== "running") {
      throw new HttpError(502, "desktop is asleep", "plugin_page_desktop")
    }
  }
  const throttleHit = lastStart.get(key)
  if (throttleHit && Date.now() - throttleHit < PAGE_START_THROTTLE_MS) {
    throw new HttpError(
      502,
      "page server is not responding — retry in a moment",
      "plugin_page",
    )
  }
  lastStart.set(key, Date.now())

  const port = await pickPort(userId, pluginId)
  const n = names(userId)
  // Reuse the previous run's token so direct clients (the plugin's own page
  // code) survive a restart; only an explicit stop rotates it.
  const pidFile = pluginPagePath(pluginId)
  const prior = await opencodeExecUser(n.opencode, [
    "sh",
    "-c",
    `cat '${pidFile}.token' 2>/dev/null || true`,
  ])
  const priorToken = prior.stdout.trim()
  const token = /^[0-9a-f]{64}$/.test(priorToken) ? priorToken : randomToken()
  const bin = pluginPageBin(pluginId, entry)
  // Local installs run the checkout copy with --hot (live edits) when it is
  // still on disk; anything else runs the installed bin.
  let checkoutEntry = pageCheckoutEntry(row, manifest, entry)
  if (checkoutEntry) {
    const exists = await opencodeExecUser(n.opencode, [
      "test",
      "-f",
      "--",
      checkoutEntry,
    ])
    if (exists.code !== 0) checkoutEntry = null
  }

  const made = await opencodeExecUser(n.opencode, [
    "mkdir",
    "-p",
    "--",
    "/home/agent/.open-bot/pages",
  ])
  if (made.code !== 0) {
    throw new HttpError(
      502,
      "could not prepare the page directory",
      "plugin_page",
    )
  }
  // Kill anything of this plugin's that is still on the desktop before
  // spawning. The in-memory state dies with the control container while the
  // desktop's server keeps running — spawning without this leaves the old
  // server holding the port: the new one dies on EADDRINUSE, overwrites the
  // pidfile with its dead pid, and the health probe below hits the orphan and
  // reports success with stale code. Restart keeps the token file so clients
  // keep working.
  const killed = await opencodeExecUser(n.opencode, [
    "sh",
    "-c",
    killPageServerScript(pidFile, true),
  ]).catch(() => ({ code: 1, stdout: "", stderr: "" }))
  if (killed.code !== 0) {
    throw new HttpError(
      502,
      "could not stop the previous page server",
      "plugin_page",
    )
  }
  // Detached spawn; the wrapper records the bun pid (exec replaces the shell)
  // so stop is a plain kill. stdout+stderr land next to the pid file: a server
  // that dies on boot (bad entry, EADDRINUSE) leaves a readable reason.
  // Settings + vault reach the server through the plugin config file
  // (~/.config/open-bot/plugin-<id>.json), same as tools.
  const spawned = await sh(
    [
      "docker",
      "exec",
      "-d",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      "-e",
      `OPEN_BOT_PAGE_PORT=${port}`,
      "-e",
      `OPEN_BOT_PAGE_TOKEN=${token}`,
      "-e",
      `OPEN_BOT_PLUGIN_ID=${pluginId}`,
      n.opencode,
      "sh",
      "-c",
      pageServerCommand({ pidFile, token, port, bin, checkoutEntry }),
    ],
    undefined,
    30_000,
  )
  if (spawned.code !== 0) {
    throw new HttpError(
      502,
      `could not start the page server: ${spawned.stderr.slice(0, 200)}`,
      "plugin_page",
    )
  }

  const deadline = Date.now() + PAGE_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (await healthy(userId, pluginId, port)) {
      states.set(key, { port, token, startedAt: Date.now() })
      if (hub) emitChanged(hub, userId)
      return port
    }
  }
  throw new HttpError(
    502,
    `page server did not come up — see ~/.open-bot/pages/${pluginId}.log on the desktop`,
    "plugin_page",
  )
}

function opencodeExecUser(container: string, args: string[]) {
  return sh([
    "docker",
    "exec",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    container,
    ...args,
  ])
}

// TERM the page server, wait up to 3 s, then KILL — an old server still
// holding the deterministic port would kill every future start with
// EADDRINUSE. Two targets: the pidfile pid, and pkill on the exact bun
// command line recorded at spawn (an orphan whose pidfile was overwritten by
// a failed duplicate spawn is invisible to the pid alone). agent-user only:
// pgrep/pkill match the server's own processes, never another user's.
export function killPageServerScript(pidFile: string, keepToken: boolean) {
  const files = keepToken
    ? `'${pidFile}.pid' '${pidFile}.port' '${pidFile}.cmd'`
    : `'${pidFile}.pid' '${pidFile}.token' '${pidFile}.port' '${pidFile}.cmd'`
  return [
    `pid=$(cat '${pidFile}.pid' 2>/dev/null || true)`,
    `cmd=$(cat '${pidFile}.cmd' 2>/dev/null || true)`,
    `[ -n "$pid" ] && kill "$pid" 2>/dev/null || true`,
    `[ -n "$cmd" ] && pkill -TERM -x -f "$cmd" 2>/dev/null || true`,
    "i=0",
    `while [ "$i" -lt 30 ] && { { [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; } || { [ -n "$cmd" ] && pgrep -x -f "$cmd" >/dev/null 2>&1; }; }; do sleep 0.1; i=$((i+1)); done`,
    `[ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true`,
    `[ -n "$cmd" ] && pkill -KILL -x -f "$cmd" 2>/dev/null || true`,
    `rm -f ${files}`,
  ].join("; ")
}

// Stops the plugin's page server (disable/uninstall). Best effort. Restarts
// keep the token file so clients keep working; explicit stops rotate it.
export async function stopPluginPageServer(
  userId: string,
  pluginId: string,
  hub?: PageHub,
  keepToken = false,
) {
  const key = stateKey(userId, pluginId)
  // Let a racing start finish first so the kill below lands on its server
  // instead of racing it (restart then spawns fresh on top).
  const inflight = inFlightEnsures.get(key)
  if (inflight) await inflight.catch(() => {})
  states.delete(key)
  healthCache.delete(key)
  lastStart.delete(key)
  const n = names(userId)
  await opencodeExecUser(n.opencode, [
    "sh",
    "-c",
    killPageServerScript(pluginPagePath(pluginId), keepToken),
  ]).catch(() => {})
  if (hub) emitChanged(hub, userId)
}

// Removes the page server's log file (uninstall cleanup only — the log is
// kept across restarts and disables so a crash stays diagnosable).
export async function removePluginPageLog(userId: string, pluginId: string) {
  const n = names(userId)
  const pidFile = pluginPagePath(pluginId)
  await opencodeExecUser(n.opencode, ["rm", "-f", `${pidFile}.log`]).catch(
    () => {},
  )
}

// On-demand runtime status for the agent (`ob-plugin page <id>`): the port
// comes from the in-memory state, falling back to the .port file the spawn
// writes (the state map only lives for one control lifetime); running is a
// live /healthz probe against that port.
export async function pluginPageRuntime(
  userId: string,
  pluginId: string,
): Promise<{ running: boolean; port: number | null; pid: number | null }> {
  const n = names(userId)
  const pidFile = pluginPagePath(pluginId)
  const read = (suffix: string) =>
    opencodeExecUser(n.opencode, [
      "sh",
      "-c",
      `cat '${pidFile}.${suffix}' 2>/dev/null || true`,
    ]).catch(() => ({ code: 1, stdout: "", stderr: "" }))
  const [portOut, pidOut] = await Promise.all([read("port"), read("pid")])
  const state = pageStateFor(userId, pluginId)
  const fromFile = Number(portOut.stdout.trim())
  const port =
    state?.port ??
    (Number.isInteger(fromFile) && fromFile > 0 ? fromFile : null)
  const pidNumber = Number(pidOut.stdout.trim())
  const pid = Number.isInteger(pidNumber) && pidNumber > 0 ? pidNumber : null
  const running = port !== null && (await healthy(userId, pluginId, port))
  return { running, port, pid }
}

// Restart = stop + start. Used when settings change so the server observes
// the rewritten plugin config file on boot.
export async function restartPluginPageServer(
  userId: string,
  row: InstalledPlugin,
  hub?: PageHub,
) {
  await stopPluginPageServer(userId, row.pluginId, undefined, true)
  return ensurePluginPageServer(userId, row, hub)
}

const PAGE_RESTART_DELAY_MS = 2_000
const pendingRestarts = new Map<string, ReturnType<typeof setTimeout>>()

// Settings and vault saves ride on the page server itself (the page POSTs,
// the server forwards to the control plane, the control plane restarts the
// server). Restarting inline kills the request that triggered the save, so
// defer past the response and coalesce bursts into one restart.
export function schedulePluginPageRestart(
  db: Db,
  userId: string,
  row: InstalledPlugin,
  hub?: PageHub,
) {
  const key = stateKey(userId, row.pluginId)
  const existing = pendingRestarts.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingRestarts.delete(key)
    // The plugin may have been uninstalled or disabled while the restart
    // waited — never resurrect a removed server.
    const current = db.installedPlugin(userId, row.pluginId)
    if (!current || !current.enabled) return
    void restartPluginPageServer(userId, current, hub).catch(() => {})
  }, PAGE_RESTART_DELAY_MS)
  timer.unref?.()
  pendingRestarts.set(key, timer)
}

export function pendingPluginPageRestartsCount() {
  return pendingRestarts.size
}

export function clearPluginPageState() {
  for (const timer of pendingRestarts.values()) clearTimeout(timer)
  pendingRestarts.clear()
  states.clear()
  healthCache.clear()
  lastStart.clear()
}

export type PluginPageInfo = {
  pluginId: string
  name: string
  enabled: boolean
  running: boolean
  tabs: {
    id: string
    title: string
    kind: "page" | "iframe" | "app"
    path?: string
    dataUrl?: string
    pollSeconds?: number
  }[]
}

export async function pluginPageSummaries(
  db: Db,
  user: User,
): Promise<{ pages: PluginPageInfo[]; desktop: string }> {
  const desktop = await desktopPhase(user.id)
  const pages: PluginPageInfo[] = []
  for (const row of db.installedPlugins(user.id)) {
    const manifest = row.manifest as PluginManifest
    const tabs = (manifest.dashboard?.tabs ?? []).filter(
      (tab) => tab.kind === "app" || tab.dataUrl,
    )
    if (tabs.length === 0 && !manifest.dashboard?.pages) continue
    const state = states.get(stateKey(user.id, row.pluginId))
    const running =
      row.enabled && Boolean(state) && state
        ? await healthy(user.id, row.pluginId, state.port)
        : false
    pages.push({
      pluginId: row.pluginId,
      name: manifest.name,
      enabled: row.enabled,
      running,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        kind: tab.kind,
        path: tab.path,
        dataUrl: tab.dataUrl,
        pollSeconds: tab.pollSeconds,
      })),
    })
  }
  return { pages, desktop }
}

// GET /api/pages handler (session user only). Proxying goes through
// proxyPluginPage below, wired in server.ts ahead of the /api/ dispatch.
export async function handlePluginPagesStatus(
  db: Db,
  user: User,
): Promise<Response> {
  const body = await pluginPageSummaries(db, user)
  return Response.json(body)
}

function strippedHeaders(headers: Headers, token: string) {
  const out = new Headers(headers)
  out.delete("host")
  out.delete("accept-encoding")
  out.delete("cookie")
  out.delete("authorization")
  out.set("x-open-bot-page-token", token)
  out.set("cache-control", "no-cache")
  out.set("referrer-policy", "no-referrer")
  return out
}

async function rewritePageBody(
  upstream: Response,
  prefix: string,
): Promise<Response> {
  const type = upstream.headers.get("content-type") ?? ""
  const html = type.includes("text/html")
  const css = type.includes("text/css")
  if (!html && !css) return upstream
  const bytes = await upstream.arrayBuffer()
  if (bytes.byteLength > 2_000_000) return upstream
  const text = new TextDecoder().decode(bytes)
  const body = html
    ? rewritePreviewHtml(text, prefix)
    : rewritePreviewCss(text, prefix)
  const headers = new Headers(upstream.headers)
  headers.delete("content-length")
  headers.delete("x-frame-options")
  if (html && !headers.get("content-type")?.includes("charset")) {
    headers.set("content-type", "text/html; charset=utf-8")
  }
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

// Proxies one request to the plugin's page server on the desktop. Session
// auth happens in server.ts; here the plugin row decides 404s.
export async function proxyPluginPage(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: PageHub,
  server: UpgradeServer,
): Promise<Response | undefined> {
  const parsed = parsePluginPagePath(url.pathname)
  if (!parsed) return new Response("not found", { status: 404 })
  const row = db.installedPlugin(user.id, parsed.pluginId)
  if (!row || !row.enabled) {
    return new Response("plugin page not found", { status: 404 })
  }
  const manifest = row.manifest as PluginManifest
  if (!manifest.dashboard?.pages) {
    return new Response("plugin page not found", { status: 404 })
  }
  let state = pageStateFor(user.id, parsed.pluginId)
  if (!state || !(await healthy(user.id, parsed.pluginId, state.port))) {
    await ensurePluginPageServer(user.id, row, hub)
    state = pageStateFor(user.id, parsed.pluginId)
    if (!state) {
      return new Response("page server is not running", { status: 502 })
    }
  }
  const base = await endpoint(user.id, "opencode", state.port)
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const wsBase = base.replace(/^http/, "ws")
    const ok = server.upgrade(req, {
      data: {
        kind: "proxy",
        target: `${wsBase}${parsed.rest}${url.search}`,
        upstream: null,
        queue: [],
      },
    })
    return ok ? undefined : new Response("upgrade failed", { status: 400 })
  }
  const dest = new URL(`${parsed.rest}${url.search}`, base)
  const upstream = await fetch(dest, {
    method: req.method,
    headers: strippedHeaders(req.headers, state.token),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // let SSE/streaming responses flow through untouched
    redirect: "manual",
    duplex: "half",
  } as RequestInit)
  return rewritePageBody(upstream, `/api/pages/${parsed.pluginId}`)
}
