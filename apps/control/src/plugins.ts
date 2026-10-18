import type { CronJob, Db, PluginAppliedLog, User } from "@open-bot/db"
import {
  configIsSecret,
  manifestIssuesText,
  PLUGIN_VERSION_PATTERN,
  type PluginManifest,
  parsePluginManifest,
  pluginPermissionSummary,
  validateConfigValue,
} from "@open-bot/plugin-kit"
import { nextRunMs } from "./cron"
import {
  githubToken,
  marketplaceToken,
  marketplaceUrl,
  publicOrigin,
} from "./env"
import { HttpError } from "./http-error"
import { keyVaultSpecById } from "./key-vault"
import {
  checkLocalPluginPath,
  readLocalPluginFiles,
  readLocalPluginManifest,
} from "./plugin-local"
import {
  type PluginPageStartStatus,
  pluginPageRuntime,
  restartPluginPageServer,
  schedulePluginPageRestart,
} from "./plugin-pages"
import {
  publicPagesEnabled,
  WEBHOOK_SECRET_MAX_LENGTH,
} from "./plugin-webhooks"
import {
  applyPluginInstall,
  applyPluginUninstall,
  reapplyPluginConfig,
  retryPluginSetup,
  setPluginEnabled,
} from "./plugins-apply"

const POLICY_KEY = "plugin_install_policy"
const AUTO_UPDATE_KEY = "plugin_auto_update"
const MARKET_KEY_SETTING = "marketplace_api_key"
const POLICIES = ["manual", "auto"] as const
type Policy = (typeof POLICIES)[number]
const AUTO_UPDATES = ["off", "stable"] as const
type AutoUpdate = (typeof AUTO_UPDATES)[number]
const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const GUARD_CRON_NAME = (pluginId: string) => `plugin:${pluginId}:guard`
const GUARD_EVERY_SECONDS = 86_400

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function policy(db: Db): Policy {
  const saved = db.getSetting(POLICY_KEY)
  return POLICIES.includes(saved as Policy) ? (saved as Policy) : "manual"
}

function autoUpdate(db: Db): AutoUpdate {
  const saved = db.getSetting(AUTO_UPDATE_KEY)
  return AUTO_UPDATES.includes(saved as AutoUpdate)
    ? (saved as AutoUpdate)
    : "off"
}

// Instance public origin (e.g. https://open-bot.example.com) — the shareable
// base for /hooks/... URLs that `ob-plugin endpoint <id> url` prints. The
// admin sets it on the Plugins tab; it wins over the OPEN_BOT_PUBLIC_URL env
// so an instance can fix its origin without a control-plane redeploy.
const PUBLIC_ORIGIN_KEY = "public_origin"

export function instancePublicOrigin(db: Db): string {
  return db.getSetting(PUBLIC_ORIGIN_KEY) || publicOrigin()
}

function normalizePublicOrigin(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
  if (!raw) return ""
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    if (url.pathname !== "/" || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

// The plugin dashboard home-screen layout: pages of app tiles and folders.
// Keys are tab keys "pluginId:tabId"; stale keys are ignored client-side, so
// validation only guards shape and size.
const LAYOUT_TAB_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}:[a-z0-9][a-z0-9_-]{0,63}$/
const LAYOUT_MAX_PAGES = 9
const LAYOUT_MAX_ITEMS = 64
const LAYOUT_MAX_FOLDER_ITEMS = 16
const LAYOUT_MAX_BYTES = 16384

const hasControlChar = (value: string) => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code === 127) return true
  }
  return false
}

const layoutNameOk = (name: unknown): name is string =>
  typeof name === "string" &&
  name.trim().length > 0 &&
  name.length <= 48 &&
  !hasControlChar(name) &&
  !name.includes("<") &&
  !name.includes(">")

function validateDashboardLayout(value: unknown): string | null {
  if (typeof value !== "string") return "layout must be stored as JSON text"
  if (value.length > LAYOUT_MAX_BYTES) return "layout is too large"
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return "layout must be valid JSON"
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { pages?: unknown }).pages)
  ) {
    return "layout.pages must be a list"
  }
  const pages = (parsed as { pages: unknown[] }).pages
  if (pages.length < 1 || pages.length > LAYOUT_MAX_PAGES)
    return `layout must have 1-${LAYOUT_MAX_PAGES} pages`
  const seen = new Set<string>()
  const folderIds = new Set<string>()
  let total = 0
  for (const [pageIndex, page] of pages.entries()) {
    if (
      typeof page !== "object" ||
      page === null ||
      !Array.isArray((page as { items?: unknown }).items)
    )
      return `page ${pageIndex} must have items`
    for (const [itemIndex, item] of (
      page as { items: unknown[] }
    ).items.entries()) {
      total += 1
      if (total > LAYOUT_MAX_ITEMS)
        return `layout must hold at most ${LAYOUT_MAX_ITEMS} items`
      const where = `page ${pageIndex} item ${itemIndex}`
      if (typeof item !== "object" || item === null)
        return `${where} must be an object`
      const kind = (item as { type?: unknown }).type
      if (kind === "app") {
        const key = (item as { key?: unknown }).key
        if (typeof key !== "string" || !LAYOUT_TAB_KEY_RE.test(key))
          return `${where} has an invalid tab key`
        if (seen.has(key)) return `${where} duplicates tab ${key}`
        seen.add(key)
      } else if (kind === "folder") {
        const id = (item as { id?: unknown }).id
        const name = (item as { name?: unknown }).name
        const items = (item as { items?: unknown }).items
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
          return `${where} has an invalid folder id`
        if (folderIds.has(id)) return `${where} duplicates folder ${id}`
        folderIds.add(id)
        if (!layoutNameOk(name)) return `${where} has an invalid folder name`
        if (!Array.isArray(items)) return `${where} folder must list items`
        if (items.length > LAYOUT_MAX_FOLDER_ITEMS)
          return `${where} folder holds at most ${LAYOUT_MAX_FOLDER_ITEMS} items`
        for (const [folderIndex, entry] of items.entries()) {
          total += 1
          if (total > LAYOUT_MAX_ITEMS)
            return `layout must hold at most ${LAYOUT_MAX_ITEMS} items`
          const key = (entry as { key?: unknown } | null)?.key
          if (typeof key !== "string" || !LAYOUT_TAB_KEY_RE.test(key))
            return `${where} folder item ${folderIndex} has an invalid tab key`
          if (seen.has(key)) return `${where} duplicates tab ${key}`
          seen.add(key)
        }
      } else {
        return `${where} must be an app or a folder`
      }
    }
  }
  return null
}

const updateChecksInFlight = new Set<string>()

// Fire-and-forget: refresh each installed marketplace plugin's "latest"
// version from the marketplace (throttled per row) and auto-update stable
// versions when the instance policy allows it. Never blocks the response.
async function refreshPluginUpdates(
  db: Db,
  user: User,
  hub: {
    emit: (
      userId: string,
      event: { type: string; properties?: unknown },
    ) => void
  },
) {
  if (!marketplaceConfigured(db)) return
  for (const row of db.installedPlugins(user.id)) {
    if (row.source === "local") continue
    if ((row.latestCheckedAt ?? 0) > Date.now() - UPDATE_CHECK_INTERVAL_MS)
      continue
    if (updateChecksInFlight.has(row.pluginId)) continue
    updateChecksInFlight.add(row.pluginId)
    void (async () => {
      try {
        const detail = await fetchDetail(db, row.pluginId)
        db.setInstalledPluginLatest(
          user.id,
          row.pluginId,
          detail.plugin.version,
        )
        if (
          autoUpdate(db) === "stable" &&
          detail.plugin.status === "approved" &&
          STABLE_VERSION_RE.test(detail.plugin.version) &&
          detail.plugin.version !== row.version
        ) {
          await applyPluginInstall(db, user, {
            id: detail.plugin.id,
            version: detail.plugin.version,
            status: detail.plugin.status,
            manifest: detail.manifest,
            readme: detail.readme,
            downloads: detail.plugin.downloads,
          })
          hub.emit(user.id, { type: "plugins.changed" })
        }
      } catch {
        // Marketplace unreachable or plugin gone — mark checked so the next
        // attempt waits a full interval instead of hammering every request.
        try {
          db.setInstalledPluginLatest(user.id, row.pluginId, null)
        } catch {}
      } finally {
        updateChecksInFlight.delete(row.pluginId)
      }
    })()
  }
}

function marketToken(db: Db): string {
  return db.getSetting(MARKET_KEY_SETTING) || marketplaceToken
}

// The installing user's own marketplace API key (paid-plugin licenses and
// publish identity live on their marketplace account), or null.
function userMarketKey(db: Db, userId: string): string | null {
  return db.userById(userId)?.marketplaceApiKey ?? null
}

function marketplaceConfigured(db: Db) {
  return marketplaceUrl !== "" && marketToken(db) !== ""
}

async function marketplace(
  db: Db,
  path: string,
  init: RequestInit & { json?: unknown } = {},
  // Ride the given user's key instead of the instance token (license checks
  // and paid artifact fetches).
  keyOverride?: string | null,
): Promise<Response> {
  const token = keyOverride || marketToken(db)
  if (marketplaceUrl === "" || token === "") {
    throw new HttpError(
      503,
      "the plugin marketplace is not configured on this instance",
      "marketplace_unconfigured",
    )
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  }
  let body: string | undefined
  if (init.json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(init.json)
  }
  let response: Response
  try {
    response = await fetch(`${marketplaceUrl}${path}`, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new HttpError(
      502,
      `marketplace unreachable: ${error instanceof Error ? error.message : "request failed"}`,
      "marketplace_unreachable",
    )
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    let message = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      // keep raw text
    }
    if (
      (response.headers.get("content-type") ?? "").includes("text/html") ||
      /^\s*<(?:!doctype|html)/i.test(text)
    ) {
      // An edge/CDN error page (Cloudflare 52x, worker exception) is not an
      // actionable API answer — collapse the markup to a one-line diagnosis.
      message = `marketplace returned an HTML error page (HTTP ${response.status})`
    }
    // Marketplace 4xx answers are real answers (bad manifest, bad key, not
    // the owner) — surface them verbatim; only upstream/network trouble is
    // rewritten to 502.
    throw new HttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      message || `marketplace request failed (${response.status})`,
      "marketplace_error",
    )
  }
  return response
}

type MarketPlugin = {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string
  category: string
  tags: string[]
  status: "pending" | "approved" | "rejected"
  downloads: number
  // Listing price (USD cents) when the plugin is a paid premium listing.
  priceCents?: number | null
  createdAt: number
  updatedAt: number
}

type MarketDetail = {
  plugin: MarketPlugin
  manifest: PluginManifest
  readme: string | null
  // Review verdict for the chosen version row (the manifest actually served).
  security?: { status: string | null; analyzedAt?: number | null }
  versions: {
    version: string
    createdAt: number
    notes: string | null
    securityStatus?: string | null
  }[]
}

function publicPluginSettings(
  manifest: PluginManifest,
  rows: { key: string; value: string }[],
) {
  const secret = new Set(
    (manifest.configs ?? []).filter(configIsSecret).map((config) => config.key),
  )
  const settings: Record<string, string> = {}
  for (const setting of rows) {
    if (secret.has(setting.key)) continue
    settings[setting.key] = setting.value
  }
  return settings
}

function publicInstalled(
  db: Db,
  row: {
    id: string
    userId: string
    pluginId: string
    version: string
    manifest: Record<string, unknown>
    readme: string | null
    enabled: boolean
    source?: "marketplace" | "local"
    localPath?: string | null
    applied?: PluginAppliedLog
    latestVersion?: string | null
    latestCheckedAt?: number | null
    createdAt: number
    updatedAt: number
    page?: PluginPageStartStatus
  },
) {
  const manifest = row.manifest as PluginManifest
  const setupCommands = Array.isArray(manifest.setup?.commands)
    ? manifest.setup.commands
    : []
  const settings = publicPluginSettings(
    manifest,
    db.pluginSettings(row.userId, row.pluginId),
  )
  return {
    id: row.id,
    pluginId: row.pluginId,
    version: row.version,
    name: typeof manifest.name === "string" ? manifest.name : row.pluginId,
    description:
      typeof manifest.description === "string" ? manifest.description : "",
    author: typeof manifest.author === "string" ? manifest.author : "",
    repo: typeof manifest.repo === "string" ? manifest.repo : "",
    enabled: row.enabled,
    permissions: pluginPermissionSummary(manifest),
    setupCommands,
    init: row.applied?.init ?? null,
    mentionClashes: row.applied?.mentionClashes ?? [],
    settings,
    updateAvailable:
      row.source !== "local" &&
      row.latestVersion &&
      row.latestVersion !== row.version
        ? row.latestVersion
        : null,
    source: row.source === "local" ? "local" : "marketplace",
    localPath: row.source === "local" ? (row.localPath ?? null) : null,
    manifest,
    readme: row.readme,
    ...(row.page ? { page: row.page } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function fetchDetail(
  db: Db,
  pluginId: string,
  version?: string,
): Promise<MarketDetail> {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : ""
  const response = await marketplace(
    db,
    `/api/plugins/${encodeURIComponent(pluginId)}${suffix}`,
  )
  const body = (await response.json()) as MarketDetail
  if (!body?.plugin || !body.manifest) {
    throw new HttpError(404, "plugin not found", "plugin_not_found")
  }
  return body
}

// Paid-plugin entitlement: asks the marketplace whether the requesting user
// (via their own marketplace key) holds an active purchase. The instance
// token alone never licenses anything.
async function licenseFor(
  db: Db,
  pluginId: string,
  userId: string,
): Promise<{ paid: boolean; licensed: boolean; priceCents: number | null }> {
  const response = await marketplace(
    db,
    `/api/plugins/${encodeURIComponent(pluginId)}/license`,
    {},
    userMarketKey(db, userId) ?? undefined,
  )
  if (!response.ok) {
    throw new HttpError(
      502,
      "marketplace license check failed",
      "marketplace_error",
    )
  }
  return (await response.json()) as {
    paid: boolean
    licensed: boolean
    priceCents: number | null
  }
}

export function guardMessage(manifest: PluginManifest): string {
  const name = GUARD_CRON_NAME(manifest.id)
  return [
    `[cron: ${name}] You publish and maintain the open-bot plugin "${manifest.id}" (${manifest.name}) at GitHub repo ${manifest.repo}.`,
    "The script output lists the open issues, pull requests, and marketplace comments that need attention.",
    "For each: read it, judge it, and act — answer questions, fix clear bugs in ~/plugins-create/" +
      manifest.id +
      " (clone if missing), review and merge satisfying PRs, close invalid ones with a kind comment.",
    "Reply to the marketplace comments in the output; read them again with `ob-plugin comments " +
      manifest.id +
      "` if you need more context.",
    "If merged changes warrant a release: bump the version in open-bot.plugin.json, update the changelog, then `ob-plugin publish ~/plugins-create/" +
      manifest.id +
      "` so the marketplace serves the new version.",
    "If there is nothing to do, say exactly that and stop.",
  ].join("\n")
}

const shq = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

export function guardScript(manifest: PluginManifest): string {
  const repo = shq(manifest.repo)
  const id = shq(manifest.id)
  return `issues=$(gh issue list -R ${repo} --state open --limit 30) || exit 1
prs=$(gh pr list -R ${repo} --state open --limit 30) || exit 1
comments=$(ob-plugin comments ${id}) || exit 1
out=""
if [ -n "$issues" ]; then
  out="$out
Open issues:
$issues

"
fi
if [ -n "$prs" ]; then
  out="$out
Open pull requests:
$prs

"
fi
if [ -n "$comments" ]; then
  out="$out
Marketplace comments:
$comments

"
fi
if [ -n "$out" ]; then
  echo '[cron-agent]'
  printf '%s\\n' "$out"
fi
`
}

export function ensureGuardCron(db: Db, user: User, manifest: PluginManifest) {
  const name = GUARD_CRON_NAME(manifest.id)
  const existing = db.cronJobs(user.id).find((job) => job.name === name)
  const message = guardMessage(manifest)
  const script = guardScript(manifest)
  const row: CronJob = {
    id: existing?.id ?? crypto.randomUUID(),
    userId: user.id,
    name,
    message,
    kind: "every" as const,
    cronExpr: null,
    everySeconds: GUARD_EVERY_SECONDS,
    atMs: null,
    enabled: true,
    deleteAfterRun: false,
    sessionId: existing?.sessionId ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    lastRunAt: existing?.lastRunAt ?? null,
    nextRunAt: null,
    runCount: existing?.runCount ?? 0,
    lastError: existing?.lastError ?? null,
    providerId: null,
    modelId: null,
    personaId: null,
    runKind: "auto" as const,
    script,
  }
  row.nextRunAt = existing
    ? (existing.nextRunAt ?? nextRunMs(row))
    : nextRunMs(row)
  if (existing) {
    db.updateCronJob(existing.id, user.id, {
      message,
      script,
      runKind: "auto",
      enabled: true,
      nextRunAt: row.nextRunAt,
    })
    return existing.id
  }
  db.createCronJob(row)
  return row.id
}

/** One-time sweep: rewrite legacy prompt guard jobs to script+auto. */
export function convertGuardCrons(
  db: Db,
  hub?: {
    emit: (
      userId: string,
      event: { type: string; properties?: unknown },
    ) => void
  },
) {
  for (const user of db.listUsers()) {
    let changed = false
    const installed = db.installedPlugins(user.id)
    for (const job of db.cronJobs(user.id)) {
      if (!job.name.startsWith("plugin:") || !job.name.endsWith(":guard"))
        continue
      const pluginId = job.name.slice("plugin:".length, -":guard".length)
      if (!pluginId) continue
      const manifest = installed.find((item) => item.pluginId === pluginId)
        ?.manifest as PluginManifest | undefined
      if (
        !manifest ||
        manifest.id !== pluginId ||
        typeof manifest.repo !== "string" ||
        !manifest.repo ||
        typeof manifest.name !== "string" ||
        !manifest.name
      )
        continue
      const script = guardScript(manifest)
      if (job.runKind === "auto" && job.script === script) continue
      db.updateCronJob(job.id, user.id, {
        message: guardMessage(manifest),
        script,
        runKind: "auto",
      })
      changed = true
    }
    if (changed) hub?.emit(user.id, { type: "cron.changed" })
  }
}

const issueLog = new Map<string, number[]>()
const noticeLog = new Map<string, number[]>()

function recentLimiter(
  log: Map<string, number[]>,
  key: string,
  max: number,
): boolean {
  const now = Date.now()
  const recent = (log.get(key) ?? []).filter(
    (time) => now - time < 60 * 60 * 1000,
  )
  log.set(key, recent)
  if (recent.length >= max) return false
  recent.push(now)
  return true
}

function issueAllowed(userId: string) {
  return recentLimiter(issueLog, userId, 10)
}

async function createIssue(
  repo: string,
  title: string,
  body: string,
): Promise<{ url: string; number: number }> {
  if (!githubToken) {
    throw new HttpError(
      503,
      "GitHub publishing is not configured on this instance",
      "github_unconfigured",
    )
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "open-bot",
    },
    body: JSON.stringify({
      title,
      body: `${body}\n\n_Filed by an open-bot agent._`,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const parsed = (await response.json().catch(() => ({}))) as {
    html_url?: string
    number?: number
    message?: string
  }
  if (!response.ok || !parsed.html_url) {
    throw new HttpError(
      502,
      parsed.message || `GitHub issue failed (${response.status})`,
      "github_issue",
    )
  }
  return { url: parsed.html_url, number: parsed.number ?? 0 }
}

function parsePublishBody(body: Record<string, unknown>) {
  const raw = body.manifest
  if (!raw || typeof raw !== "object") {
    throw new HttpError(400, "manifest is required", "manifest_required")
  }
  const result = parsePluginManifest(JSON.stringify(raw))
  if (!result.ok) {
    throw new HttpError(
      400,
      `invalid manifest:\n${manifestIssuesText(result.issues)}`,
      "manifest_invalid",
    )
  }
  return result.manifest
}

async function installLocalPlugin(
  db: Db,
  user: User,
  hub: {
    emit: (
      userId: string,
      event: { type: string; properties?: unknown },
    ) => void
  },
  rawPath: string,
  confirm: boolean,
  settings: Record<string, string> | undefined,
) {
  const checked = checkLocalPluginPath(rawPath)
  if (!checked.ok) return json({ error: checked.error }, 400)
  const loaded = await readLocalPluginManifest(user.id, checked.path)
  const currentPolicy = policy(db)
  if (currentPolicy === "manual" && !confirm) {
    return json(
      {
        needsConfirm: true,
        policy: currentPolicy,
        local: true,
        path: loaded.path,
        permissions: pluginPermissionSummary(loaded.manifest),
        setupCommands: loaded.manifest.setup?.commands ?? [],
        name: loaded.manifest.name,
        version: loaded.manifest.version,
      },
      409,
    )
  }
  const files = await readLocalPluginFiles(
    user.id,
    loaded.path,
    loaded.manifest,
  )
  const row = await applyPluginInstall(
    db,
    user,
    {
      id: loaded.manifest.id,
      version: loaded.manifest.version,
      status: "approved",
      manifest: loaded.manifest,
      readme: loaded.readme,
      downloads: 0,
    },
    {
      settings,
      source: "local",
      localPath: loaded.path,
      files,
    },
  )
  hub.emit(user.id, { type: "plugins.changed" })
  return json({ plugin: publicInstalled(db, row) })
}

export function handlePlugins(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: {
    emit: (
      userId: string,
      event: { type: string; properties?: unknown },
    ) => void
  },
  _holdOpen?: () => void,
  agent = false,
): Response | Promise<Response> | null {
  const path = url.pathname
  // Plugin mutations fan out to docker + OpenViking and can legitimately
  // exceed Bun.serve's 10s connection idle timeout (skill re-embedding alone
  // runs seconds to minutes). holdOpen disables it for this request.
  const keepAlive = () => _holdOpen?.()

  if (path === "/api/plugins/policy" && req.method === "GET")
    return json({
      policy: policy(db),
      autoUpdate: autoUpdate(db),
      publicOrigin: instancePublicOrigin(db),
    })

  if (path === "/api/plugins/policy" && req.method === "PUT") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        if (body.policy !== undefined) {
          const next = String(body.policy ?? "")
          if (!POLICIES.includes(next as Policy)) {
            return json({ error: "policy must be manual or auto" }, 400)
          }
          db.setSetting(POLICY_KEY, next)
        }
        if (body.autoUpdate !== undefined) {
          const next = String(body.autoUpdate ?? "")
          if (!AUTO_UPDATES.includes(next as AutoUpdate)) {
            return json({ error: "autoUpdate must be off or stable" }, 400)
          }
          db.setSetting(AUTO_UPDATE_KEY, next)
        }
        if (body.publicOrigin !== undefined) {
          const next = normalizePublicOrigin(body.publicOrigin)
          if (next === null) {
            return json(
              {
                error:
                  "publicOrigin must be an http(s) origin like https://open-bot.example.com (no path), or empty to clear",
              },
              400,
            )
          }
          if (next) db.setSetting(PUBLIC_ORIGIN_KEY, next)
          else db.setSetting(PUBLIC_ORIGIN_KEY, "")
        }
        return json({
          policy: policy(db),
          autoUpdate: autoUpdate(db),
          publicOrigin: instancePublicOrigin(db),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/installed" && req.method === "GET") {
    void refreshPluginUpdates(db, user, hub)
    return json({
      plugins: db
        .installedPlugins(user.id)
        .map((row) => publicInstalled(db, row)),
      policy: policy(db),
      autoUpdate: autoUpdate(db),
      publicOrigin: instancePublicOrigin(db),
      configured: marketplaceConfigured(db),
    })
  }

  // Dashboard home-screen layout (mobile grid: page order + folders).
  // The layout is stored verbatim after shape validation; unknown tab keys
  // are tolerated so disabling a plugin keeps its spot.
  if (path === "/api/plugins/dashboard-layout" && req.method === "GET")
    return json({ layout: db.dashboardLayout(user.id) })

  if (path === "/api/plugins/dashboard-layout" && req.method === "PUT") {
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const layout = typeof body.layout === "string" ? body.layout : null
        if (layout === null)
          return json({ error: "layout must be JSON text" }, 400)
        const error = validateDashboardLayout(layout)
        if (error) return json({ error }, 400)
        db.setDashboardLayout(user.id, layout)
        return json({ ok: true })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/marketplace/key" && req.method === "GET")
    return json({
      configured: marketplaceConfigured(db),
      hint: marketToken(db).slice(-4) || null,
      source: db.getSetting(MARKET_KEY_SETTING) ? "account" : "instance",
    })

  if (path === "/api/plugins/marketplace/key" && req.method === "PUT") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const key = String(body.key ?? "").trim()
        if (!/^obm_[A-Za-z0-9_-]{24,120}$/.test(key)) {
          return json(
            { error: "that does not look like a marketplace API key" },
            400,
          )
        }
        db.setSetting(MARKET_KEY_SETTING, key)
        return json({ ok: true, hint: key.slice(-4) })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/marketplace/key" && req.method === "DELETE") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    db.setSetting(MARKET_KEY_SETTING, "")
    return json({ ok: true })
  }

  // Per-user marketplace key: required to install paid plugins (the purchase
  // belongs to the user's marketplace account); also used for their own
  // publish identity. The raw key never leaves the control plane.
  if (path === "/api/plugins/marketplace/user-key" && req.method === "GET") {
    const key = userMarketKey(db, user.id)
    return json({ set: key !== null, hint: key ? key.slice(-4) : null })
  }

  if (path === "/api/plugins/marketplace/user-key" && req.method === "PUT") {
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const key = String(body.key ?? "").trim()
        if (!/^obm_[A-Za-z0-9_-]{24,120}$/.test(key)) {
          return json(
            { error: "that does not look like a marketplace API key" },
            400,
          )
        }
        db.setMarketplaceKey(user.id, key)
        return json({ ok: true, hint: key.slice(-4) })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/marketplace/user-key" && req.method === "DELETE") {
    db.setMarketplaceKey(user.id, null)
    return json({ ok: true })
  }

  if (path === "/api/plugins/market" && req.method === "GET") {
    const query = new URLSearchParams()
    const q = url.searchParams.get("q")?.trim()
    const category = url.searchParams.get("category")?.trim()
    if (q) query.set("q", q)
    if (category) query.set("category", category)
    const suffix = query.toString()
    return marketplace(db, `/api/plugins${suffix ? `?${suffix}` : ""}`).then(
      (response) =>
        new Response(response.body, {
          status: response.status,
          headers: { "content-type": "application/json" },
        }),
    )
  }

  const marketDetail = path.match(/^\/api\/plugins\/market\/([^/]+)$/)
  if (marketDetail && req.method === "GET") {
    const id = decodeURIComponent(marketDetail[1] ?? "")
    return marketplace(db, `/api/plugins/${encodeURIComponent(id)}`).then(
      (response) =>
        new Response(response.body, {
          status: response.status,
          headers: { "content-type": "application/json" },
        }),
    )
  }

  // Paid-plugin entitlement for the dashboard: does the requesting user's
  // marketplace account hold a license? Includes the buy URL when not.
  const marketLicense = path.match(/^\/api\/plugins\/market\/([^/]+)\/license$/)
  if (marketLicense && req.method === "GET") {
    const id = decodeURIComponent(marketLicense[1] ?? "")
    return marketplace(
      db,
      `/api/plugins/${encodeURIComponent(id)}/license`,
      {},
      userMarketKey(db, user.id) ?? undefined,
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          paid?: boolean
          licensed?: boolean
          priceCents?: number | null
        }
        return Response.json(
          {
            ...body,
            checkoutUrl: `${marketplaceUrl}/plugins/${encodeURIComponent(id)}`,
            hasMarketplaceKey: userMarketKey(db, user.id) !== null,
          },
          { status: response.status },
        )
      })
      .catch(() => json({ error: "license check failed" }, 502))
  }

  const comments = path.match(/^\/api\/plugins\/market\/([^/]+)\/comments$/)
  if (comments && req.method === "GET") {
    const id = decodeURIComponent(comments[1] ?? "")
    return marketplace(
      db,
      `/api/plugins/${encodeURIComponent(id)}/comments`,
    ).then(
      (response) =>
        new Response(response.body, {
          status: response.status,
          headers: { "content-type": "application/json" },
        }),
    )
  }
  if (comments && req.method === "POST") {
    const id = decodeURIComponent(comments[1] ?? "")
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const text = String(body.body ?? "").trim()
        if (!text || text.length > 4000) {
          return json({ error: "comment body is required (max 4000)" }, 400)
        }
        return marketplace(
          db,
          `/api/plugins/${encodeURIComponent(id)}/comments`,
          {
            method: "POST",
            json: { body: text, authorKind: "agent", author: "open-bot agent" },
          },
        ).then(
          (response) =>
            new Response(response.body, {
              status: response.status,
              headers: { "content-type": "application/json" },
            }),
        )
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/install" && req.method === "POST") {
    keepAlive()
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const pluginId = String(body.pluginId ?? "").trim()
        const version = String(body.version ?? "").trim()
        const rawPath = String(body.path ?? "").trim()
        const local = body.local === true
        const confirm = body.confirm === true
        if (rawPath && pluginId) {
          return json({ error: "pass pluginId or path, not both" }, 400)
        }
        if (rawPath && version) {
          return json(
            { error: "version cannot be set for a local install" },
            400,
          )
        }
        if (rawPath && local) {
          return json({ error: "pass pluginId or path, not both" }, 400)
        }
        if (!rawPath && !pluginId) {
          return json({ error: "pluginId or path is required" }, 400)
        }
        const settings =
          body.settings && typeof body.settings === "object"
            ? (body.settings as Record<string, string>)
            : undefined
        if (rawPath) {
          return installLocalPlugin(db, user, hub, rawPath, confirm, settings)
        }
        if (local) {
          const installed = db.installedPlugin(user.id, pluginId)
          if (
            !installed ||
            installed.source !== "local" ||
            !installed.localPath
          ) {
            return json({ error: "not a local plugin" }, 404)
          }
          return installLocalPlugin(
            db,
            user,
            hub,
            installed.localPath,
            confirm,
            settings,
          )
        }
        if (version && !PLUGIN_VERSION_PATTERN.test(version)) {
          return json(
            { error: "version must be semver or a dev tag (e.g. beta-1)" },
            400,
          )
        }
        const detail = await fetchDetail(db, pluginId, version || undefined)
        // Compare against the marketplace's returned version list, not
        // plugin.version: that is the listing's latest_version, which dev
        // publishes never move — a pinned `--version beta-N` install would
        // 404 forever even though the marketplace resolved the exact row.
        if (
          version &&
          !detail.versions.some((item) => item.version === version)
        ) {
          return json({ error: `version ${version} does not exist` }, 404)
        }
        const currentPolicy = policy(db)
        if (currentPolicy === "manual" && !confirm) {
          return json(
            {
              needsConfirm: true,
              policy: currentPolicy,
              permissions: pluginPermissionSummary(detail.manifest),
              setupCommands: detail.manifest.setup?.commands ?? [],
              name: detail.plugin.name,
              version: detail.manifest.version,
            },
            409,
          )
        }
        if (detail.plugin.status !== "approved" && currentPolicy !== "auto") {
          return json(
            { error: "this plugin has not been approved on the marketplace" },
            403,
          )
        }
        // Gate on the chosen version row's own review status, not just the
        // listing: a pinned queued/erroring/rejected version must never
        // install — including under install policy "auto". The marketplace
        // detail reports the chosen row's verdict.
        const chosenSecurity =
          detail.security?.status ??
          detail.versions.find(
            (item) => item.version === detail.manifest.version,
          )?.securityStatus ??
          null
        if (chosenSecurity !== "pass") {
          return json(
            {
              error: `version ${detail.manifest.version} has not passed the marketplace security review (status: ${chosenSecurity ?? "unreviewed"})`,
            },
            403,
          )
        }
        // Paid premium plugins need a purchase on the requesting user's
        // marketplace account (lifetime license, updates included). The 402
        // carries the marketplace page so the dashboard can offer the Buy
        // flow; agents get the same pointer in the error text.
        if ((detail.plugin.priceCents ?? 0) > 0) {
          const license = await licenseFor(db, pluginId, user.id).catch(
            () => null,
          )
          if (!license?.licensed) {
            return json(
              {
                error:
                  "this premium plugin requires a one-time purchase — buy it on the marketplace page, then install again",
                needsPurchase: true,
                priceCents: detail.plugin.priceCents ?? null,
                checkoutUrl: `${marketplaceUrl}/plugins/${encodeURIComponent(pluginId)}`,
                hasMarketplaceKey: userMarketKey(db, user.id) !== null,
              },
              402,
            )
          }
        }
        const row = await applyPluginInstall(
          db,
          user,
          {
            id: detail.plugin.id,
            // A pinned `--version` install must record and fetch that exact
            // version — detail.plugin.version is the listing pointer, which
            // dev publishes never move.
            version: version || detail.plugin.version,
            status: detail.plugin.status,
            manifest: detail.manifest,
            readme: detail.readme,
            downloads: detail.plugin.downloads,
          },
          { settings },
        )
        if (marketplaceConfigured(db)) {
          void fetch(
            `${marketplaceUrl}/api/plugins/${encodeURIComponent(detail.plugin.id)}/download`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${marketToken(db)}` },
            },
          ).catch(() => {})
        }
        hub.emit(user.id, { type: "plugins.changed" })
        return json({ plugin: publicInstalled(db, row) })
      })
      .catch((error: unknown) => {
        if (error instanceof HttpError) throw error
        return json(
          { error: error instanceof Error ? error.message : "install failed" },
          500,
        )
      })
  }

  const installed = path.match(/^\/api\/plugins\/installed\/([^/]+)$/)
  if (installed && req.method === "DELETE") {
    keepAlive()
    const pluginId = decodeURIComponent(installed[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    return applyPluginUninstall(db, user, row)
      .then((result) => {
        hub.emit(user.id, { type: "plugins.changed" })
        return json({ ok: true, leftoverSkills: result.leftoverSkills })
      })
      .catch((error: unknown) =>
        json(
          {
            error: error instanceof Error ? error.message : "uninstall failed",
          },
          502,
        ),
      )
  }

  const action = path.match(
    /^\/api\/plugins\/installed\/([^/]+)\/(enable|disable|refresh|setup)$/,
  )
  if (action && req.method === "POST") {
    keepAlive()
    const pluginId = decodeURIComponent(action[1] ?? "")
    const what = action[2]
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    if (what === "refresh") {
      return reapplyPluginConfig(db, user, row)
        .then(() => json({ ok: true }))
        .catch((error: unknown) =>
          json(
            {
              error: error instanceof Error ? error.message : "refresh failed",
            },
            502,
          ),
        )
    }
    if (what === "setup") {
      if (agent) {
        return json({ error: "setup retry requires the dashboard" }, 403)
      }
      return retryPluginSetup(db, user, row)
        .then((init) => {
          hub.emit(user.id, { type: "plugins.changed" })
          return json({ ok: true, init: init ?? null })
        })
        .catch((error: unknown) =>
          json(
            { error: error instanceof Error ? error.message : "setup failed" },
            502,
          ),
        )
    }
    // Deep disable/enable: cron pause, skill unload, config-file (vault
    // secrets) drop, plus the OpenCode surfaces — all reversed on enable.
    return setPluginEnabled(db, user, row, what === "enable")
      .then((updated) => {
        hub.emit(user.id, { type: "plugins.changed" })
        return json({ plugin: publicInstalled(db, updated) })
      })
      .catch((error: unknown) =>
        json(
          {
            error:
              error instanceof Error
                ? error.message
                : "could not toggle the plugin",
          },
          502,
        ),
      )
  }
  // Page-server runtime status for the agent (`ob-plugin page <id>`): the
  // resolved port, live health, and pid. Report-only — it never boots the
  // server (the proxy does that lazily on the first dashboard request).
  const pageRoute = path.match(/^\/api\/plugins\/installed\/([^/]+)\/page$/)
  if (pageRoute && req.method === "GET") {
    const pluginId = decodeURIComponent(pageRoute[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    if (!(row.manifest as PluginManifest).dashboard?.pages) {
      return json({ error: "this plugin has no page server" }, 400)
    }
    return pluginPageRuntime(user.id, pluginId).then((runtime) =>
      json({ pluginId, enabled: row.enabled, ...runtime }),
    )
  }

  // Restart = stop + start; the agent's edit loop for page servers (marketplace
  // installs serve the frozen payload copy, so a restart is how edits land).
  const pageRestart = path.match(
    /^\/api\/plugins\/installed\/([^/]+)\/page\/restart$/,
  )
  if (pageRestart && req.method === "POST") {
    keepAlive()
    const pluginId = decodeURIComponent(pageRestart[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    if (!(row.manifest as PluginManifest).dashboard?.pages) {
      return json({ error: "this plugin has no page server" }, 400)
    }
    if (!row.enabled) return json({ error: "plugin is disabled" }, 400)
    return restartPluginPageServer(user.id, row, hub)
      .then((port) => json({ ok: true, port, source: row.source }))
      .catch((error: unknown) =>
        json(
          {
            error:
              error instanceof Error ? error.message : "page restart failed",
          },
          502,
        ),
      )
  }

  const settings = path.match(/^\/api\/plugins\/installed\/([^/]+)\/settings$/)
  if (settings && req.method === "PUT") {
    keepAlive()
    const pluginId = decodeURIComponent(settings[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const values =
          body.settings && typeof body.settings === "object"
            ? (body.settings as Record<string, unknown>)
            : {}
        // `clear` removes saved values outright (`ob-plugin settings ID KEY=`).
        // The empty-string-in-settings keep rule stays: the dashboard dialog
        // resends every key on each save, so "" there must mean "unchanged".
        const clears = Array.isArray(body.clear)
          ? body.clear.filter((key): key is string => typeof key === "string")
          : []
        const manifest = row.manifest as PluginManifest
        const configs = new Map(
          (manifest.configs ?? []).map((config) => [config.key, config]),
        )
        for (const key of clears) {
          if (!configs.has(key)) {
            return json({ error: `unknown config key: ${key}` }, 400)
          }
        }
        for (const [key, value] of Object.entries(values)) {
          const config = configs.get(key)
          if (!config) {
            return json({ error: `unknown config key: ${key}` }, 400)
          }
          const result = validateConfigValue(config, value)
          if (!result.ok) {
            return json({ error: `${config.key}: ${result.error}` }, 400)
          }
          if (configIsSecret(config) && result.value === "") continue
          db.setPluginSetting(user.id, pluginId, key, result.value)
        }
        for (const key of clears) {
          db.deletePluginSetting(user.id, pluginId, key)
        }
        let deferred = false
        try {
          await reapplyPluginConfig(db, user, row)
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("deferred")))
            throw error
          deferred = true
        }
        // A restart guarantees the page server observes the new settings —
        // but the save request itself rides on that server, so defer it past
        // the response instead of killing the caller mid-flight.
        if ((row.manifest as PluginManifest).dashboard?.pages) {
          schedulePluginPageRestart(db, user.id, row, hub)
        }
        return json({
          ok: true,
          settings: publicPluginSettings(
            manifest,
            db.pluginSettings(user.id, pluginId),
          ),
          ...(deferred
            ? {
                configSync:
                  "deferred — desktop asleep; the file syncs when the desktop starts",
              }
            : {}),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  // Plugin vault: the agent token fills or clears the key vault slugs its own
  // manifest declares via permissions.vaultCreate; the dashboard may also fill
  // custom permissions.vaultRead slugs — shared provider slugs always stay on
  // the Keys tab so its chat re-push keeps running. Values are write-only —
  // no route ever returns them.
  const vault = path.match(/^\/api\/plugins\/installed\/([^/]+)\/vault$/)
  if (vault) {
    keepAlive()
    const pluginId = decodeURIComponent(vault[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    const manifest = row.manifest as PluginManifest
    const creatable = manifest.permissions?.vaultCreate ?? []
    const readable = agent
      ? []
      : (manifest.permissions?.vaultRead ?? []).filter(
          (slug) => !creatable.includes(slug),
        )
    if (req.method === "GET") {
      if (agent) {
        return json({
          slugs: creatable.map((slug) => ({
            slug,
            hasKey: (db.getUserKey(user.id, slug)?.apiKey ?? "") !== "",
          })),
        })
      }
      return json({
        slugs: [...creatable, ...readable].map((slug) => {
          const key = db.getUserKey(user.id, slug)
          return {
            slug,
            hasKey: (key?.apiKey ?? "") !== "",
            access: creatable.includes(slug)
              ? ("create" as const)
              : ("read" as const),
            shared: Boolean(keyVaultSpecById(slug)),
            accountId: key?.accountId ?? "",
            baseUrl: key?.baseUrl ?? "",
          }
        }),
      })
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404)
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const slug = typeof body.slug === "string" ? body.slug.trim() : ""
        if (keyVaultSpecById(slug)) {
          return json(
            {
              error: `${slug} is a shared provider key — manage it on the Config page Keys tab`,
            },
            400,
          )
        }
        if (!creatable.includes(slug) && !readable.includes(slug)) {
          const declared = [...creatable, ...readable]
          return json(
            {
              error: `slug must be one of the plugin's declared vault keys${
                declared.length > 0 ? ` (${declared.join(", ")})` : ""
              }`,
            },
            400,
          )
        }
        const value =
          body.value && typeof body.value === "object"
            ? (body.value as Record<string, unknown>)
            : {}
        // A field present in the payload is set verbatim (empty clears it, so
        // `ob-plugin vault ID SLUG=` still clears); a field left out keeps the
        // stored value — the dashboard saves metadata without re-typing the
        // secret it never saw.
        const current = db.getUserKey(user.id, slug)
        const apiKey =
          typeof value.apiKey === "string"
            ? value.apiKey.trim()
            : (current?.apiKey ?? "")
        if (apiKey.length > 4096) {
          return json({ error: "apiKey is too long" }, 400)
        }
        const accountId =
          typeof value.accountId === "string"
            ? value.accountId.trim()
            : (current?.accountId ?? "")
        const baseUrl =
          typeof value.baseUrl === "string"
            ? value.baseUrl.trim()
            : (current?.baseUrl ?? "")
        db.setUserKey(user.id, slug, {
          apiKey,
          accountId,
          gatewayId: "",
          gatewayToken: "",
          gatewaySlug: "",
          baseUrl,
        })
        let vaultDeferred = false
        try {
          await reapplyPluginConfig(db, user, row)
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("deferred")))
            throw error
          vaultDeferred = true
        }
        if (manifest.dashboard?.pages) {
          schedulePluginPageRestart(db, user.id, row, hub)
        }
        return json({
          ok: true,
          slug,
          ...(vaultDeferred
            ? {
                configSync:
                  "deferred — desktop asleep; the file syncs when the desktop starts",
              }
            : {}),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  // Plugin webhook surface: the public /hooks/<userId>/<pluginId>/ URL plus
  // the optional secret that makes callers authenticate. The agent token
  // manages it alongside the dashboard and may read the raw secret (same
  // trust level as ob-api-key); the browser only ever learns whether a
  // secret is set. GET reports state; POST sets or clears (empty string)
  // the secret.
  const webhookRoute = path.match(
    /^\/api\/plugins\/installed\/([^/]+)\/webhook$/,
  )
  if (webhookRoute) {
    const pluginId = decodeURIComponent(webhookRoute[1] ?? "")
    const row = db.installedPlugin(user.id, pluginId)
    if (!row) return json({ error: "not found" }, 404)
    const manifest = row.manifest as PluginManifest
    if (!publicPagesEnabled(manifest)) {
      if (req.method === "GET") return json({ enabled: false })
      return json({ error: "this plugin has no webhook surface" }, 400)
    }
    if (req.method === "GET") {
      const hookPath = `/hooks/${user.id}/${pluginId}/`
      const origin = agent ? instancePublicOrigin(db) : ""
      return json({
        enabled: true,
        secured: Boolean(row.webhookToken),
        path: hookPath,
        ...(agent ? { secret: row.webhookToken ?? null } : {}),
        ...(origin ? { publicUrl: `${origin}${hookPath}` } : {}),
      })
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404)
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        if (typeof body.secret !== "string") {
          return json({ error: "secret must be a string" }, 400)
        }
        const secret = body.secret.trim()
        if (secret.length > WEBHOOK_SECRET_MAX_LENGTH) {
          return json(
            { error: `secret is too long (max ${WEBHOOK_SECRET_MAX_LENGTH})` },
            400,
          )
        }
        const updated = db.setInstalledPluginWebhookToken(
          user.id,
          pluginId,
          secret || null,
        )
        return json({
          ok: true,
          secured: Boolean(updated?.webhookToken),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  const reviewPoll = path === "/api/plugins/review" && req.method === "GET"
  if (reviewPoll) {
    const id = url.searchParams.get("id")?.trim() ?? ""
    const version = url.searchParams.get("version")?.trim() ?? ""
    if (!id || !version) {
      return json({ error: "id and version are required" }, 400)
    }
    const query = new URLSearchParams({ version })
    return marketplace(
      db,
      `/api/plugins/${encodeURIComponent(id)}/review?${query}`,
    ).then(async (response) => json(await response.json()))
  }

  if (path === "/api/plugins/publish" && req.method === "POST") {
    keepAlive()
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const manifest = parsePublishBody(body)
        // Ride the publishing user's marketplace account key when one is
        // stored: the marketplace stamps listing ownership on first publish,
        // so instance-token publishes used to create ownerless plugins no
        // account could ever claim (blocking paid listings + account
        // republishes). Falls back to the instance token as before.
        const response = await marketplace(
          db,
          "/api/publish",
          {
            method: "POST",
            json: { manifest },
          },
          userMarketKey(db, user.id),
        )
        const payload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        const guardJobId = ensureGuardCron(db, user, manifest)
        const reviewQuery = new URLSearchParams({
          id: manifest.id,
          version: manifest.version,
        })
        return json({
          ok: true,
          pluginId: manifest.id,
          version: manifest.version,
          marketplace: payload,
          guardCronId: guardJobId,
          review: {
            poll: `/api/plugins/review?${reviewQuery}`,
          },
        })
      })
      .catch((error: unknown) => {
        if (error instanceof HttpError) throw error
        return json(
          { error: error instanceof Error ? error.message : "publish failed" },
          500,
        )
      })
  }

  if (path === "/api/plugins/validate" && req.method === "POST") {
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const result = parsePluginManifest(JSON.stringify(body.manifest ?? {}))
        if (!result.ok) {
          return json({ ok: false, issues: result.issues }, 400)
        }
        return json({
          ok: true,
          permissions: pluginPermissionSummary(result.manifest),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/notice" && req.method === "POST") {
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const pluginId = String(body.pluginId ?? "").trim()
        const title = String(body.title ?? "").trim()
        const text = String(body.body ?? "").trim()
        if (!pluginId || !title) {
          return json({ error: "pluginId and title are required" }, 400)
        }
        if (title.length > 120) {
          return json({ error: "title is too long (max 120)" }, 400)
        }
        if (text.length > 500) {
          return json({ error: "body is too long (max 500)" }, 400)
        }
        const installed = db.installedPlugin(user.id, pluginId)
        if (!installed) return json({ error: "plugin is not installed" }, 404)
        if (!installed.enabled)
          return json({ error: "plugin is disabled" }, 409)
        const manifest = installed.manifest as PluginManifest
        if (!manifest.permissions?.notifications) {
          return json(
            { error: "plugin does not declare permissions.notifications" },
            403,
          )
        }
        if (!recentLimiter(noticeLog, `${user.id}:${pluginId}`, 30)) {
          return json(
            { error: "too many notices from this plugin, try again later" },
            429,
          )
        }
        hub.emit(user.id, {
          type: "plugin.notice",
          properties: {
            pluginId,
            name: typeof manifest.name === "string" ? manifest.name : pluginId,
            title: title.slice(0, 120),
            body: text.slice(0, 500),
          },
        })
        return json({ ok: true })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/issue" && req.method === "POST") {
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const pluginId = String(body.pluginId ?? "").trim()
        const title = String(body.title ?? "").trim()
        const text = String(body.body ?? "").trim()
        if (!pluginId || !title) {
          return json({ error: "pluginId and title are required" }, 400)
        }
        if (!issueAllowed(user.id)) {
          return json({ error: "too many issues filed, try again later" }, 429)
        }
        const installed = db.installedPlugin(user.id, pluginId)
        let repo = ""
        if (installed) {
          const manifest = installed.manifest as PluginManifest
          repo = typeof manifest.repo === "string" ? manifest.repo : ""
        }
        if (!repo) {
          const detail = await fetchDetail(db, pluginId)
          repo = detail.plugin.repo
        }
        if (!repo) return json({ error: "plugin has no GitHub repo" }, 400)
        const issue = await createIssue(
          repo,
          title.slice(0, 120),
          text.slice(0, 4000) || "(no details)",
        )
        return json(issue)
      })
      .catch((error: unknown) => {
        if (error instanceof HttpError) throw error
        return json(
          { error: error instanceof Error ? error.message : "issue failed" },
          500,
        )
      })
  }

  if (path === "/api/plugins" && req.method === "GET")
    return json(
      { error: "use /api/plugins/installed or /api/plugins/market" },
      404,
    )

  return null
}
