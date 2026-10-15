import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { NavMark, Snapshot } from "./action-space"
import type { Act, Driver } from "./loop"

export type CdpDriver = Driver & { close(): void }

export type CdpSocket = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

export type PageTarget = {
  id: string
  url: string
  title: string
  webSocketDebuggerUrl: string
}

// A crashed or busy renderer used to hang ob-page/ob-nav for minutes; every
// CDP hop now fails fast instead.
const LIST_TIMEOUT = 4000
const CALL_TIMEOUT = 6000
const OPEN_TIMEOUT = 5000

export async function listPageTargets(port: number): Promise<PageTarget[]> {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(LIST_TIMEOUT),
  }).then((response) => response.json())) as {
    type?: string
    id?: string
    url?: string
    title?: string
    webSocketDebuggerUrl?: string
  }[]
  const out: PageTarget[] = []
  for (const item of list) {
    if (item.type !== "page" || !item.webSocketDebuggerUrl || !item.id) continue
    out.push({
      id: item.id,
      url: typeof item.url === "string" ? item.url : "",
      title: typeof item.title === "string" ? item.title : "",
      webSocketDebuggerUrl: item.webSocketDebuggerUrl,
    })
  }
  return out
}

function homeDir() {
  return process.env.HOME || "/home/agent"
}

// The active tab id lives beside the cdp port file. navigate/newtab/switch
// write it, so ob-page and ob-nav follow the tab the agent last touched
// instead of whichever page happens to sort first.
export function activeTabFile(session?: string) {
  return join(homeDir(), ".open-bot/cdp", `${session}.tab`)
}

export function readActiveTabId(session?: string): string {
  if (!session) return ""
  try {
    return readFileSync(activeTabFile(session), "utf8").trim()
  } catch {
    return ""
  }
}

export function writeActiveTabId(session: string | undefined, id: string) {
  if (!session || !id) return
  try {
    mkdirSync(join(homeDir(), ".open-bot/cdp"), { recursive: true })
    writeFileSync(activeTabFile(session), id)
  } catch {}
}

export function clearActiveTabId(session?: string) {
  if (!session) return
  try {
    unlinkSync(activeTabFile(session))
  } catch {}
}

// Several Chromium windows can share a screen (app windows, new tabs); the
// first about:blank tab is never the page the agent cares about. A recorded
// active tab wins while it is still alive, so tab B stays the page after the
// agent opens it.
export function pickPageTarget(
  targets: PageTarget[],
  activeId?: string,
): PageTarget | null {
  if (activeId) {
    const active = targets.find((item) => item.id === activeId)
    if (active) return active
  }
  const live = targets.find(
    (item) => item.url !== "" && !item.url.startsWith("about:"),
  )
  return live ?? targets[0] ?? null
}

export async function connectCdpSocket(
  port: number,
  activeId?: string,
): Promise<CdpSocket> {
  const page = pickPageTarget(await listPageTargets(port), activeId)
  if (!page) throw new Error("no page on this screen")
  return openSocket(page.webSocketDebuggerUrl)
}

export async function connectCdp(
  port: number,
  activeId?: string,
): Promise<CdpDriver> {
  const page = pickPageTarget(await listPageTargets(port), activeId)
  if (!page) throw new Error("no page on this screen")
  const socket = await openSocket(page.webSocketDebuggerUrl)
  return {
    async probe() {
      return probeSnapshot(socket)
    },
    async navigate(url: string) {
      await socket.call("Page.navigate", { url })
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const href = await evaluate(socket, "location.href")
        if (typeof href === "string" && href && !href.startsWith("about:")) {
          await present(socket)
          return
        }
        await Bun.sleep(250)
      }
    },
    async act(action) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const ok = await evaluate(socket, actionScript(action))
          const covered = typeof ok === "string" && ok.startsWith("covered:")
          if (ok !== false && !covered) break
          if (attempt === 0) {
            // A transient overlay (search suggest, banner) often clears on
            // its own; give it one chance before calling the target covered.
            await Bun.sleep(700)
            continue
          }
          throw new Error(
            covered
              ? `target ${ok.replace("covered:", "covered by ")}`
              : "target covered",
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : ""
          // The enter fallback can navigate the page mid-script; that
          // teardown is the action's effect, not a failure.
          if (
            /navigated or closed|cannot find context|target detached/i.test(
              message,
            )
          ) {
            await Bun.sleep(1200)
            return
          }
          if (attempt === 0 && /target covered/i.test(message)) {
            await Bun.sleep(700)
            continue
          }
          throw error
        }
      }
      const pause =
        action.kind === "type" ? 200 : action.kind === "wait" ? 150 : 80
      await Bun.sleep(pause)
    },
    capture(marks) {
      return captureMarked(socket, marks)
    },
    close() {
      socket.close()
    },
  }
}

export function openSocket(url: string) {
  const ws = new WebSocket(url)
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
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
    clearTimeout(waiter.timer)
    if (message.error) {
      waiter.reject(new Error(message.error.message || "cdp failed"))
      return
    }
    waiter.resolve(message.result)
  }
  return new Promise<CdpSocket>((resolve, reject) => {
    const openTimer = setTimeout(() => {
      ws.close()
      reject(new Error("cdp connection timed out"))
    }, OPEN_TIMEOUT)
    ws.onopen = () => {
      clearTimeout(openTimer)
      resolve({
        call(method, params) {
          const id = ++next
          return new Promise((done, fail) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              // A renderer that never answers is crashed or frozen, not slow;
              // callers get a fast, explicit error instead of a silent hang.
              fail(new Error(`cdp call timed out: ${method}`))
            }, CALL_TIMEOUT)
            pending.set(id, { resolve: done, reject: fail, timer })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        },
      })
    }
    ws.onerror = () => {
      clearTimeout(openTimer)
      reject(new Error("cdp connection failed"))
    }
    ws.onclose = () => {
      clearTimeout(openTimer)
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error("cdp connection closed"))
      }
      pending.clear()
    }
  })
}

export async function present(socket: CdpSocket) {
  await socket.call("Page.bringToFront").catch(() => undefined)
  const found = (await socket
    .call("Browser.getWindowForTarget")
    .catch(() => null)) as { windowId?: number } | null
  const windowId = found?.windowId
  if (!windowId) return
  await socket.call("Browser.setWindowBounds", {
    windowId,
    bounds: {
      left: 0,
      top: 0,
      width: 1919,
      height: 1199,
      windowState: "normal",
    },
  })
  await socket.call("Browser.setWindowBounds", {
    windowId,
    bounds: {
      left: 0,
      top: 0,
      width: 1920,
      height: 1200,
      windowState: "normal",
    },
  })
}

export async function evaluate(
  socket: CdpSocket,
  expression: string,
): Promise<unknown> {
  const result = (await socket.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { value?: unknown }
    exceptionDetails?: {
      text?: string
      exception?: { className?: string; description?: string }
    }
  }
  if (result.exceptionDetails) {
    // Chrome puts the literal "Uncaught" in `text`; the useful message lives
    // on exception.description. Surface it or every failure reads "Uncaught".
    const raw =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.className ||
      result.exceptionDetails.text
    throw new Error(
      raw
        ? `page error: ${singleLine(raw).slice(0, 200)}`
        : "page script failed",
    )
  }
  return result.result?.value
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

// A page-world throw right after a navigation usually means the execution
// context was torn down mid-load. PROBE only reads (plus data-obnav markers),
// so one retry on the settled context is safe.
export async function probeSnapshot(socket: CdpSocket): Promise<Snapshot> {
  try {
    return normalize(await evaluate(socket, PROBE))
  } catch {
    await Bun.sleep(500)
    return normalize(await evaluate(socket, PROBE))
  }
}

export function normalize(value: unknown): Snapshot {
  const raw = (value ?? {}) as Record<string, unknown>
  const elements = Array.isArray(raw.elements) ? raw.elements : []
  return {
    url: String(raw.url ?? ""),
    title: String(raw.title ?? ""),
    text: String(raw.text ?? ""),
    canScrollDown: Boolean(raw.can_scroll_down),
    canScrollUp: Boolean(raw.can_scroll_up),
    scrollY: Number.isFinite(Number(raw.scroll_y))
      ? Number(raw.scroll_y)
      : undefined,
    elementsTruncated: Boolean(raw.elements_truncated),
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

export const MARK_ROOT_ID = "ob-nav-marks"

export function markScript(marks: NavMark[]) {
  const payload = JSON.stringify(
    marks.slice(0, 16).map((mark) => ({
      index: String(mark.index).slice(0, 8),
      targetId: String(mark.targetId).slice(0, 64),
    })),
  )
  return `(() => {
    const rootId = ${JSON.stringify(MARK_ROOT_ID)}
    document.getElementById(rootId)?.remove()
    const root = document.createElement("div")
    root.id = rootId
    root.setAttribute("style", "position:fixed;inset:0;pointer-events:none;z-index:2147483646")
    for (const mark of ${payload}) {
      const el = document.querySelector("[data-obnav=" + JSON.stringify(mark.targetId) + "]")
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const badge = document.createElement("div")
      badge.textContent = String(mark.index)
      badge.setAttribute("style", "position:fixed;left:" + Math.max(0, Math.round(rect.left)) + "px;top:" + Math.max(0, Math.round(rect.top)) + "px;min-width:14px;padding:1px 3px;background:#111;color:#fff;font:700 13px/1 sans-serif;border-radius:2px")
      root.append(badge)
    }
    document.documentElement.append(root)
    return root.childElementCount
  })()`
}

export function clearMarksScript() {
  return `document.getElementById(${JSON.stringify(MARK_ROOT_ID)})?.remove()`
}

export async function captureMarked(
  socket: CdpSocket,
  marks: NavMark[],
): Promise<string | null> {
  if (marks.length === 0) return null
  try {
    await socket.call("Page.enable").catch(() => undefined)
    await evaluate(socket, markScript(marks))
    const shot = (await socket.call("Page.captureScreenshot", {
      format: "jpeg",
      quality: 60,
      fromSurface: true,
    })) as { data?: string }
    const data = shot?.data?.trim() ?? ""
    return data || null
  } catch {
    return null
  } finally {
    await evaluate(socket, clearMarksScript()).catch(() => undefined)
  }
}

// Evaluates to the element for an obnav id, crossing shadow boundaries. The
// probe marks controls inside open shadow roots (web-component tiles,
// embedded players), where document.querySelector cannot reach; walk the
// open roots as a fallback. `idExpr` is a JSON string literal of the id.
export function obnavFindExpr(idExpr: string) {
  return `(() => {
    const id = ${idExpr}
    const direct = document.querySelector('[data-obnav="' + id + '"]')
    if (direct) return direct
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        const shadow = el.shadowRoot
        if (!shadow) continue
        const hit = shadow.querySelector('[data-obnav="' + id + '"]')
        if (hit) return hit
        const deep = walk(shadow)
        if (deep) return deep
      }
      return null
    }
    return walk(document)
  })()`
}

export function actionScript(action: Act) {
  if (action.kind === "wait") return "true"
  if (action.kind === "scroll") {
    const delta = action.direction === "down" ? "1" : "-1"
    return `window.scrollBy(0, window.innerHeight * ${delta})`
  }
  const id = JSON.stringify(action.targetId)
  const find = obnavFindExpr(id)
  if (action.kind === "click") {
    // elementFromPoint naming an ancestor of the target (delegated-click
    // pages, pointer-events:none buttons) is not occlusion: the synthetic
    // click bubbles to the ancestor handler. Only a sibling overlay refuses.
    // With shadow DOM the point can also land on the shadow HOST — an
    // composed-tree ancestor of the target, not a cover — so ancestors along
    // the host chain keep the click allowed too.
    return `(() => {
    const el = ${find}
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const composed = (node) => {
      const chain = []
      let current = node
      while (current) {
        chain.push(current)
        const root = current.getRootNode ? current.getRootNode() : document
        current = root && root.host ? root.host : null
      }
      return chain
    }
    if (center && center !== el && !el.contains(center) && !center.contains(el) && !composed(el).includes(center)) {
      let name = center.tagName.toLowerCase()
      if (center.id) name += '#' + center.id
      else if (typeof center.className === 'string' && center.className.trim())
        name += '.' + center.className.trim().split(/\\s+/).slice(0, 2).join('.')
      return ('covered:' + name).slice(0, 72)
    }
    el.click()
    return true
  })()`
  }
  if (action.kind === "type") {
    const text = JSON.stringify(action.text)
    return `(() => { const el = ${find}; if (!el) return false; el.focus(); if ('value' in el) { el.value = ${text}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } return true })()`
  }
  if (action.kind === "enter") {
    return `(async () => {
    const el = ${find}
    if (!el) return false
    el.focus()
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    const before = location.href + '|' + document.title
    await new Promise((resolve) => setTimeout(resolve, 700))
    if (location.href + '|' + document.title !== before) return true
    const text = (item) => ((item.innerText || '') + ' ' + (item.value || '') + ' ' + (item.getAttribute('aria-label') || '')).toLowerCase()
    const usable = (item) => {
      if (!item || item === el || item.disabled) return false
      if (/effacer|clear|reset|cancel|wipe/i.test(text(item))) return false
      // The form's own submit control is the right target even when the page
      // styles it down to a zero-size icon (DDG's magnifier button).
      if (item.type === 'submit' || item.type === 'image') return true
      if (item.tagName === 'INPUT') return false
      const rect = item.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      return /search|submit|recherch|suchen|buscar|find/i.test(text(item))
    }
    const picks = []
    const form = el.closest('form')
    if (form) picks.push(...form.querySelectorAll('button, input'))
    let scope = el.parentElement
    for (let hop = 0; hop < 3 && scope; hop += 1) {
      picks.push(...scope.querySelectorAll('button, [role=button], input'))
      scope = scope.parentElement
    }
    const submit = picks.find(usable)
    const moved = () => location.href + '|' + document.title !== before
    if (submit) {
      submit.click()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (moved()) return true
      if (form && form.requestSubmit) {
        form.requestSubmit()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (moved()) return true
      }
    }
    if (form) {
      form.submit()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (moved()) return true
    }
    return true
  })()`
  }
  const label = JSON.stringify(action.label)
  return `(() => { const el = ${find}; if (!el || el.tagName !== 'SELECT') return false; const option = [...el.options].find((item) => item.label === ${label}); if (!option) return false; el.value = option.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
}

export const PROBE = `(() => {
  // The action space consumes up to MAX_ELEMENTS (24) of these; the tier
  // budget below reserves a bounded share for TOC anchors so content links
  // and section jumps both stay offered.
  const max = 24
  const bag = window.__obnav || (window.__obnav = { map: new WeakMap(), n: 1 })
  const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]'
  const chrome = 'nav, header, aside, footer, [role="navigation"], [role="banner"], [role="contentinfo"]'
  const entry = 'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]), [role="textbox"], [role="searchbox"]'
  const tiers = [[], [], [], [], []]
  // document.querySelectorAll stops at shadow boundaries; sites built from
  // web components (custom account tiles, embedded players) keep their real
  // controls inside open shadow roots. Walk the light DOM, then descend into
  // open roots — capped so a pathological page cannot stall the probe.
  let scanBudget = 4000
  const descend = (root) => {
    for (const el of root.querySelectorAll(selector)) {
      if (scanBudget-- <= 0) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue
      const style = getComputedStyle(el)
      if (style.visibility === "hidden" || style.display === "none") continue
      let id = bag.map.get(el)
      if (!id) {
        id = "n" + bag.n
        bag.n += 1
        bag.map.set(el, id)
      }
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
      // 0 text-entry targets (composers, chat boxes, form fields), 1 search
      // controls, 2 body content, 3 same-document anchors (TOC jumps), 4 site
      // chrome and settings checkboxes. Text entry leads because a window that
      // floods with content buttons must still offer the field the user is
      // about to type into (messenger.com conversations keep the composer at
      // the end of the DOM). Anchors get a bounded reserve so sticky TOCs
      // cannot crowd article links out of the window, while section jumps
      // stay offered on content-heavy pages.
      let tier = 4
      if (el.matches(entry) && !el.disabled && !el.readOnly) tier = 0
      else if (el.closest('[role="search"]')) tier = 1
      else if (el.matches('a[href^="#"]')) tier = el.closest(chrome) ? 3 : 2
      else if (!el.closest(chrome) && !el.matches('input[type="checkbox"]')) tier = 2
      tiers[tier].push(item)
    }
    if (scanBudget <= 0) return
    for (const el of root.querySelectorAll("*")) {
      if (scanBudget-- <= 0) return
      if (el.shadowRoot) descend(el.shadowRoot)
    }
  }
  descend(document)
  const out = []
  const remaining = () => max - out.length
  const reserve = Math.min(tiers[3].length, 6)
  out.push(...tiers[0].slice(0, remaining()))
  out.push(...tiers[1].slice(0, remaining()))
  out.push(...tiers[2].slice(0, Math.max(remaining() - reserve, 0)))
  out.push(...tiers[3].slice(0, Math.min(reserve, remaining())))
  out.push(...tiers[4].slice(0, remaining()))
  return {
    url: location.href,
    title: document.title,
    text: (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 2500),
    can_scroll_down: window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 8,
    can_scroll_up: window.scrollY > 8,
    scroll_y: Math.round(window.scrollY),
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    scroll_height: document.documentElement.scrollHeight,
    elements: out,
    elements_truncated: tiers[0].length + tiers[1].length + tiers[2].length + tiers[3].length + tiers[4].length > max,
  }
})()`
