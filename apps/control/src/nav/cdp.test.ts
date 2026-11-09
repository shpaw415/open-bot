import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeTabFile,
  type CdpSocket,
  captureMarked,
  clearActiveTabId,
  clearMarksScript,
  evaluate,
  MARK_ROOT_ID,
  markScript,
  normalize,
  OBNAV_FP_FN,
  openSocket,
  PROBE,
  pickPageTarget,
  probeSnapshot,
  readActiveTabId,
  writeActiveTabId,
} from "./cdp"

function socket(results: unknown[]): CdpSocket {
  const queue = [...results]
  return {
    async call() {
      return queue.shift()
    },
    close() {},
  }
}

test("evaluate surfaces the real page error, not bare Uncaught", async () => {
  const fake = socket([
    {
      exceptionDetails: {
        text: "Uncaught",
        exception: {
          className: "SecurityError",
          description: "SecurityError: Blocked a frame with origin",
        },
      },
    },
  ])
  let message = ""
  try {
    await evaluate(fake, "1 + 1")
  } catch (error) {
    message = error instanceof Error ? error.message : ""
  }
  expect(message).toBe("page error: SecurityError: Blocked a frame with origin")
})

test("evaluate falls back to the exception text", async () => {
  const fake = socket([{ exceptionDetails: { text: "Uncaught" } }])
  await expect(evaluate(fake, "1 + 1")).rejects.toThrow("page error: Uncaught")
})

test("mark script stamps indexes and names the cleanup root", () => {
  const script = markScript([
    { index: "3", targetId: "n9" },
    { index: '1"<', targetId: "n1" },
  ])
  expect(script).toContain(MARK_ROOT_ID)
  expect(script).toContain('"index":"3"')
  expect(script).toContain('"targetId":"n9"')
  expect(script).not.toContain('1"<')
  expect(clearMarksScript()).toBe(
    `document.getElementById(${JSON.stringify(MARK_ROOT_ID)})?.remove()`,
  )
})

test("captureMarked returns null and still clears badges when the shot fails", async () => {
  const calls: string[] = []
  const fake: CdpSocket = {
    async call(method, params) {
      calls.push(method)
      if (method === "Page.captureScreenshot") throw new Error("shot failed")
      if (method === "Runtime.evaluate") {
        const expression = (params as { expression?: string }).expression ?? ""
        if (expression.includes(MARK_ROOT_ID))
          return { result: { value: true } }
        return { result: { value: true } }
      }
      return {}
    },
    close() {},
  }
  expect(await captureMarked(fake, [{ index: "1", targetId: "n1" }])).toBeNull()
  expect(calls).toContain("Page.captureScreenshot")
  expect(calls.filter((method) => method === "Runtime.evaluate").length).toBe(2)
})

test("captureMarked returns jpeg bytes and skips an empty mark list", async () => {
  const shots: Record<string, unknown>[] = []
  const fake: CdpSocket = {
    async call(method, params) {
      if (method === "Page.captureScreenshot") {
        shots.push(params ?? {})
        return { data: "  abc  " }
      }
      if (method === "Runtime.evaluate") return { result: { value: true } }
      return {}
    },
    close() {},
  }
  expect(await captureMarked(fake, [])).toBeNull()
  expect(shots).toEqual([])
  expect(await captureMarked(fake, [{ index: "2", targetId: "n2" }])).toBe(
    "abc",
  )
  expect(shots).toEqual([{ format: "jpeg", quality: 60, fromSurface: true }])
})

test("probeSnapshot retries once after a failed probe", async () => {
  let evaluateCalls = 0
  const fake: CdpSocket = {
    async call(_method, params) {
      const expression = (params as { expression?: string }).expression ?? ""
      if (!expression.startsWith("(() => {")) return {}
      evaluateCalls += 1
      if (evaluateCalls === 1) {
        return {
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "x" },
          },
        }
      }
      return { result: { value: { url: "https://ebay.test/", title: "ok" } } }
    },
    close() {},
  }
  const snapshot = await probeSnapshot(fake)
  expect(evaluateCalls).toBe(2)
  expect(snapshot.url).toBe("https://ebay.test/")
  expect(snapshot.title).toBe("ok")
})

test("enter script falls back to a submit button when Enter changes nothing", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: { kind: "enter"; targetId: string }) => string
  }
  const script = actionScript({ kind: "enter", targetId: "n3" })
  expect(script).toContain("data-obnav")
  expect(script).toContain("keyCode: 13")
  expect(script).toContain("setTimeout(resolve, 700)")
  expect(script).toContain("location.href + '|' + document.title")
  expect(script).toContain("closest('form')")
  expect(script).toContain("submit.click()")
  expect(script).toContain("/effacer|clear|reset|cancel|wipe/i")
  expect(script).toContain(
    "if (item.type === 'submit' || item.type === 'image') return true",
  )
  expect(script).toContain("/search|submit|recherch|suchen|buscar|find/i")
})

test("click script tolerates an ancestor cover and names a real one", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: { kind: "click"; targetId: string }) => string
  }
  const script = actionScript({ kind: "click", targetId: "n7" })
  expect(script).toContain("data-obnav")
  // A covering ancestor is not occlusion (delegated clicks): click anyway.
  expect(script).toContain("!el.contains(center) && !center.contains(el)")
  expect(script).toContain("el.click()")
  // A real overlay refuses, describing what covers the target.
  expect(script).toContain("'covered:' + name")
  expect(script).toContain("center.className === 'string'")
})

test("probe ranks modal, text entry, search, content, anchors, chrome — in that order", async () => {
  const { PROBE } = (await import("./cdp")) as { PROBE: string }
  expect(PROBE.startsWith("(() => {")).toBe(true)
  expect(PROBE).toContain(
    'nav, header, aside, footer, [role="navigation"], [role="banner"], [role="contentinfo"]',
  )
  const allAt = PROBE.indexOf("const tiers = [[], [], [], [], [], []]")
  const sortAt = PROBE.indexOf("const reserve = Math.min(tiers[4].length, 6)")
  const sliceAt = PROBE.indexOf(
    "out.push(...actFirst(tiers[4]).slice(0, Math.min(reserve, remaining())))",
  )
  expect(allAt).toBeGreaterThan(-1)
  expect(sortAt).toBeGreaterThan(allAt)
  expect(sliceAt).toBeGreaterThan(sortAt)
  expect(PROBE).toContain(
    'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]), [role="textbox"], [role="searchbox"]',
  )
  // The topmost modal's controls outrank everything behind it.
  expect(PROBE).toContain(
    `document.querySelectorAll('dialog[open], [aria-modal="true"], [role="alertdialog"]')`,
  )
  expect(PROBE).toContain("if (topModal && topModal.contains(el)) tier = 0")
  expect(PROBE).toContain(
    "if (el.matches(entry) && !el.disabled && !el.readOnly) tier = 1",
  )
  expect(PROBE).toContain("if (el.closest('[role=\"search\"]')) tier = 2")
  expect(PROBE).toContain("tier = el.closest(chrome) ? 4 : 3")
  // Covered (non-actionable) controls sort last within every tier.
  expect(PROBE).toContain("const actFirst = (list)")
  expect(PROBE).toContain("list.filter((item) => item.actionable)")
  expect(PROBE).toContain(
    "elements_truncated: tiers[0].length + tiers[1].length + tiers[2].length + tiers[3].length + tiers[4].length + tiers[5].length > max",
  )
  expect(PROBE).not.toContain("if (out.length >= max) break")
})

test("probe and actions cross shadow boundaries", async () => {
  const { PROBE, actionScript, obnavFindExpr } = (await import("./cdp")) as {
    PROBE: string
    actionScript: (action: { kind: string; targetId: string }) => string
    obnavFindExpr: (idExpr: string) => string
  }
  // The probe walks open shadow roots (web-component tiles keep their real
  // controls there) with a bounded scan.
  expect(PROBE).toContain("descend(el.shadowRoot, ox, oy)")
  expect(PROBE).toContain("descend(document, 0, 0)")
  expect(PROBE).toContain("scanBudget-- <= 0")
  // Every id-targeting action resolves through the shadow-aware lookup.
  for (const action of [
    { kind: "click", targetId: "n7" },
    { kind: "type", targetId: "n2", text: "hi" },
    { kind: "enter", targetId: "n2" },
    { kind: "select", targetId: "n2", label: "opt" },
  ]) {
    expect(actionScript(action as never)).toContain("walk(shadow)")
  }
  expect(obnavFindExpr('"n3"')).toContain("walk(document)")
})

test("find falls back to the probe fingerprint when the stamped node is gone", async () => {
  const { PROBE, obnavFindExpr } = (await import("./cdp")) as {
    PROBE: string
    obnavFindExpr: (idExpr: string) => string
  }
  // The probe records (fingerprint, occurrence) per id for exactly this.
  expect(PROBE).toContain("bag.fp[id] = { k: fpKey, n: fpNth }")
  const expr = obnavFindExpr('"n7"')
  expect(expr).toContain("bag.fp[id]")
  expect(expr).toContain('found.setAttribute("data-obnav", id)')

  // Behavioral: two "Send" buttons, the stamped second one was replaced by
  // a live-DOM re-render (attribute nowhere). The fallback must re-stamp
  // and return the replacement second twin, not the first.
  const attrs = new Map<object, Map<string, string>>()
  const fakeEl = (label: string) => {
    const el: Record<string, unknown> = {
      tagName: "BUTTON",
      id: "",
      innerText: label,
      shadowRoot: null,
      getAttribute: (name: string) =>
        attrs.get(el as object)?.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        if (!attrs.has(el as object)) attrs.set(el as object, new Map())
        attrs.get(el as object)?.set(name, value)
      },
      getBoundingClientRect: () => ({
        width: 80,
        height: 30,
        bottom: 40,
        top: 10,
        right: 90,
        left: 10,
      }),
    }
    return el
  }
  const first = fakeEl("Send")
  const replacement = fakeEl("Send")
  const other = fakeEl("Cancel")
  const all = [first, other, replacement]
  const documentFake = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === "*" ? all : all),
  }
  const windowFake = {
    innerWidth: 1000,
    innerHeight: 800,
    __obnav: {
      fp: { n7: { k: "BUTTON||Send", n: 1 } },
      map: { set: () => undefined },
    },
  }
  const run = new Function(
    "window",
    "document",
    "getComputedStyle",
    `return (${expr})`,
  ) as (w: unknown, d: unknown, g: unknown) => unknown
  const found = run(windowFake, documentFake, () => ({
    visibility: "visible",
    display: "block",
  }))
  expect(found).toBe(replacement as unknown)
  expect(attrs.get(replacement as object)?.get("data-obnav")).toBe("n7")
})

test("normalize carries scroll position through the snapshot", () => {
  expect(normalize({ scroll_y: 432 }).scrollY).toBe(432)
  expect(normalize({}).scrollY).toBeUndefined()
  expect(normalize({ scroll_y: "junk" }).scrollY).toBeUndefined()
  expect(PROBE).toContain("scroll_y: Math.round(window.scrollY)")
})

test("target pick skips blank tabs but keeps the first page as a fallback", () => {
  const blank = {
    id: "t1",
    url: "about:blank",
    title: "",
    webSocketDebuggerUrl: "ws://a",
  }
  const page = {
    id: "t2",
    url: "https://example.test/",
    title: "Example",
    webSocketDebuggerUrl: "ws://b",
  }
  expect(pickPageTarget([blank, page])).toBe(page)
  expect(pickPageTarget([page, blank])).toBe(page)
  expect(pickPageTarget([blank])).toBe(blank)
  expect(pickPageTarget([])).toBeNull()
})

test("target pick follows the recorded active tab while it is alive", () => {
  const first = {
    id: "t1",
    url: "https://a.test/",
    title: "A",
    webSocketDebuggerUrl: "ws://a",
  }
  const second = {
    id: "t2",
    url: "https://b.test/",
    title: "B",
    webSocketDebuggerUrl: "ws://b",
  }
  const blank = {
    id: "t3",
    url: "about:blank",
    title: "",
    webSocketDebuggerUrl: "ws://c",
  }
  expect(pickPageTarget([first, second], "t2")).toBe(second)
  // A stale id (closed tab, relaunch) falls back to the old behavior.
  expect(pickPageTarget([first], "t2")).toBe(first)
  expect(pickPageTarget([first, blank], "t2")).toBe(first)
  expect(pickPageTarget([blank, first], "t2")).toBe(first)
  expect(pickPageTarget([blank], "t2")).toBe(blank)
  expect(pickPageTarget([], "t2")).toBeNull()
})

test("the active tab id round-trips through the cdp dir", () => {
  const home = mkdtempSync(join(tmpdir(), "ob-tabs-"))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    expect(readActiveTabId("ses_abc")).toBe("")
    expect(readActiveTabId(undefined)).toBe("")
    writeActiveTabId("ses_abc", "t2")
    writeActiveTabId(undefined, "t9")
    writeActiveTabId("ses_abc", "")
    expect(readActiveTabId("ses_abc")).toBe("t2")
    expect(activeTabFile("ses_abc")).toBe(
      join(home, ".open-bot/cdp/ses_abc.tab"),
    )
    clearActiveTabId("ses_abc")
    clearActiveTabId(undefined)
    expect(readActiveTabId("ses_abc")).toBe("")
    clearActiveTabId("ses_abc")
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  }
})

test("an explicit label[for] names an input in probe and fingerprint", () => {
  // Behavioral: run the page-side helpers against a fake DOM.
  const labels: Record<string, string> = { email: "Email address" }
  const doc = {
    querySelector: (selector: string) => {
      const match = /^label\[for="(.*)"\]$/.exec(selector)
      if (match && labels[match[1]])
        return { textContent: ` ${labels[match[1]]} ` }
      return null
    },
  }
  const make = new Function(
    "document",
    `${OBNAV_FP_FN}
     return { labelFor: __obLabelFor, fp: __obFp }`,
  ) as (d: unknown) => {
    labelFor: (el: unknown) => string
    fp: (el: unknown) => string
  }
  const { labelFor, fp } = make(doc)
  const el = (attrs: Record<string, string>) => ({
    tagName: "INPUT",
    innerText: "",
    id: attrs.id ?? "",
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    getRootNode: () => doc,
  })
  // The explicit label text wins over id/innerText; aria-label still wins
  // over it; an id with no label falls back to the id as before.
  expect(labelFor(el({ id: "email" }))).toBe("Email address")
  expect(fp(el({ id: "email" }))).toBe("INPUT||Email address")
  expect(fp(el({ id: "email", "aria-label": "Search here" }))).toBe(
    "INPUT||Search here",
  )
  expect(fp(el({ id: "orphan" }))).toBe("INPUT||orphan")
  expect(labelFor(el({}))).toBe("")
  // The probe's element label chain uses it too, right after aria-label.
  expect(PROBE).toContain(
    'el.getAttribute("aria-label") || __obLabelledBy(el) || __obLabelFor(el) || el.innerText',
  )
})

test("probe attaches visible popup options of an open aria combobox", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: {
      kind: "select"
      targetId: string
      label: string
    }) => string
  }
  // Popup options are collected from the aria-controls/aria-owns container
  // (bounded 8), with a bounded global fallback (16) for an expanded
  // trigger whose popup is not linked.
  expect(PROBE).toContain(`scope.querySelectorAll('[role="option"]')`)
  expect(PROBE).toContain('el.getAttribute("aria-controls")')
  expect(PROBE).toContain('el.getAttribute("aria-owns")')
  expect(PROBE).toContain("optionsIn(scope, 8)")
  expect(PROBE).toContain("optionsIn(document, 16)")
  // Only rendered options count: hidden popups contribute nothing.
  expect(PROBE).toContain('style.display === "none"')
  // Native selects keep their own option listing.
  expect(PROBE).toContain('if (el.tagName === "SELECT")')
  // The select action completes the loop: a listed option is clickable on
  // a combobox, not just on a native SELECT.
  const script = actionScript({ kind: "select", targetId: "n2", label: "Blue" })
  expect(script).toContain("el.tagName === 'SELECT'")
  expect(script).toContain("document.getElementById(ctrl)")
  expect(script).toContain("querySelectorAll('[role=option]')")
  expect(script).toContain("option.click()")
})

test("type action drives the native prototype value setter for React inputs", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: {
      kind: "type"
      targetId: string
      text: string
    }) => string
  }
  const script = actionScript({ kind: "type", targetId: "n2", text: "hi" })
  expect(script).toContain(
    "getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')",
  )
  expect(script).toContain("HTMLTextAreaElement.prototype")
  expect(script).toContain("HTMLInputElement.prototype")
  expect(script).toContain("desc.set.call(el")
  // The events React's onChange listens for keep firing.
  expect(script).toContain("el.focus()")
  expect(script).toContain("new Event('input', { bubbles: true })")
  expect(script).toContain("new Event('change', { bubbles: true })")
})

test("a timed-out call rejects cleanly, drops its late reply and leaves the socket usable", async () => {
  const events: unknown[] = []
  const held: number[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return undefined
      return new Response("no", { status: 404 })
    },
    websocket: {
      open() {},
      message(ws, message) {
        const raw = JSON.parse(String(message)) as {
          id?: number
          method?: string
        }
        if (raw.method === "hold") {
          held.push(raw.id ?? 0)
          return
        }
        if (raw.method === "release") {
          for (const id of held)
            ws.send(JSON.stringify({ id, result: { late: true } }))
          held.length = 0
        }
        if (raw.method === "push")
          ws.send(JSON.stringify({ method: "Fake.event" }))
        ws.send(JSON.stringify({ id: raw.id, result: { ok: raw.method } }))
      },
      close() {},
    },
  })
  try {
    const socket = await openSocket(
      `ws://127.0.0.1:${server.port}/ws`,
      (message) => events.push(message),
      80,
    )
    try {
      // The renderer never answers this one: honest, bounded rejection.
      await expect(socket.call("hold")).rejects.toThrow(
        "cdp call timed out: hold",
      )
      // Ask the server to flush the late reply for the timed-out id, then
      // keep using the same socket for the next call.
      expect(await socket.call("release")).toEqual({ ok: "release" })
      await Bun.sleep(60)
      // The late reply was dropped, not buffered as a phantom event, and
      // the following call resolved through the same pending machinery.
      expect(events).toEqual([])
      expect(await socket.call("push")).toEqual({ ok: "push" })
      await Bun.sleep(60)
      expect(events).toContainEqual({ method: "Fake.event" })
      // A call after close fails fast instead of burning the timeout.
      socket.close()
      await expect(socket.call("ping")).rejects.toThrow("cdp connection closed")
    } finally {
      socket.close()
    }
  } finally {
    server.stop(true)
  }
})

test("click script verifies an observable change or reports unverified (#89)", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: { kind: "click"; targetId: string }) => string
  }
  const script = actionScript({ kind: "click", targetId: "n7" })
  expect(script).toContain("(async () => {")
  expect(script).toContain("'unverified:no-change'")
  expect(script).toContain("aria-disabled")
  // The element's own state counts as a change (radio/checkbox/tab picks
  // change no text, dialog, or URL).
  expect(script).toContain("el.checked")
  expect(script).toContain("aria-expanded")
})

test("type script reports a controlled value that reverts (#53/#57/#64)", async () => {
  const { actionScript } = (await import("./cdp")) as {
    actionScript: (action: {
      kind: "type"
      targetId: string
      text: string
    }) => string
  }
  const script = actionScript({ kind: "type", targetId: "n2", text: "hi" })
  expect(script).toContain("(async () => {")
  expect(script).toContain("'unverified:value-reverted'")
})

test("probe lists visible listbox options as their own elements (#33)", async () => {
  const { PROBE, OBNAV_SELECTOR } = (await import("./cdp")) as {
    PROBE: string
    OBNAV_SELECTOR: string
  }
  expect(OBNAV_SELECTOR).toContain('[role="option"]')
  expect(PROBE).toContain('[role="option"]')
  // Hidden retained option nodes of a closed listbox stay out.
  expect(PROBE).toContain("checkVisibility")
  expect(PROBE).toContain('el.getAttribute("aria-selected") === "true"')
})

test("fingerprint lookup tolerates a vanished twin (#73)", async () => {
  const { obnavFindExpr } = (await import("./cdp")) as {
    obnavFindExpr: (idExpr: string) => string
  }
  const script = obnavFindExpr(JSON.stringify("n3"))
  expect(script).toContain("matchCount === 1")
})

test("accessible name resolves aria-labelledby and wrapping labels (#41)", async () => {
  const { OBNAV_FP_FN } = (await import("./cdp")) as {
    OBNAV_FP_FN: string
  }
  expect(OBNAV_FP_FN).toContain("aria-labelledby")
  expect(OBNAV_FP_FN).toContain("el.labels")
})

test("probe and actions descend into same-origin iframes (#93)", async () => {
  const { PROBE, actionScript, obnavFindExpr } = (await import("./cdp")) as {
    PROBE: string
    actionScript: (action: { kind: string; targetId: string }) => string
    obnavFindExpr: (idExpr: string) => string
  }
  expect(PROBE).toContain("contentDocument")
  expect(PROBE).toContain("descend(frameDoc")
  expect(PROBE).toContain("el.ownerDocument.elementFromPoint")
  const find = obnavFindExpr(JSON.stringify("n3"))
  expect(find).toContain("contentDocument")
  const click = actionScript({ kind: "click", targetId: "n7" })
  expect(click).toContain("el.ownerDocument")
})
