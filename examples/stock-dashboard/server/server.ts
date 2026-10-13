// Stock Dashboard example page server.
//
// Run by the control plane with Bun after install/boot:
//   OPEN_BOT_PAGE_PORT  port to listen on
//   OPEN_BOT_PAGE_TOKEN shared secret (arrives as x-open-bot-page-token)
//   OPEN_BOT_PLUGIN_ID  this plugin's id
// Settings and vault keys live in ~/.config/open-bot/plugin-<id>.json.
//
// Written in TypeScript: Bun runs .ts natively on the desktop, no build step.

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

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/healthz") return new Response("ok")

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

    if (url.pathname === "/") {
      return new Response(page(), {
        headers: { "content-type": "text/html; charset=utf-8" },
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

function page() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #111; color: #eee; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  form { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  input { padding: 8px; border-radius: 6px; border: 1px solid #444; background: #1c1c1c; color: #eee; }
  input[name=name] { flex: 1; min-width: 120px; }
  button { padding: 8px 14px; border-radius: 6px; border: 0; background: #4a6cf7; color: white; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #2a2a2a; }
  td button { background: #7a2f2f; padding: 4px 10px; }
</style>
</head>
<body>
<h1>Stock</h1>
<form id="add">
  <input name="name" placeholder="Item name" required>
  <input name="qty" type="number" min="0" placeholder="Qty" required style="width:90px">
  <button>Add</button>
</form>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
  const rows = document.getElementById("rows")
  function render(items) {
    rows.innerHTML = items.map((item) =>
      "<tr><td>" + item.name.replace(/[&<>\\"']/g, "") + "</td><td>" + item.qty + "</td>" +
      '<td><button data-id="' + item.id + '">remove</button></td></tr>'
    ).join("")
  }
  async function refresh() {
    render((await (await fetch("api/items")).json()).items)
  }
  document.getElementById("add").addEventListener("submit", async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    await fetch("api/items", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), qty: Number(data.get("qty")) }) })
    event.target.reset()
  })
  rows.addEventListener("click", async (event) => {
    const id = event.target?.dataset?.id
    if (id) { await fetch("api/items/" + id, { method: "DELETE" }) }
  })
  const live = new EventSource("api/live")
  live.onmessage = (event) => { render(JSON.parse(event.data).items) }
  refresh()
</script>
</body>
</html>`
}
