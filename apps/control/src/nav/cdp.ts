import type { Snapshot } from "./action-space"
import type { Act, Driver } from "./loop"

export type CdpDriver = Driver & { close(): void }

type CdpSocket = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

export async function connectCdp(port: number): Promise<CdpDriver> {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.json(),
  )) as { type?: string; webSocketDebuggerUrl?: string }[]
  const page = list.find(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  )
  if (!page?.webSocketDebuggerUrl) throw new Error("no page on this screen")
  const socket = await openSocket(page.webSocketDebuggerUrl)
  return {
    async probe() {
      const value = await evaluate(socket, PROBE)
      return normalize(value)
    },
    async act(action) {
      await evaluate(socket, actionScript(action))
      await Bun.sleep(action.kind === "wait" ? 500 : 400)
    },
    close() {
      socket.close()
    },
  }
}

function openSocket(url: string) {
  const ws = new WebSocket(url)
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let next = 0
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      result?: unknown
      error?: { message?: string }
    }
    if (!message.id || !pending.has(message.id)) return
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (!waiter) return
    if (message.error) {
      waiter.reject(new Error(message.error.message || "cdp failed"))
      return
    }
    waiter.resolve(message.result)
  }
  return new Promise<CdpSocket>((resolve, reject) => {
    ws.onopen = () =>
      resolve({
        call(method, params) {
          const id = ++next
          return new Promise((done, fail) => {
            pending.set(id, { resolve: done, reject: fail })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        },
      })
    ws.onerror = () => reject(new Error("cdp connection failed"))
  })
}

async function evaluate(socket: CdpSocket, expression: string) {
  const result = (await socket.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } }
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page script failed")
  }
  return result.result?.value
}

function normalize(value: unknown): Snapshot {
  const raw = (value ?? {}) as Record<string, unknown>
  const elements = Array.isArray(raw.elements) ? raw.elements : []
  return {
    url: String(raw.url ?? ""),
    title: String(raw.title ?? ""),
    text: String(raw.text ?? ""),
    canScrollDown: Boolean(raw.can_scroll_down),
    canScrollUp: Boolean(raw.can_scroll_up),
    elements: elements.map((item) => {
      const row = item as Record<string, unknown>
      const options = Array.isArray(row.options)
        ? row.options.map((option) => ({
            label: String((option as { label?: unknown }).label ?? ""),
          }))
        : undefined
      return {
        targetId: String(row.target_id ?? ""),
        role: String(row.role ?? ""),
        label: String(row.label ?? ""),
        value: String(row.value ?? ""),
        editable: Boolean(row.editable),
        actionable: row.actionable !== false,
        options,
      }
    }),
  }
}

function actionScript(action: Act) {
  if (action.kind === "wait") return "true"
  if (action.kind === "scroll") {
    const delta = action.direction === "down" ? "1" : "-1"
    return `window.scrollBy(0, window.innerHeight * 0.75 * ${delta})`
  }
  const id = JSON.stringify(action.targetId)
  if (action.kind === "click") {
    return `(() => { const el = document.querySelector('[data-obnav=' + ${id} + ']'); if (!el) return false; el.click(); return true })()`
  }
  if (action.kind === "type") {
    const text = JSON.stringify(action.text)
    return `(() => { const el = document.querySelector('[data-obnav=' + ${id} + ']'); if (!el) return false; el.focus(); if ('value' in el) { el.value = ${text}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } return true })()`
  }
  if (action.kind === "enter") {
    return `(() => { const el = document.querySelector('[data-obnav=' + ${id} + ']'); if (!el) return false; el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`
  }
  const label = JSON.stringify(action.label)
  return `(() => { const el = document.querySelector('[data-obnav=' + ${id} + ']'); if (!el || el.tagName !== 'SELECT') return false; const option = [...el.options].find((item) => item.label === ${label}); if (!option) return false; el.value = option.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
}

const PROBE = `(() => {
  const max = 16
  const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]'
  const out = []
  for (const el of document.querySelectorAll(selector)) {
    if (out.length >= max) break
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue
    const style = getComputedStyle(el)
    if (style.visibility === "hidden" || style.display === "none") continue
    const id = String(out.length + 1)
    el.setAttribute("data-obnav", id)
    const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 80)
    const item = {
      target_id: id,
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      label,
      value: "value" in el ? String(el.value || "").slice(0, 80) : "",
      editable: el.matches('input, textarea, [contenteditable="true"]') && !el.disabled && !el.readOnly,
      actionable: true,
    }
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    item.actionable = !center || el === center || el.contains(center)
    if (el.tagName === "SELECT") item.options = [...el.options].slice(0, 8).map((option) => ({ label: option.label }))
    out.push(item)
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 1500),
    can_scroll_down: window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 8,
    can_scroll_up: window.scrollY > 8,
    elements: out,
  }
})()`
