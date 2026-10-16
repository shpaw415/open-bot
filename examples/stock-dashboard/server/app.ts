// Browser side of the stock dashboard. Bundled by Bun (transpiled from TS)
// both for the live import and the standalone build. Relative fetch paths
// only — the dashboard proxies this page under /api/pages/<pluginId>/, so a
// leading "/" would escape to the dashboard root. No localStorage: the
// sandboxed frame throws on storage access.

type StockItem = { id: number; name: string; qty: number }

const rows = document.getElementById("rows") as HTMLElement

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, "")
}

function render(items: StockItem[]) {
  rows.innerHTML = items
    .map(
      (item) =>
        `<tr><td>${escapeText(item.name)}</td><td>${item.qty}</td>` +
        `<td><button data-id="${item.id}">remove</button></td></tr>`,
    )
    .join("")
}

async function refresh() {
  const res = await fetch("api/items")
  const data = (await res.json()) as { items: StockItem[] }
  render(data.items)
}

const add = document.getElementById("add") as HTMLFormElement
add.addEventListener("submit", async (event) => {
  event.preventDefault()
  const data = new FormData(add)
  await fetch("api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: data.get("name"),
      qty: Number(data.get("qty")),
    }),
  })
  add.reset()
})

rows.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement | null
  const id = target?.dataset?.id
  if (id) await fetch(`api/items/${id}`, { method: "DELETE" })
})

const live = new EventSource("api/live")
live.onmessage = (event) => {
  render((JSON.parse(event.data) as { items: StockItem[] }).items)
}

refresh()
