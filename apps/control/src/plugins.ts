import type { CronJob, Db, PluginAppliedLog, User } from "@open-bot/db"
import {
  manifestIssuesText,
  PLUGIN_VERSION_PATTERN,
  type PluginManifest,
  parsePluginManifest,
  pluginPermissionSummary,
  validateConfigValue,
} from "@open-bot/plugin-kit"
import { nextRunMs } from "./cron"
import { githubToken, marketplaceToken, marketplaceUrl } from "./env"
import { HttpError } from "./http-error"
import {
  checkLocalPluginPath,
  readLocalPluginFiles,
  readLocalPluginManifest,
} from "./plugin-local"
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

function marketplaceConfigured(db: Db) {
  return marketplaceUrl !== "" && marketToken(db) !== ""
}

async function marketplace(
  db: Db,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const token = marketToken(db)
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
    throw new HttpError(
      response.status === 404 ? 404 : 502,
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
  createdAt: number
  updatedAt: number
}

type MarketDetail = {
  plugin: MarketPlugin
  manifest: PluginManifest
  readme: string | null
  versions: { version: string; createdAt: number; notes: string | null }[]
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
  },
) {
  const manifest = row.manifest as PluginManifest
  const setupCommands = Array.isArray(manifest.setup?.commands)
    ? manifest.setup.commands
    : []
  const settings: Record<string, string> = {}
  for (const setting of db.pluginSettings(row.userId, row.pluginId)) {
    settings[setting.key] = setting.value
  }
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

export function ensureGuardCron(db: Db, user: User, manifest: PluginManifest) {
  const name = GUARD_CRON_NAME(manifest.id)
  const existing = db.cronJobs(user.id).find((job) => job.name === name)
  const message = [
    `[cron: ${name}] You publish and maintain the open-bot plugin "${manifest.id}" (${manifest.name}) at GitHub repo ${manifest.repo}.`,
    "Check the repo for open issues and pull requests: `gh issue list -R " +
      manifest.repo +
      "` and `gh pr list -R " +
      manifest.repo +
      "`.",
    "For each: read it, judge it, and act — answer questions, fix clear bugs in ~/plugins-create/" +
      manifest.id +
      " (clone if missing), review and merge satisfying PRs, close invalid ones with a kind comment.",
    "Also check the marketplace discussion: `ob-plugin comments " +
      manifest.id +
      "` and reply.",
    "If merged changes warrant a release: bump the version in open-bot.plugin.json, update the changelog, then `ob-plugin publish ~/plugins-create/" +
      manifest.id +
      "` so the marketplace serves the new version.",
    "If there is nothing to do, say exactly that and stop.",
  ].join("\n")
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
    runKind: "prompt" as const,
    script: null,
  }
  row.nextRunAt = existing
    ? (existing.nextRunAt ?? nextRunMs(row))
    : nextRunMs(row)
  if (existing) {
    db.updateCronJob(existing.id, user.id, {
      message,
      enabled: true,
      nextRunAt: row.nextRunAt,
    })
    return existing.id
  }
  db.createCronJob(row)
  return row.id
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
): Response | Promise<Response> | null {
  const path = url.pathname
  // Plugin mutations fan out to docker + OpenViking and can legitimately
  // exceed Bun.serve's 10s connection idle timeout (skill re-embedding alone
  // runs seconds to minutes). holdOpen disables it for this request.
  const keepAlive = () => _holdOpen?.()

  if (path === "/api/plugins/policy" && req.method === "GET")
    return json({ policy: policy(db), autoUpdate: autoUpdate(db) })

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
        return json({ policy: policy(db), autoUpdate: autoUpdate(db) })
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
      configured: marketplaceConfigured(db),
    })
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
        if (version && detail.plugin.version !== version) {
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
              version: detail.plugin.version,
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
        const row = await applyPluginInstall(
          db,
          user,
          {
            id: detail.plugin.id,
            version: detail.plugin.version,
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
      .then(() => {
        hub.emit(user.id, { type: "plugins.changed" })
        return json({ ok: true })
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
        const manifest = row.manifest as PluginManifest
        const configs = new Map(
          (manifest.configs ?? []).map((config) => [config.key, config]),
        )
        for (const [key, value] of Object.entries(values)) {
          const config = configs.get(key)
          if (!config) {
            return json({ error: `unknown config key: ${key}` }, 400)
          }
          const result = validateConfigValue(config, value)
          if (!result.ok) {
            return json({ error: `${config.key}: ${result.error}` }, 400)
          }
          db.setPluginSetting(user.id, pluginId, key, result.value)
        }
        await reapplyPluginConfig(db, user, row)
        return json({
          ok: true,
          settings: db.pluginSettings(user.id, pluginId),
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
        const response = await marketplace(db, "/api/publish", {
          method: "POST",
          json: { manifest },
        })
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
