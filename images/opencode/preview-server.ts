import { watch } from "node:fs"
import { stat } from "node:fs/promises"
import { join, relative } from "node:path"

export const RELOAD_PATH = "/__ob/reload"

const RELOAD_SCRIPT = `<script>
(function () {
  var base = location.pathname.replace(/[^/]*$/, "")
  var proto = location.protocol === "https:" ? "wss:" : "ws:"
  var retries = 0
  function connect() {
    var ws = new WebSocket(proto + "//" + location.host + base + "__ob/reload")
    ws.onopen = function () {
      if (retries > 0) location.reload()
    }
    ws.onmessage = function () {
      location.reload()
    }
    ws.onclose = function () {
      retries += 1
      setTimeout(connect, 400)
    }
  }
  connect()
})()
</script>`

export function injectReload(html: string): string {
  if (html.includes("__ob/reload")) return html
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${RELOAD_SCRIPT}</body>`)
  }
  return `${html}${RELOAD_SCRIPT}`
}

export function safePreviewPath(pathname: string): string | null {
  let path = pathname
  try {
    path = decodeURIComponent(pathname.split("?")[0] ?? pathname)
  } catch {
    return null
  }
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\"))
    return null
  const parts = path.split("/").filter((part) => part && part !== ".")
  if (parts.some((part) => part === "..")) return null
  if (parts.length === 0) return "index.html"
  return parts.join("/")
}

function insideRoot(root: string, file: string) {
  const rel = relative(root, file)
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"))
  )
}

const clients = new Set<Bun.ServerWebSocket<unknown>>()
let reloadTimer: ReturnType<typeof setTimeout> | undefined

function broadcastReload() {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    for (const ws of clients) {
      try {
        ws.send("reload")
      } catch {
        clients.delete(ws)
      }
    }
  }, 80)
}

export async function servePreview(root: string, pathname: string) {
  const rel = safePreviewPath(pathname)
  if (!rel) return new Response("bad path", { status: 400 })
  let file = join(root, rel)
  if (!insideRoot(root, file)) return new Response("bad path", { status: 400 })
  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) {
    file = join(file, "index.html")
    info = await stat(file).catch(() => null)
  }
  if (!info?.isFile() || !insideRoot(root, file)) {
    return new Response("not found", { status: 404 })
  }
  const blob = Bun.file(file)
  if (file.endsWith(".html") || blob.type.includes("text/html")) {
    return new Response(injectReload(await blob.text()), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    })
  }
  return new Response(blob, { headers: { "cache-control": "no-cache" } })
}

function start(root: string, port: number, hostname: string) {
  watch(root, { recursive: true }, (_event, filename) => {
    const name = String(filename ?? "")
    if (name.includes("node_modules") || name.includes(".git")) return
    broadcastReload()
  })
  return Bun.serve({
    port,
    hostname,
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === RELOAD_PATH) {
        if (server.upgrade(req)) return undefined
        return new Response("upgrade required", { status: 426 })
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 })
      }
      return servePreview(root, url.pathname)
    },
    websocket: {
      open(ws) {
        clients.add(ws)
      },
      close(ws) {
        clients.delete(ws)
      },
      message() {},
    },
  })
}

if (import.meta.main) {
  const root = process.env.PREVIEW_DIR ?? ""
  const port = Number(process.env.PORT)
  const hostname = process.env.HOST || "0.0.0.0"
  if (!root.startsWith("/home/agent/workspace") || !Number.isInteger(port)) {
    console.error("PREVIEW_DIR and PORT are required")
    process.exit(1)
  }
  const server = start(root, port, hostname)
  console.log(`preview ${server.url}`)
}
