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
// 3. getUserMedia needs a secure context, and an opaque origin is never one —
//    navigator.mediaDevices is simply missing, so device pages die silently.
//    Fixed by a media bridge: the shim defines mediaDevices/geolocation/
//    clipboard/requestMIDIAccess stubs that ask the shell (postMessage); the
//    shell captures with its own (trusted) origin and relays live mic/camera/
//    screen tracks over an in-page WebRTC loopback, location fixes, MIDI
//    messages (listen/send/state per port) and clipboard writes as plain
//    messages — the frame gets real results without ever being a secure
//    context. Frames on a dedicated pages origin (secure context) keep the
//    browser's native flow instead. When the bridge is impossible (no
//    parent, no RTCPeerConnection, old dashboard) the stubs reject and post
//    media-blocked to the parent, which shows a banner. The 12 s bridge
//    timeouts post media-blocked too — a stale dashboard shell (no message
//    listener) must surface instead of leaving the app's generic
//    permission-denied banner as the only clue.
// Injected ahead of every page script in frame-rewritten HTML only.
export const FRAME_STORAGE_SHIM = `<script>(function(){function make(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}function fix(n){try{window[n].getItem("ob")}catch(e){try{Object.defineProperty(window,n,{value:make(),configurable:true})}catch(e2){}}}fix("localStorage");fix("sessionStorage");try{document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(e2){}}var of=window.fetch;if(of){window.fetch=function(i,n){n=n||{};if(!n.credentials)n.credentials="include";return of.call(this,i,n)}}var os=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){this.withCredentials=true;return os.apply(this,arguments)};var oe=window.EventSource;if(oe){var WE=function(u,c){c=c||{};if(c.withCredentials===undefined)c.withCredentials=true;return new oe(u,c)};WE.prototype=oe.prototype;window.EventSource=WE};try{if(!window.isSecureContext||!navigator.mediaDevices){var mid=0,mpe={},gw={},mpend={},macc={};var say=function(m){m.source="open-bot-frame";try{parent.postMessage(m,"*")}catch(e){}};var die=function(m){say({type:"media-blocked"});return Promise.reject(new DOMException(m||"device access is unavailable in this frame","NotAllowedError"))};var ask=function(c,display){if(!window.RTCPeerConnection||!window.parent||window.parent===window)return die();return new Promise(function(res,rej){var id="m"+(++mid);mpe[id]={res:res,rej:rej};say({type:"media-request",id:id,display:!!display,audio:!!(c&&c.audio),video:display?true:!!(c&&c.video)});setTimeout(function(){if(mpe[id]){delete mpe[id];say({type:"media-blocked",error:"media bridge unavailable — the dashboard tab may be stale; refresh the dashboard page"});rej(new DOMException("media bridge unavailable","NotAllowedError"))}},12000)})};var gUM=function(c){c=c||{};if(!c.audio&&!c.video)return die();return ask(c,false)};var gDM=function(c){return ask(c,true)};try{Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:gUM,getDisplayMedia:gDM,enumerateDevices:function(){return Promise.resolve([])},addEventListener:function(){},removeEventListener:function(){},ondevicechange:null},configurable:true})}catch(e){}try{Object.defineProperty(navigator,"geolocation",{value:{getCurrentPosition:function(ok,err,o){var id="g"+(++mid);gw[id]={ok:ok,err:err,kind:"current"};say({type:"geo-request",id:id,kind:"current",opts:o||{}});setTimeout(function(){if(gw[id]){delete gw[id];err&&err({code:3,message:"location bridge unavailable"})}},12000)},watchPosition:function(ok,err,o){var id="g"+(++mid);gw[id]={ok:ok,err:err,kind:"watch"};say({type:"geo-request",id:id,kind:"watch",opts:o||{}});return id},clearWatch:function(id){if(gw[id]){delete gw[id];say({type:"geo-clear",id:id})}}},configurable:true})}catch(e){}try{Object.defineProperty(navigator,"clipboard",{value:{writeText:function(t){return new Promise(function(res,rej){var id="c"+(++mid);gw[id]={res:res,rej:rej,kind:"clip"};say({type:"clip-write",id:id,text:String(t)})})}},configurable:true})}catch(e){}var rMA=function(c){c=c||{};if(!window.parent||window.parent===window)return die();return new Promise(function(res,rej){var id="n"+(++mid);mpend[id]={res:res,rej:rej};say({type:"midi-request",id:id,sysex:!!c.sysex});setTimeout(function(){if(mpend[id]){delete mpend[id];say({type:"media-blocked",error:"midi bridge unavailable"});rej(new DOMException("midi bridge unavailable","NotAllowedError"))}},12000)})};try{Object.defineProperty(navigator,"requestMIDIAccess",{value:rMA,configurable:true})}catch(e){}var makeAccess=function(d){var byId={},acc={sysexEnabled:!!d.sysexEnabled,onstatechange:null};var mkPort=function(sp){var port={id:sp.id,name:sp.name,manufacturer:sp.manufacturer,state:sp.state,connection:sp.connection,type:sp.type,version:sp.version,onstatechange:null};port.open=function(){port.connection="open";say({type:"midi-port",id:d.id,portId:sp.id,op:"open"});return Promise.resolve(port)};port.close=function(){port.connection="closed";say({type:"midi-port",id:d.id,portId:sp.id,op:"close"});return Promise.resolve(port)};if(sp.type==="output"){port.send=function(data,ts){var arr=[];for(var i=0;i<data.length;i++)arr.push(data[i]&255);var m={type:"midi-send",id:d.id,portId:sp.id,data:arr};if(typeof ts==="number")m.timestamp=ts;say(m)}}else{Object.defineProperty(port,"onmidimessage",{get:function(){return port._h||null},set:function(fn){port._h=fn||null;say({type:fn?"midi-listen":"midi-unlisten",id:d.id,portId:sp.id})},configurable:true})}byId[sp.id]=port;return port};var mkMap=function(list){var m=new Map();(list||[]).forEach(function(sp){m.set(sp.id,mkPort(sp))});return m};acc.inputs=mkMap(d.inputs);acc.outputs=mkMap(d.outputs);acc._on=function(msg){if(msg.type==="midi-message"){var inp=acc.inputs.get(msg.portId);if(inp&&inp._h)inp._h({data:new Uint8Array(msg.data||[]),timeStamp:msg.ts||0,target:inp});return}if(msg.type==="midi-state"){var keep={},lists={input:msg.inputs||[],output:msg.outputs||[]};["input","output"].forEach(function(k){var map=k==="input"?acc.inputs:acc.outputs;lists[k].forEach(function(sp){keep[k+sp.id]=1;var pt=byId[sp.id];if(pt){pt.name=sp.name;pt.manufacturer=sp.manufacturer;pt.state=sp.state;pt.connection=sp.connection;pt.version=sp.version}else{pt=mkPort(sp);byId[sp.id]=pt;map.set(sp.id,pt)}});var gone=[];map.forEach(function(pt,id){if(!keep[k+id])gone.push(id)});gone.forEach(function(id){map.delete(id)})});var ch=msg.changed&&byId[msg.changed.id];if(ch&&ch.onstatechange)ch.onstatechange({target:ch});if(acc.onstatechange)acc.onstatechange({target:acc,port:ch})}};macc[d.id]=acc;return acc};window.addEventListener("message",function(ev){var d=ev.data;if(!d||d.source!=="open-bot-shell"||!d.id)return;var p=mpe[d.id];if(d.type==="media-denied"){if(p){delete mpe[d.id];p.rej(new DOMException(d.error||"user denied","NotAllowedError"))}return}if(d.type==="media-offer"&&p){delete mpe[d.id];var pc=new RTCPeerConnection();pc.ontrack=function(e){var st=(e.streams&&e.streams[0])||new MediaStream([e.track]);st.getTracks().forEach(function(t){var os2=t.stop.bind(t);t.stop=function(){say({type:"media-release",id:d.id});os2()};t.addEventListener("ended",function(){say({type:"media-release",id:d.id})})});p.res(st)};pc.setRemoteDescription(d.sdp).then(function(){return pc.createAnswer()}).then(function(a){return pc.setLocalDescription(a)}).then(function(){var fin=function(){if(pc.localDescription)say({type:"media-answer",id:d.id,sdp:pc.localDescription.sdp})};if(pc.iceGatheringState==="complete"){fin();return}pc.addEventListener("icegatheringstatechange",function(){if(pc.iceGatheringState==="complete")fin()});setTimeout(fin,1500)}).catch(function(){p.rej(new DOMException("media bridge failed","NotAllowedError"));try{pc.close()}catch(e2){}});return}var q=mpend[d.id];if(d.type==="midi-access"&&q){delete mpend[d.id];q.res(makeAccess(d));return}if(d.type==="midi-denied"&&q){delete mpend[d.id];q.rej(new DOMException(d.error||"user denied","NotAllowedError"));return}var a2=macc[d.id];if(a2&&(d.type==="midi-message"||d.type==="midi-state")){a2._on(d);return}var w=gw[d.id];if(!w)return;if(d.type==="geo-response"){if(d.err){w.err&&w.err(d.err)}else{w.ok&&w.ok(d.pos)}if(w.kind==="current"){delete gw[d.id]}return}if(d.type==="clip-result"){delete gw[d.id];if(d.err){w.rej&&w.rej(new DOMException(d.err,"NotAllowedError"))}else{w.res&&w.res()}return})}}catch(e){}}})()</script>`

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
