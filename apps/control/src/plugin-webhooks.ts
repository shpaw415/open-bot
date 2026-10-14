import type { Db, InstalledPlugin } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { endpoint, startDesktop } from "./docker"
import { HttpError } from "./http-error"
import { resolveDesktopProviders } from "./key-vault"
import { ensurePluginPageServer, pageStateFor } from "./plugin-pages"

// Public webhook surface for plugin page servers: /hooks/<pluginId>/<token>/
// <path>, or /hooks/<pluginId>/<path> with the token as the
// X-Open-Bot-Webhook-Secret header (or ?secret=). The token alone
// authenticates; a hit wakes a sleeping desktop, boots the plugin's page
// server, and proxies the request to it. Opt-in per plugin via
// manifest dashboard.pages.webhook.

export const WEBHOOK_BODY_MAX_BYTES = 25_000_000
export const WEBHOOK_UPSTREAM_TIMEOUT_MS = 30_000
const WEBHOOK_WINDOW_MS = 60_000
const WEBHOOK_WINDOW_MAX = 30
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/
const TOKEN_PATTERN = /^[0-9a-f]{64}$/
const SECRET_HEADER = "x-open-bot-webhook-secret"

export type ParsedWebhookPath = {
  pluginId: string
  token: string | null
  rest: string
}

export function parseWebhookPath(pathname: string): ParsedWebhookPath | null {
  const match = pathname.match(/^\/hooks\/([^/]+)(\/.*)?$/)
  if (!match?.[1]) return null
  const pluginId = match[1]
  if (!PLUGIN_ID_PATTERN.test(pluginId)) return null
  let tail = match[2] && match[2] !== "/" ? match[2] : "/"
  if (tail.includes("\0") || tail.includes("\\") || tail.includes(".."))
    return null
  try {
    tail = decodeURIComponent(tail)
  } catch {
    return null
  }
  if (tail.includes("..") || !tail.startsWith("/")) return null
  let token: string | null = null
  let rest = tail
  if (tail !== "/") {
    const slash = tail.indexOf("/", 1)
    const head = slash === -1 ? tail.slice(1) : tail.slice(1, slash)
    if (TOKEN_PATTERN.test(head)) {
      token = head
      rest = slash === -1 ? "/" : tail.slice(slash)
    }
  }
  return { pluginId, token, rest }
}

export function webhookSecret(
  req: Request,
  url: URL,
  parsed: ParsedWebhookPath,
) {
  if (parsed.token) return parsed.token
  const header = req.headers.get(SECRET_HEADER)?.trim()
  if (header) return header
  const query = url.searchParams.get("secret")?.trim()
  return query || null
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

export function webhookManifestEnabled(manifest: PluginManifest) {
  const pages = manifest.dashboard?.pages
  return Boolean(pages?.entry && pages.webhook === true)
}

async function wakeDesktop(db: Db, userId: string) {
  const desktop = db.desktop(userId)
  if (!desktop) throw new HttpError(404, "not found", "webhook_target")
  const auth = resolveDesktopProviders(db, userId)
  await startDesktop(
    userId,
    desktop,
    auth.viking,
    auth.image,
    auth.system1,
    auth.video,
    auth.model3d,
    auth.chatKeys,
  )
  db.touchDesktop(userId)
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

async function deliverWebhook(
  req: Request,
  url: URL,
  db: Db,
  row: InstalledPlugin,
  body: BodyInit | undefined,
): Promise<Response> {
  const parsed = parseWebhookPath(url.pathname)
  if (!parsed) return new Response("not found", { status: 404 })
  await wakeDesktop(db, row.userId)
  await ensurePluginPageServer(row.userId, row)
  const state = pageStateFor(row.userId, row.pluginId)
  if (!state) {
    throw new HttpError(
      502,
      "page server is not running",
      "webhook_page_server",
    )
  }
  const base = await endpoint(row.userId, "opencode", state.port)
  const query = new URLSearchParams(url.searchParams)
  query.delete("async")
  query.delete("secret")
  const qs = query.toString()
  const dest = new URL(`${parsed.rest}${qs ? `?${qs}` : ""}`, base)
  let upstream: Response
  try {
    upstream = await fetch(dest, {
      method: req.method,
      headers: webhookHeaders(req.headers, state.token),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_UPSTREAM_TIMEOUT_MS),
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
  }
  return upstream
}

// Entry point wired in server.ts ahead of /api/ dispatch. No cookie auth —
// the token is the credential. Anything that fails lookup answers a plain
// 404 so the surface leaks nothing.
export async function handlePluginWebhook(
  req: Request,
  url: URL,
  db: Db,
): Promise<Response> {
  const parsed = parseWebhookPath(url.pathname)
  const secret = parsed ? webhookSecret(req, url, parsed) : null
  const row = secret ? db.installedPluginByWebhookToken(secret) : null
  if (!parsed || !row || !row.enabled) {
    return new Response("not found", { status: 404 })
  }
  const manifest = row.manifest as PluginManifest
  if (!webhookManifestEnabled(manifest)) {
    return new Response("not found", { status: 404 })
  }
  const user = db.userById(row.userId)
  if (!user || user.disabled || !db.desktop(row.userId)) {
    return new Response("not found", { status: 404 })
  }
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return new Response("webhooks do not upgrade", { status: 400 })
  }
  const retry = webhookRetryAfter(row.userId, row.pluginId)
  if (retry) {
    return Response.json(
      { error: "too many webhook requests", code: "webhook_throttled" },
      { status: 429, headers: { "retry-after": String(retry) } },
    )
  }
  // Buffered up front: the 202 path responds before delivery, and Bun would
  // cancel an unread request body once the response is sent.
  const body = await readWebhookBody(req)
  if (url.searchParams.has("async")) {
    void deliverWebhook(req, url, db, row, body).catch(() => {})
    return Response.json({ ok: true, accepted: true }, { status: 202 })
  }
  return deliverWebhook(req, url, db, row, body)
}
