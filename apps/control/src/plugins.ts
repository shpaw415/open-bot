import type { CronJob, Db, User } from "@open-bot/db"
import {
  manifestIssuesText,
  type PluginManifest,
  parsePluginManifest,
  pluginPermissionSummary,
  SEMVER_PATTERN,
} from "@open-bot/plugin-kit"
import { nextRunMs } from "./cron"
import { githubToken, marketplaceToken, marketplaceUrl } from "./env"
import { HttpError } from "./http-error"
import {
  applyPluginInstall,
  applyPluginUninstall,
  reapplyPluginConfig,
} from "./plugins-apply"

const POLICY_KEY = "plugin_install_policy"
const POLICIES = ["manual", "auto"] as const
type Policy = (typeof POLICIES)[number]

const GUARD_CRON_NAME = (pluginId: string) => `plugin:${pluginId}:guard`
const GUARD_EVERY_SECONDS = 86_400

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function policy(db: Db): Policy {
  const saved = db.getSetting(POLICY_KEY)
  return POLICIES.includes(saved as Policy) ? (saved as Policy) : "manual"
}

function marketplaceConfigured() {
  return marketplaceUrl !== "" && marketplaceToken !== ""
}

async function marketplace(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  if (!marketplaceConfigured()) {
    throw new HttpError(
      503,
      "the plugin marketplace is not configured on this instance",
      "marketplace_unconfigured",
    )
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${marketplaceToken}`,
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

function publicInstalled(row: {
  id: string
  pluginId: string
  version: string
  manifest: Record<string, unknown>
  readme: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
}) {
  const manifest = row.manifest as PluginManifest
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
    manifest,
    readme: row.readme,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function fetchDetail(
  pluginId: string,
  version?: string,
): Promise<MarketDetail> {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : ""
  const response = await marketplace(
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

function issueAllowed(userId: string) {
  const now = Date.now()
  const recent = (issueLog.get(userId) ?? []).filter(
    (time) => now - time < 60 * 60 * 1000,
  )
  issueLog.set(userId, recent)
  if (recent.length >= 10) return false
  recent.push(now)
  return true
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

export function handlePlugins(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: { emit: (userId: string, event: { type: string }) => void },
): Response | Promise<Response> | null {
  const path = url.pathname

  if (path === "/api/plugins/policy" && req.method === "GET")
    return json({ policy: policy(db) })

  if (path === "/api/plugins/policy" && req.method === "PUT") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    return req
      .json()
      .then((body: Record<string, unknown>) => {
        const next = String(body.policy ?? "")
        if (!POLICIES.includes(next as Policy)) {
          return json({ error: "policy must be manual or auto" }, 400)
        }
        db.setSetting(POLICY_KEY, next)
        return json({ policy: next })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/installed" && req.method === "GET")
    return json({
      plugins: db.installedPlugins(user.id).map(publicInstalled),
      policy: policy(db),
      configured: marketplaceConfigured(),
    })

  if (path === "/api/plugins/market" && req.method === "GET") {
    const query = new URLSearchParams()
    const q = url.searchParams.get("q")?.trim()
    const category = url.searchParams.get("category")?.trim()
    if (q) query.set("q", q)
    if (category) query.set("category", category)
    const suffix = query.toString()
    return marketplace(`/api/plugins${suffix ? `?${suffix}` : ""}`).then(
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
    return marketplace(`/api/plugins/${encodeURIComponent(id)}`).then(
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
    return marketplace(`/api/plugins/${encodeURIComponent(id)}/comments`).then(
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
        return marketplace(`/api/plugins/${encodeURIComponent(id)}/comments`, {
          method: "POST",
          json: { body: text, authorKind: "agent", author: "open-bot agent" },
        }).then(
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
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const pluginId = String(body.pluginId ?? "").trim()
        const version = String(body.version ?? "").trim()
        const confirm = body.confirm === true
        if (!pluginId) return json({ error: "pluginId is required" }, 400)
        if (version && !SEMVER_PATTERN.test(version)) {
          return json({ error: "version must be semver" }, 400)
        }
        const detail = await fetchDetail(pluginId, version || undefined)
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
        const settings =
          body.settings && typeof body.settings === "object"
            ? (body.settings as Record<string, string>)
            : undefined
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
        if (marketplaceConfigured()) {
          void fetch(
            `${marketplaceUrl}/api/plugins/${encodeURIComponent(detail.plugin.id)}/download`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${marketplaceToken}` },
            },
          ).catch(() => {})
        }
        hub.emit(user.id, { type: "plugins.changed" })
        return json({ plugin: publicInstalled(row) })
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
    /^\/api\/plugins\/installed\/([^/]+)\/(enable|disable|refresh)$/,
  )
  if (action && req.method === "POST") {
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
    const updated = db.setInstalledPluginEnabled(
      user.id,
      pluginId,
      what === "enable",
    )
    hub.emit(user.id, { type: "plugins.changed" })
    return json({ plugin: updated ? publicInstalled(updated) : null })
  }

  const settings = path.match(/^\/api\/plugins\/installed\/([^/]+)\/settings$/)
  if (settings && req.method === "PUT") {
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
        for (const [key, value] of Object.entries(values)) {
          db.setPluginSetting(user.id, pluginId, key, String(value))
        }
        await reapplyPluginConfig(db, user, row)
        return json({
          ok: true,
          settings: db.pluginSettings(user.id, pluginId),
        })
      })
      .catch(() => json({ error: "invalid json" }, 400))
  }

  if (path === "/api/plugins/publish" && req.method === "POST") {
    return req
      .json()
      .then(async (body: Record<string, unknown>) => {
        const manifest = parsePublishBody(body)
        const response = await marketplace("/api/publish", {
          method: "POST",
          json: { manifest },
        })
        const payload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        const guardJobId = ensureGuardCron(db, user, manifest)
        return json({
          ok: true,
          pluginId: manifest.id,
          version: manifest.version,
          marketplace: payload,
          guardCronId: guardJobId,
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
          const detail = await fetchDetail(pluginId)
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
