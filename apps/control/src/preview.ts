import { endpoint, opencodeExec } from "./docker"
import { screenSessionId } from "./screens"

export const PREVIEW_PORT_MIN = 4700
export const PREVIEW_PORT_MAX = 4719
export const PREVIEW_TTL_MS = 10 * 60 * 1000
export const PREVIEW_HTML_LIMIT = 2_000_000

const PORT_CACHE_MS = 5_000

export const PREVIEW_REPLY =
  "To show a page, a site design, or a small web app, load the preview skill and run ob-preview with this thread's screen id. Use that dev server so edits hot-reload. End the reply with ![short title](open-bot://preview). The chat embeds the page. Do not paste the HTML as the only deliverable."

type Grant = {
  userId: string
  sessionId: string
  expiresAt: number
}

export type UpgradeServer = {
  upgrade(
    req: Request,
    options: {
      data: {
        kind: "proxy"
        target: string
        upstream: WebSocket | null
        queue: (string | Buffer)[]
      }
    },
  ): boolean
}

const grants = new Map<string, Grant>()
const portCache = new Map<string, { port: number; at: number }>()

export function previewRegistryPath(sessionId: string) {
  return `/home/agent/.open-bot/preview/${sessionId}`
}

export function previewPortAllowed(port: number) {
  return (
    Number.isInteger(port) &&
    port >= PREVIEW_PORT_MIN &&
    port <= PREVIEW_PORT_MAX
  )
}

// Roots the preview proxy may serve: the agent's workspace and the plugin dev
// checkouts. Both are agent-writable already, so the capability token in the
// frame URL stays the real gate; this keeps a rogue registry file from
// pointing the proxy anywhere it likes.
export function previewRootAllowed(root: string) {
  if (root.includes("\0") || root.includes("..")) return false
  return (
    root === "/home/agent/workspace" ||
    root.startsWith("/home/agent/workspace/") ||
    root === "/home/agent/plugins-create" ||
    root.startsWith("/home/agent/plugins-create/")
  )
}

export function parsePreviewRegistry(
  text: string,
): { port: number; root: string } | null {
  const [portRaw, rootRaw] = text.split("\n")
  const port = Number(portRaw?.trim())
  if (!previewPortAllowed(port)) return null
  const root = rootRaw?.trim() ?? ""
  if (!previewRootAllowed(root)) return null
  return { port, root }
}

export function parsePreviewFramePath(
  pathname: string,
): { token: string; rest: string } | null {
  const match = pathname.match(
    /^\/api\/preview\/frame\/([A-Za-z0-9_-]{43,})(\/.*)?$/,
  )
  if (!match?.[1]) return null
  let rest = match[2] && match[2] !== "/" ? match[2] : "/"
  if (rest.includes("\0") || rest.includes("\\") || rest.includes(".."))
    return null
  try {
    rest = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (rest.includes("..") || !rest.startsWith("/")) return null
  return { token: match[1], rest }
}

export function previewFrameUrl(token: string) {
  return `/api/preview/frame/${token}/`
}

// Sandboxed plugin frames (capability-token iframes without allow-same-origin)
// run on an opaque origin, which breaks agent-authored pages in two ways:
// 1. localStorage/sessionStorage/document.cookie throw a SecurityError on
//    access — the page dies at the first storage read and never wires its
//    fetches. Fixed by shadowing each denied surface with an in-memory
//    fallback (per-load, no persistence — graceful degradation).
// 2. Every fetch/XHR/EventSource is cross-origin, so cookies are omitted by
//    default — edge SSO (Cloudflare Access) then answers with a 302 challenge
//    and the browser reports a CORS error while the page itself rendered fine.
//    Fixed by defaulting credentials on (the frame proxy echoes the origin
//    with allow-credentials; its responses carry no secrets the page doesn't
//    already own — the frame token is the gate).
// Injected ahead of every page script in frame-rewritten HTML only.
export const FRAME_STORAGE_SHIM = `<script>(function(){function make(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}function fix(n){try{window[n].getItem("ob")}catch(e){try{Object.defineProperty(window,n,{value:make(),configurable:true})}catch(e2){}}}fix("localStorage");fix("sessionStorage");try{document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(e2){}}var of=window.fetch;if(of){window.fetch=function(i,n){n=n||{};if(!n.credentials)n.credentials="include";return of.call(this,i,n)}}var os=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){this.withCredentials=true;return os.apply(this,arguments)};var oe=window.EventSource;if(oe){var WE=function(u,c){c=c||{};if(c.withCredentials===undefined)c.withCredentials=true;return new oe(u,c)};WE.prototype=oe.prototype;window.EventSource=WE}})()</script>`

export function rewritePreviewHtml(
  html: string,
  prefix: string,
  storageShim = false,
): string {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`
  const head = storageShim ? FRAME_STORAGE_SHIM : ""
  // Root-absolute sub-resources: attribute form (href/src plus the
  // media-heavy srcset/poster), and url(...) inside inline <style> blocks —
  // the style element is HTML content, so the CSS rewrite below never sees
  // it. Anything relative is handled by the injected <base>.
  const out = html
    .replace(
      /\b(href|src|action|poster|srcset)=(["'])\/(?!\/)/gi,
      `$1=$2${base}`,
    )
    .replace(
      /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_match, open: string, css: string, close: string) =>
        open + rewritePreviewCss(css, base) + close,
    )
  if (/<base\s/i.test(out)) return `${head}${out}`
  if (/<head[^>]*>/i.test(out)) {
    return out.replace(
      /<head[^>]*>/i,
      (tag) => `${tag}${head}<base href="${base}">`,
    )
  }
  return `${head}<base href="${base}">${out}`
}

export function rewritePreviewCss(css: string, prefix: string): string {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`
  return (
    css
      .replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${base}`)
      // @import resolves against the stylesheet's own URL, so the document's
      // <base> never applies — root-absolute imports must be rewritten too.
      .replace(/@import\s+(['"])\/(?!\/)/g, `@import $1${base}`)
  )
}

export function mintPreviewToken(
  userId: string,
  sessionId: string,
  now = Date.now(),
) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url")
  const expiresAt = now + PREVIEW_TTL_MS
  grants.set(token, { userId, sessionId, expiresAt })
  return { token, expiresAt, frameUrl: previewFrameUrl(token) }
}

export function touchPreviewToken(
  token: string,
  now = Date.now(),
): Grant | null {
  const grant = grants.get(token)
  if (!grant || grant.expiresAt <= now) {
    grants.delete(token)
    return null
  }
  grant.expiresAt = now + PREVIEW_TTL_MS
  return grant
}

export function clearPreviewTokens() {
  grants.clear()
  portCache.clear()
}

export async function readPreviewPort(userId: string, sessionId: string) {
  if (!screenSessionId(sessionId)) return null
  const result = await opencodeExec(userId, [
    "cat",
    "--",
    previewRegistryPath(sessionId),
  ])
  if (result.code !== 0) return null
  return parsePreviewRegistry(result.stdout)?.port ?? null
}

async function cachedPreviewPort(userId: string, sessionId: string) {
  const key = `${userId}\0${sessionId}`
  const hit = portCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < PORT_CACHE_MS) return hit.port
  const port = await readPreviewPort(userId, sessionId)
  if (port === null) {
    portCache.delete(key)
    return null
  }
  portCache.set(key, { port, at: now })
  return port
}

function strippedHeaders(headers: Headers) {
  const out = new Headers(headers)
  out.delete("content-encoding")
  out.delete("content-length")
  out.delete("x-frame-options")
  out.set("cache-control", "no-cache")
  out.set("referrer-policy", "no-referrer")
  return out
}

async function rewriteBody(
  upstream: Response,
  prefix: string,
): Promise<Response> {
  const type = upstream.headers.get("content-type") ?? ""
  const html = type.includes("text/html")
  const css = type.includes("text/css")
  if (!html && !css) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: strippedHeaders(upstream.headers),
    })
  }
  const bytes = await upstream.arrayBuffer()
  if (bytes.byteLength > PREVIEW_HTML_LIMIT) {
    return new Response(bytes, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: strippedHeaders(upstream.headers),
    })
  }
  const text = new TextDecoder().decode(bytes)
  const body = html
    ? rewritePreviewHtml(text, prefix)
    : rewritePreviewCss(text, prefix)
  const headers = strippedHeaders(upstream.headers)
  if (html && !headers.get("content-type")?.includes("charset")) {
    headers.set("content-type", "text/html; charset=utf-8")
  }
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export async function proxyPreview(
  req: Request,
  url: URL,
  server: UpgradeServer,
): Promise<Response | undefined> {
  const parsed = parsePreviewFramePath(url.pathname)
  if (!parsed) return new Response("not found", { status: 404 })
  const grant = touchPreviewToken(parsed.token)
  if (!grant) return new Response("preview expired", { status: 401 })
  const port = await cachedPreviewPort(grant.userId, grant.sessionId)
  if (port === null)
    return new Response("preview is not running", { status: 404 })
  const base = await endpoint(grant.userId, "opencode", port)
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
  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.delete("accept-encoding")
  headers.delete("cookie")
  headers.delete("authorization")
  const upstream = await fetch(dest, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    duplex: "half",
  } as RequestInit)
  return rewriteBody(upstream, previewFrameUrl(parsed.token))
}
