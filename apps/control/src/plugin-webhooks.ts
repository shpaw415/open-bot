import { createHash, timingSafeEqual } from "node:crypto"
import type { Db, InstalledPlugin } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { wakeDesktop } from "./desktop-wake"
import { endpoint } from "./docker"
import { HttpError } from "./http-error"
import {
  ensurePluginPageServer,
  pageStateFor,
  pluginUpstreamUrl,
  sanitizePluginRest,
  touchPluginPageActivity,
} from "./plugin-pages"
import type { UpgradeServer } from "./preview"

// Public HTTP surface for plugin page servers. Canonical URLs are
// user-scoped, /hooks/<userId>/<pluginId>/<path>, so coexisting installs of
// one plugin id on a shared instance never collide. The short legacy form
// /hooks/<pluginId>/<path> stays as a deprecated alias. Both behave like a
// normal web server in front of the plugin — any method, HTML/assets/
// streams, WebSocket upgrades — opt-in per plugin via manifest
// dashboard.pages.public. A hit wakes a sleeping desktop, boots the page
// server, and proxies the request. An install may set an optional secret
// (header X-Open-Bot-Webhook-Secret or ?secret=) to require authentication.

export const WEBHOOK_BODY_MAX_BYTES = 25_000_000
export const WEBHOOK_UPSTREAM_TIMEOUT_MS = 30_000
const WEBHOOK_WINDOW_MS = 60_000
const WEBHOOK_WINDOW_MAX = 30
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SECRET_HEADER = "x-open-bot-webhook-secret"
const ASYNC_PARAM = "ob_async"
export const WEBHOOK_SECRET_MAX_LENGTH = 128

export type ParsedWebhookPath =
  | { kind: "user"; userId: string; pluginId: string; rest: string }
  | { kind: "legacy"; pluginId: string; rest: string }

function sanitizeRest(raw: string | undefined): string | null {
  return sanitizePluginRest(raw)
}

export function parseWebhookPath(pathname: string): ParsedWebhookPath | null {
  // User-scoped canonical form: /hooks/<userId>/<pluginId>/<path>. Claimed
  // only when the first segment looks like a user id; anything else falls
  // through to the legacy alias below.
  const scoped = pathname.match(/^\/hooks\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (scoped?.[1] && scoped[2] && USER_ID_PATTERN.test(scoped[1])) {
    const pluginId = scoped[2]
    if (!PLUGIN_ID_PATTERN.test(pluginId)) return null
    const rest = sanitizeRest(scoped[3])
    if (rest === null) return null
    return { kind: "user", userId: scoped[1], pluginId, rest }
  }
  // Deprecated alias: /hooks/<pluginId>/<path>.
  const legacy = pathname.match(/^\/hooks\/([^/]+)(\/.*)?$/)
  if (!legacy?.[1]) return null
  const pluginId = legacy[1]
  if (!PLUGIN_ID_PATTERN.test(pluginId)) return null
  const rest = sanitizeRest(legacy[2])
  if (rest === null) return null
  return { kind: "legacy", pluginId, rest }
}

export function webhookSecret(req: Request, url: URL) {
  const header = req.headers.get(SECRET_HEADER)?.trim()
  if (header) return header
  const query = url.searchParams.get("secret")?.trim()
  return query || null
}

// Query-string secrets leak into access logs, proxy logs, browser history,
// and Referer headers. The header is the canonical form; query-param secrets
// still work but every response announces the deprecation so callers migrate
// before header-only enforcement lands.
export function secretCameFromQuery(req: Request, url: URL) {
  if (req.headers.get(SECRET_HEADER)?.trim()) return false
  return Boolean(url.searchParams.get("secret")?.trim())
}

export function withSecretDeprecation(response: Response): Response {
  const out = new Response(response.body, response)
  out.headers.set("deprecation", "true")
  out.headers.set(
    "warning",
    "299 open-bot - The secret query parameter is deprecated; send X-Open-Bot-Webhook-Secret as a header instead. Query secrets will stop being accepted.",
  )
  return out
}

function secretMatches(candidate: string | null, provided: string) {
  if (!candidate) return false
  const left = createHash("sha256").update(candidate).digest()
  const right = createHash("sha256").update(provided).digest()
  return timingSafeEqual(left, right)
}

export type WebhookTarget =
  | { kind: "ok"; row: InstalledPlugin }
  | { kind: "not_found" }
  | { kind: "ambiguous" }

export function publicPagesEnabled(manifest: PluginManifest) {
  const pages = manifest.dashboard?.pages
  return Boolean(pages?.entry && pages.public === true)
}

// One plugin id may be installed by several users on a shared instance.
// Secured installs only match with their secret; public installs resolve
// directly when unambiguous. Only reached via the deprecated legacy form —
// user-scoped URLs go through resolveUserWebhookTarget.
export function resolveWebhookTarget(
  db: Db,
  pluginId: string,
  secret: string | null,
): WebhookTarget {
  const candidates = db
    .installedPluginsByPluginId(pluginId)
    .filter(
      (row) =>
        row.enabled && publicPagesEnabled(row.manifest as PluginManifest),
    )
  if (candidates.length === 0) return { kind: "not_found" }
  if (secret) {
    const row = candidates.find((row) =>
      secretMatches(row.webhookToken, secret),
    )
    return row ? { kind: "ok", row } : { kind: "not_found" }
  }
  const pub = candidates.filter((row) => !row.webhookToken)
  if (pub.length === 1) return { kind: "ok", row: pub[0] as InstalledPlugin }
  if (pub.length > 1) return { kind: "ambiguous" }
  return { kind: "not_found" }
}

// Canonical user-scoped resolution: (userId, pluginId) is unique, so the
// lookup is direct — secured installs still demand their secret.
export function resolveUserWebhookTarget(
  db: Db,
  userId: string,
  pluginId: string,
  secret: string | null,
): WebhookTarget {
  const row = db.installedPlugin(userId, pluginId)
  if (
    !row ||
    !row.enabled ||
    !publicPagesEnabled(row.manifest as PluginManifest)
  ) {
    return { kind: "not_found" }
  }
  if (row.webhookToken) {
    if (!secret || !secretMatches(row.webhookToken, secret)) {
      return { kind: "not_found" }
    }
    return { kind: "ok", row }
  }
  if (secret) return { kind: "not_found" }
  return { kind: "ok", row }
}

const hits = new Map<string, number[]>()

export function webhookRetryAfter(userId: string, pluginId: string) {
  const key = `${userId}\0${pluginId}`
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(
    (at) => now - at < WEBHOOK_WINDOW_MS,
  )
  if (recent.length >= WEBHOOK_WINDOW_MAX) {
    hits.set(key, recent)
    return Math.max(
      1,
      Math.ceil((WEBHOOK_WINDOW_MS - (now - recent[0])) / 1000),
    )
  }
  recent.push(now)
  hits.set(key, recent)
  return 0
}

export function clearWebhookState() {
  hits.clear()
}

function webhookHeaders(headers: Headers, token: string) {
  const out = new Headers(headers)
  out.delete("host")
  out.delete("accept-encoding")
  out.delete("cookie")
  out.delete("authorization")
  out.delete(SECRET_HEADER)
  out.set("x-open-bot-page-token", token)
  return out
}

async function readWebhookBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const length = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(length) && length > WEBHOOK_BODY_MAX_BYTES) {
    throw new HttpError(413, "webhook body too large", "webhook_body")
  }
  const buffer = await req.arrayBuffer()
  if (buffer.byteLength > WEBHOOK_BODY_MAX_BYTES) {
    throw new HttpError(413, "webhook body too large", "webhook_body")
  }
  return buffer
}

type PageServerState = NonNullable<ReturnType<typeof pageStateFor>>

async function forwardToPlugin(
  req: Request,
  url: URL,
  row: InstalledPlugin,
  parsed: ParsedWebhookPath,
  state: PageServerState,
  body: BodyInit | undefined,
): Promise<Response> {
  const base = await endpoint(row.userId, "opencode", state.port)
  const query = new URLSearchParams(url.searchParams)
  query.delete(ASYNC_PARAM)
  // On secured installs the platform consumed ?secret= as the webhook
  // credential — never forward it upstream, where it would land in the
  // plugin's own logs.
  if (row.webhookToken) query.delete("secret")
  const dest = pluginUpstreamUrl(base, parsed.rest, query.toString())
  // The deadline covers reaching the plugin (headers), not the body —
  // long-lived responses (SSE, downloads) keep streaming after that.
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    WEBHOOK_UPSTREAM_TIMEOUT_MS,
  )
  let upstream: Response
  try {
    upstream = await fetch(dest, {
      method: req.method,
      headers: webhookHeaders(req.headers, state.token),
      body,
      redirect: "manual",
      signal: controller.signal,
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    if (name === "TimeoutError" || name === "AbortError") {
      throw new HttpError(
        504,
        "plugin page server did not respond in time",
        "webhook_timeout",
      )
    }
    throw new HttpError(
      502,
      "plugin page server is not responding",
      "webhook_page_server",
    )
  } finally {
    clearTimeout(timer)
  }
  return upstream
}

// Entry point wired in server.ts ahead of /api/ dispatch. No cookie auth —
// the URL is public; a secret is checked only when the install set one.
// Lookup failures answer a plain 404 so the surface leaks nothing.
export async function handlePluginWebhook(
  req: Request,
  url: URL,
  db: Db,
  server: UpgradeServer,
): Promise<Response | undefined> {
  const parsed = parseWebhookPath(url.pathname)
  if (!parsed) return new Response("not found", { status: 404 })
  const secret = webhookSecret(req, url)
  const deprecate = (res: Response) =>
    secretCameFromQuery(req, url) ? withSecretDeprecation(res) : res
  const target =
    parsed.kind === "user"
      ? resolveUserWebhookTarget(db, parsed.userId, parsed.pluginId, secret)
      : resolveWebhookTarget(db, parsed.pluginId, secret)
  if (target.kind === "not_found") {
    return new Response("not found", { status: 404 })
  }
  if (target.kind === "ambiguous") {
    return Response.json(
      {
        error: "this plugin id is ambiguous on this instance — set a secret",
        code: "webhook_ambiguous",
      },
      { status: 409 },
    )
  }
  const row = target.row
  const user = db.userById(row.userId)
  if (!user || user.disabled || !db.desktop(row.userId)) {
    return new Response("not found", { status: 404 })
  }
  const retry = webhookRetryAfter(row.userId, row.pluginId)
  if (retry) {
    return Response.json(
      { error: "too many webhook requests", code: "webhook_throttled" },
      { status: 429, headers: { "retry-after": String(retry) } },
    )
  }
  await wakeDesktop(db, row.userId)
  await ensurePluginPageServer(row.userId, row)
  // Public traffic counts as activity: an actively-called endpoint stays up,
  // and the idle sweeper stops it five minutes after the last hit.
  touchPluginPageActivity(row.userId, row.pluginId)
  const state = pageStateFor(row.userId, row.pluginId)
  if (!state) {
    throw new HttpError(
      502,
      "page server is not running",
      "webhook_page_server",
    )
  }
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const base = await endpoint(row.userId, "opencode", state.port)
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
    return ok ? undefined : new Response("upgrade failed", { status: 400 })
  }
  // Buffered up front: the 202 path responds before delivery, and Bun would
  // cancel an unread request body once the response is sent.
  const body = await readWebhookBody(req)
  if (url.searchParams.get(ASYNC_PARAM) === "1") {
    void forwardToPlugin(req, url, row, parsed, state, body).catch(() => {})
    return deprecate(
      Response.json({ ok: true, accepted: true }, { status: 202 }),
    )
  }
  return deprecate(await forwardToPlugin(req, url, row, parsed, state, body))
}
