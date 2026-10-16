import type { Db, InstalledPlugin, User } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { desktopPhase, endpoint } from "./docker"
import { names, pagesOrigin } from "./env"
import { HttpError } from "./http-error"
import { randomToken } from "./passwords"
import { PLUGIN_UI_FILE_NAME } from "./plugin-artifact"
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
// Idle lifecycle: servers exist only while they are being used. Any request
// (dashboard proxy, app frame, webhook, @mention lookup) resets the window;
// the sweeper stops whatever overstays it.
const PAGE_IDLE_STOP_MS = 5 * 60 * 1000
const PAGE_IDLE_SWEEP_MS = 30_000

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

// The bundled dashboard UI (manifest dashboard.pages.ui) is installed as
// PLUGIN_UI_FILE_NAME next to the tools. Only frozen installs get the env —
// local checkouts import the HTML live under bun --hot and ship no ui.html.
export function pageUiEnv(
  pluginId: string,
  manifest: PluginManifest,
  checkoutEntry: string | null,
): string[] {
  if (checkoutEntry) return []
  if (!manifest.dashboard?.pages?.ui) return []
  return [
    "-e",
    `OPEN_BOT_PAGE_UI=${pluginPageBin(pluginId, PLUGIN_UI_FILE_NAME)}`,
  ]
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
  if (entry.includes("'") || entry.includes("\\")) return null
  // Preferred: the entry is also a files[] payload, so the checkout path is
  // exactly the installed copy's source. Fall back to <checkout>/<entry> so
  // local installs hot-reload even when the manifest does not duplicate the
  // page entry under files[] — the caller still test -f's the result before
  // spawning, and a missing checkout file drops to the frozen bin.
  const source = (manifest.files ?? []).find(
    (file) => file.name === entry,
  )?.source
  if (source && !source.includes("'")) return `${row.localPath}/${source}`
  return `${row.localPath}/${entry}`
}

// Absolute paths only: the resolution runs `test -f <path>` without `--`
// (dash's builtin test rejects `--` and always failed the check, silently
// pushing every local install onto the frozen bin), so the path must start
// with `/` to never parse as an operator.
export function isPageCheckoutPath(path: string | null): path is string {
  return typeof path === "string" && path.startsWith("/")
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
    ? `exec bun --hot run '${opts.checkoutEntry}' >> '${opts.pidFile}.log' 2>&1`
    : `exec bun run '${opts.bin}' >> '${opts.pidFile}.log' 2>&1`
  const cmdline = pageServerCmdline(opts)
  return [
    `echo $$ > '${opts.pidFile}.pid'`,
    `printf '%s' '${opts.token}' > '${opts.pidFile}.token'`,
    `printf '%s' '${opts.port}' > '${opts.pidFile}.port'`,
    `printf '%s' '${cmdline}' > '${opts.pidFile}.cmd'`,
    // exec replaces the shell, so the log redirection rides the exec'd
    // command itself — chained after && it would never run and boot
    // errors (bad entry, EADDRINUSE) would vanish.
    run,
  ].join(" && ")
}

// Decode until stable, then reject traversal, backslash, and protocol-relative
// paths. `new URL("//host", base)` would otherwise replace the upstream origin.
export function sanitizePluginRest(raw: string | undefined): string | null {
  let rest = raw && raw !== "/" ? raw : "/"
  for (let pass = 0; pass < 4; pass++) {
    if (!rest.includes("%")) break
    try {
      const next = decodeURIComponent(rest)
      if (next === rest) break
      rest = next
    } catch {
      return null
    }
  }
  if (
    rest.includes("\0") ||
    rest.includes("\\") ||
    rest.includes("..") ||
    !rest.startsWith("/") ||
    rest.startsWith("//")
  ) {
    return null
  }
  return rest
}

export function pluginUpstreamUrl(base: string, rest: string, search: string) {
  if (!rest.startsWith("/") || rest.startsWith("//")) {
    throw new HttpError(400, "bad plugin path", "plugin_path")
  }
  const baseUrl = new URL(base)
  const dest = new URL(baseUrl.origin)
  dest.pathname = rest
  dest.search = search.startsWith("?") ? search.slice(1) : search
  if (dest.origin !== baseUrl.origin) {
    throw new HttpError(400, "bad plugin path", "plugin_path")
  }
  return dest
}

export function parsePluginPagePath(pathname: string) {
  const match = pathname.match(/^\/api\/pages\/([^/]+)(\/.*)?$/)
  if (!match?.[1]) return null
  const pluginId = match[1]
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) return null
  const rest = sanitizePluginRest(match[2])
  if (rest === null) return null
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
const lastActivity = new Map<string, number>()
const healthCache = new Map<string, { ok: boolean; at: number }>()

const PAGE_FRAME_TTL_MS = 10 * 60 * 1000
const PAGE_FRAME_MAX = 1000
type PageFrameGrant = {
  userId: string
  pluginId: string
  expiresAt: number
}
const pageFrameGrants = new Map<string, PageFrameGrant>()

function stateKey(userId: string, pluginId: string) {
  return `${userId}\0${pluginId}`
}

export function pageStateFor(userId: string, pluginId: string) {
  return states.get(stateKey(userId, pluginId)) ?? null
}

// Most recent hub seen — the proxy and frame paths always pass one — so the
// idle sweeper can announce stops to the dashboard even though it runs
// outside any request.
let pageHub: PageHub | null = null

// Any request that reaches a running page server resets its idle window.
// No-op while the server is down (starting one stamps fresh activity).
export function touchPluginPageActivity(userId: string, pluginId: string) {
  const key = stateKey(userId, pluginId)
  if (!states.has(key)) return
  lastActivity.set(key, Date.now())
  ensureIdleSweeper()
}

async function pickPort(userId: string, pluginId: string) {
  const taken = new Set<number>()
  for (const [key, state] of states) {
    if (key.startsWith(`${userId}\0`) && key !== stateKey(userId, pluginId)) {
      taken.add(state.port)
    }
  }
  // Servers from a previous control lifetime still hold their ports (they
  // die with the desktop, not with the control restart), and the in-memory
  // state does not survive that restart — the spawn records the resolved
  // port next to the pid file, so honor those recordings too.
  const ports = await opencodeExecUser(names(userId).opencode, [
    "sh",
    "-c",
    "cat /home/agent/.open-bot/pages/*.port 2>/dev/null || true",
  ]).catch(() => ({ code: 1, stdout: "", stderr: "" }))
  for (const value of ports.stdout.split(/\s+/)) {
    const recorded = Number(value)
    if (
      Number.isInteger(recorded) &&
      recorded >= PAGE_PORT_MIN &&
      recorded <= PAGE_PORT_MAX
    ) {
      taken.add(recorded)
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

async function healthy(
  userId: string,
  pluginId: string,
  port: number,
  opts: { fresh?: boolean } = {},
) {
  const key = stateKey(userId, pluginId)
  const hit = healthCache.get(key)
  const now = Date.now()
  // Callers probing a start in progress pass fresh: a cached failure (5 s
  // TTL) collapses the 15 s wait loop to ~3 real probes and reports
  // "did not come up" for a server that binds seconds later.
  if (!opts.fresh && hit && now - hit.at < PAGE_HEALTH_TTL_MS) return hit.ok
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
    touchPluginPageActivity(userId, pluginId)
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
  if (!isPageCheckoutPath(checkoutEntry)) checkoutEntry = null
  if (checkoutEntry) {
    const exists = await opencodeExecUser(n.opencode, [
      "test",
      "-f",
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
      ...pageUiEnv(pluginId, manifest, checkoutEntry),
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
    if (await healthy(userId, pluginId, port, { fresh: true })) {
      // Health alone can lie when a crashed spawn left a foreign server
      // holding the port — only accept it while the spawned pid is alive.
      const alive = await opencodeExecUser(n.opencode, [
        "sh",
        "-c",
        `pid=$(cat '${pidFile}.pid' 2>/dev/null) && kill -0 "$pid" 2>/dev/null`,
      ]).catch(() => ({ code: 1, stdout: "", stderr: "" }))
      if (alive.code !== 0) continue
      states.set(key, { port, token, startedAt: Date.now() })
      touchPluginPageActivity(userId, pluginId)
      if (hub) {
        pageHub = hub
        emitChanged(hub, userId)
      }
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
  lastActivity.delete(key)
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

let idleSweeper: ReturnType<typeof setInterval> | null = null

function ensureIdleSweeper() {
  if (idleSweeper) return
  idleSweeper = setInterval(() => {
    void sweepIdlePluginPageServers().catch(() => {})
  }, PAGE_IDLE_SWEEP_MS)
  idleSweeper.unref?.()
}

// Stops every page server whose last request is older than the idle window.
// Runs on a lazy interval (first start arms it) and is exported for tests.
// The page token is kept so the next visit restarts transparently — no frame
// remint, and direct clients survive. A stop against an asleep desktop fails
// harmlessly: the state entry is already gone, and the next request respawns.
export async function sweepIdlePluginPageServers(hub?: PageHub) {
  const now = Date.now()
  for (const [key, state] of [...states]) {
    if (inFlightEnsures.has(key)) continue
    const last = lastActivity.get(key) ?? state.startedAt
    if (now - last < PAGE_IDLE_STOP_MS) continue
    const [userId, pluginId] = key.split("\0")
    await stopPluginPageServer(
      userId,
      pluginId,
      hub ?? pageHub ?? undefined,
      true,
    ).catch(() => {})
  }
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
// defer past the response and coalesce bursts into one restart. Lazy
// lifecycle: only a server that is actually up bounces — a stopped one reads
// the rewritten plugin config file on its next start.
export function schedulePluginPageRestart(
  db: Db,
  userId: string,
  row: InstalledPlugin,
  hub?: PageHub,
) {
  const key = stateKey(userId, row.pluginId)
  const existing = pendingRestarts.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    pendingRestarts.delete(key)
    // The plugin may have been uninstalled or disabled while the restart
    // waited — never resurrect a removed server.
    const current = db.installedPlugin(userId, row.pluginId)
    if (!current || !current.enabled) return
    const state = states.get(key)
    if (!state || !(await healthy(userId, row.pluginId, state.port))) return
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
  if (idleSweeper) {
    clearInterval(idleSweeper)
    idleSweeper = null
  }
  states.clear()
  healthCache.clear()
  lastStart.clear()
  lastActivity.clear()
  pageFrameGrants.clear()
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
  storageShim = false,
): Promise<Response> {
  const type = upstream.headers.get("content-type") ?? ""
  const html = type.includes("text/html")
  const css = type.includes("text/css")
  if (!html && !css) return upstream
  const bytes = await upstream.arrayBuffer()
  // 8 MB: standalone UI bundles (bun build --compile --target=browser) inline
  // every asset as base64, so text/html can legitimately be large; skipping
  // the rewrite would drop the base prefix and storage shim silently.
  if (bytes.byteLength > 8_000_000) return upstream
  const text = new TextDecoder().decode(bytes)
  const body = html
    ? rewritePreviewHtml(text, prefix, storageShim)
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
  touchPluginPageActivity(user.id, parsed.pluginId)
  const base = await endpoint(user.id, "opencode", state.port)
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const wsBase = base.replace(/^http/, "ws")
    const ok = server.upgrade(req, {
      data: {
        kind: "proxy",
        target: pluginUpstreamUrl(wsBase, parsed.rest, url.search).toString(),
        upstream: null,
        queue: [],
      },
    })
    return ok ? undefined : new Response("upgrade failed", { status: 400 })
  }
  const dest = pluginUpstreamUrl(base, parsed.rest, url.search)
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

// Control-side JSON GET against a plugin's page server — the same ingress the
// /api/pages proxy uses (lazily boots the server, injects the page token,
// strips client headers). Used for plugin data the control plane itself needs,
// e.g. dynamic @mention entry lists for the reference resolver. Throws when
// the desktop is down, the server never comes up, the answer is not JSON, or
// the timeout fires; the caller decides what "unavailable" means.
export async function pluginPageJson<T>(
  userId: string,
  row: InstalledPlugin,
  path: string,
  timeoutMs = 3000,
): Promise<T> {
  let state = pageStateFor(userId, row.pluginId)
  if (!state || !(await healthy(userId, row.pluginId, state.port))) {
    await ensurePluginPageServer(userId, row)
    state = pageStateFor(userId, row.pluginId)
    if (!state) {
      throw new HttpError(502, "page server is not running", "plugin_page_down")
    }
  }
  touchPluginPageActivity(userId, row.pluginId)
  const base = await endpoint(userId, "opencode", state.port)
  const res = await fetch(new URL(path, base), {
    headers: strippedHeaders(new Headers(), state.token),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  })
  if (!res.ok) {
    throw new HttpError(
      502,
      `page server answered ${res.status}`,
      "plugin_page_status",
    )
  }
  return (await res.json()) as T
}

export function parsePageFramePath(
  pathname: string,
): { token: string; rest: string } | null {
  const match = pathname.match(
    /^\/api\/pages\/_frame\/([A-Za-z0-9_-]{43,})(\/.*)?$/,
  )
  if (!match?.[1]) return null
  const rest = sanitizePluginRest(match[2])
  if (rest === null) return null
  return { token: match[1], rest }
}

export function pageFrameUrl(token: string, rest = "/") {
  const path = rest.startsWith("/") ? rest : `/${rest}`
  const rel = `/api/pages/_frame/${token}${path}`
  const origin = pagesOrigin()
  return origin ? `${origin}${rel}` : rel
}

export function mintPageFrameToken(
  userId: string,
  pluginId: string,
  rest = "/",
  now = Date.now(),
) {
  if (pageFrameGrants.size >= PAGE_FRAME_MAX) {
    const oldest = pageFrameGrants.keys().next().value
    if (oldest) pageFrameGrants.delete(oldest)
  }
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url")
  pageFrameGrants.set(token, {
    userId,
    pluginId,
    expiresAt: now + PAGE_FRAME_TTL_MS,
  })
  return {
    token,
    expiresAt: now + PAGE_FRAME_TTL_MS,
    frameUrl: pageFrameUrl(token, rest),
    isolated: Boolean(pagesOrigin()),
  }
}

export function touchPageFrameToken(token: string, now = Date.now()) {
  const grant = pageFrameGrants.get(token)
  if (!grant || grant.expiresAt <= now) {
    pageFrameGrants.delete(token)
    return null
  }
  grant.expiresAt = now + PAGE_FRAME_TTL_MS
  return grant
}

// Credentialed CORS for the frame path. The sandboxed frame is an opaque
// origin, so its fetches are cross-origin; edge SSO (Cloudflare Access) only
// passes them when the request carries the SSO cookie and the response echoes
// the origin with allow-credentials — "*" is rejected in credentialed mode.
// Reflect is safe: frame endpoints are gated by the 128-bit random frame
// token, and no other /api/* response carries CORS headers, so a page that
// knows the token gains nothing by also sending cookies.
function pageFrameCors(req: Request, response: Response) {
  const headers = new Headers(response.headers)
  headers.set(
    "access-control-allow-origin",
    req.headers.get("origin") ?? "null",
  )
  headers.set("access-control-allow-credentials", "true")
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  )
  const asked = req.headers.get("access-control-request-headers")
  if (asked) headers.set("access-control-allow-headers", asked)
  else headers.delete("access-control-allow-headers")
  headers.append("vary", "Origin")
  headers.append("vary", "Access-Control-Request-Headers")
  headers.delete("x-frame-options")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// Capability-token frame for plugin app tabs. No session cookie: the token
// only authorizes this plugin's page server, so a framed page cannot call
// the rest of /api/*.
export async function proxyPluginPageFrame(
  req: Request,
  url: URL,
  db: Db,
  hub: PageHub,
  server: UpgradeServer,
): Promise<Response | undefined> {
  const parsed = parsePageFramePath(url.pathname)
  if (!parsed)
    return pageFrameCors(req, new Response("not found", { status: 404 }))
  if (req.method === "OPTIONS") {
    return pageFrameCors(req, new Response(null, { status: 204 }))
  }
  const grant = touchPageFrameToken(parsed.token)
  if (!grant)
    return pageFrameCors(req, new Response("unauthorized", { status: 401 }))
  const row = db.installedPlugin(grant.userId, grant.pluginId)
  if (
    !row ||
    !row.enabled ||
    !(row.manifest as PluginManifest).dashboard?.pages
  ) {
    return pageFrameCors(
      req,
      new Response("plugin page not found", { status: 404 }),
    )
  }
  let state = pageStateFor(grant.userId, grant.pluginId)
  if (!state || !(await healthy(grant.userId, grant.pluginId, state.port))) {
    await ensurePluginPageServer(grant.userId, row, hub)
    state = pageStateFor(grant.userId, grant.pluginId)
    if (!state) {
      return pageFrameCors(
        req,
        new Response("page server is not running", { status: 502 }),
      )
    }
  }
  touchPluginPageActivity(grant.userId, grant.pluginId)
  const base = await endpoint(grant.userId, "opencode", state.port)
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const ok = server.upgrade(req, {
      data: {
        kind: "proxy",
        target: pluginUpstreamUrl(
          base.replace(/^http/, "ws"),
          parsed.rest,
          url.search,
        ).toString(),
        upstream: null,
        queue: [],
      },
    })
    return ok
      ? undefined
      : pageFrameCors(req, new Response("upgrade failed", { status: 400 }))
  }
  const dest = pluginUpstreamUrl(base, parsed.rest, url.search)
  const upstream = await fetch(dest, {
    method: req.method,
    headers: strippedHeaders(req.headers, state.token),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
    duplex: "half",
  } as RequestInit)
  const rewritten = await rewritePageBody(
    upstream,
    `/api/pages/_frame/${parsed.token}`,
    // Sandboxed opaque origin: keep storage-using pages alive and let edge
    // SSO cookies ride the page's fetches (see FRAME_STORAGE_SHIM). The
    // direct /api/pages proxy is session-credentialed and needs no shim.
    true,
  )
  return pageFrameCors(req, rewritten)
}
