// Stock Dashboard example page server.
//
// Run by the control plane with Bun after install/boot:
//   OPEN_BOT_PAGE_PORT  port to listen on
//   OPEN_BOT_PAGE_TOKEN shared secret (arrives as x-open-bot-page-token)
//   OPEN_BOT_PLUGIN_ID  this plugin's id
//   OPEN_BOT_PAGE_UI    frozen installs: absolute path to the control plane's
//                       standalone bundle of index.html (all assets inlined)
// Settings and vault keys live in ~/.config/open-bot/plugin-<id>.json.
//
// The dashboard UI is real files next to this script — index.html + app.ts +
// styles.css — never template strings. Two ways it reaches the browser:
// - Frozen installs (marketplace): the control plane bundles index.html with
//   `bun build --compile --target=browser` at install and passes the single
//   self-contained file through OPEN_BOT_PAGE_UI.
// - Local installs and previews: the checkout runs with `bun --hot` and the
//   HTML import below bundles live — edit app.ts and reload, no build step.

type StockItem = { id: number; name: string; qty: number }

const port = Number(process.env.OPEN_BOT_PAGE_PORT ?? 4740)

// In-memory stock. Restart the page server (settings change, upgrade) resets
// it; keep durable state under /home/agent/.open-bot/pages-data/ instead.
const items: StockItem[] = [
  { id: 1, name: "Widget", qty: 12 },
  { id: 2, name: "Gear", qty: 40 },
  { id: 3, name: "Lever", qty: 7 },
]
let nextId = 4

type SseClient = { send: (line: string) => void }
const sseClients = new Set<SseClient>()

function broadcast() {
  const line = `data: ${JSON.stringify({ items })}\n\n`
  for (const client of sseClients) client.send(line)
}

function summary() {
  return {
    count: items.length,
    total: items.reduce((sum, item) => sum + item.qty, 0),
    rows: items.map((item) => [item.name, String(item.qty)]),
  }
}

// The "/" route. Frozen installs serve the control plane's standalone bundle
// file (a plain Response); local checkouts import index.html live — Bun
// bundles app.ts and styles.css into it and hot-reloads on edits. The HTML
// import only works as a static routes value, so the table branches on the
// mode before the server starts.
const routes = process.env.OPEN_BOT_PAGE_UI
  ? {
      "/": () =>
        new Response(Bun.file(process.env.OPEN_BOT_PAGE_UI as string), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    }
  : { "/": await import("./index.html").then((m) => m.default) }

const server = Bun.serve({
  port,
  routes,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/healthz") return new Response("ok")

    if (url.pathname === "/mentions") {
      // The control plane injects the dashboard's language (Config page →
      // Langue) on every proxied request — localize with it, never ask the
      // user to pick inside the plugin.
      const fr = req.headers.get("x-open-bot-language") === "fr"
      return Response.json({
        items: items.map((item) => ({
          name: item.name,
          description: fr ? `${item.qty} en stock` : `${item.qty} in stock`,
          aliases: [String(item.id)],
          hint: fr
            ? `id d’article ${item.id} ; ajoutez ou retirez-le sur la page Stock`
            : `stock item id ${item.id}; add or remove it on the Stock dashboard page`,
        })),
      })
    }

    if (url.pathname === "/api/summary") return Response.json(summary())

    if (url.pathname === "/api/items" && req.method === "GET") {
      return Response.json({ items })
    }

    if (url.pathname === "/api/items" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) ?? {}
      const name = String(body.name ?? "").trim()
      const qty = Number(body.qty ?? 0)
      if (!name)
        return Response.json({ error: "name is required" }, { status: 400 })
      if (!Number.isFinite(qty) || qty < 0) {
        return Response.json({ error: "qty must be a number" }, { status: 400 })
      }
      const item = { id: nextId++, name, qty: Math.round(qty) }
      items.push(item)
      broadcast()
      return Response.json({ item }, { status: 201 })
    }

    const remove = url.pathname.match(/^\/api\/items\/(\d+)$/)
    if (remove && req.method === "DELETE") {
      const id = Number(remove[1])
      const index = items.findIndex((item) => item.id === id)
      if (index === -1)
        return Response.json({ error: "not found" }, { status: 404 })
      items.splice(index, 1)
      broadcast()
      return Response.json({ ok: true })
    }

    if (url.pathname === "/api/live") {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const upgraded = server.upgrade(req)
        if (upgraded) return undefined
        return new Response("upgrade failed", { status: 400 })
      }
      // Server-sent events for the stock list.
      const encoder = new TextEncoder()
      let client: SseClient
      const stream = new ReadableStream({
        start(controller) {
          client = {
            send: (line) => controller.enqueue(encoder.encode(line)),
            close: () => controller.close(),
          }
          sseClients.add(client)
          client.send(`data: ${JSON.stringify({ items })}\n\n`)
        },
        cancel() {
          sseClients.delete(client)
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      })
    }

    return new Response("not found", { status: 404 })
  },
  websocket: {
    open(ws) {
      sseClients.add(ws)
      ws.send(`data: ${JSON.stringify({ items })}\n\n`)
    },
    message() {},
    close(ws) {
      sseClients.delete(ws)
    },
  },
})

export { server }
