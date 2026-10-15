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

test("probe ranks text entry, search, content, anchors, chrome — in that order", async () => {
  const { PROBE } = (await import("./cdp")) as { PROBE: string }
  expect(PROBE.startsWith("(() => {")).toBe(true)
  expect(PROBE).toContain(
    'nav, header, aside, footer, [role="navigation"], [role="banner"], [role="contentinfo"]',
  )
  const allAt = PROBE.indexOf("const tiers = [[], [], [], [], []]")
  const sortAt = PROBE.indexOf("const reserve = Math.min(tiers[3].length, 6)")
  const sliceAt = PROBE.indexOf(
    "out.push(...tiers[3].slice(0, Math.min(reserve, remaining())))",
  )
  expect(allAt).toBeGreaterThan(-1)
  expect(sortAt).toBeGreaterThan(allAt)
  expect(sliceAt).toBeGreaterThan(sortAt)
  expect(PROBE).toContain(
    'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]), [role="textbox"], [role="searchbox"]',
  )
  expect(PROBE).toContain(
    "if (el.matches(entry) && !el.disabled && !el.readOnly) tier = 0",
  )
  expect(PROBE).toContain("if (el.closest('[role=\"search\"]')) tier = 1")
  expect(PROBE).toContain("tier = el.closest(chrome) ? 3 : 2")
  expect(PROBE).toContain(
    "elements_truncated: tiers[0].length + tiers[1].length + tiers[2].length + tiers[3].length + tiers[4].length > max",
  )
  expect(PROBE).not.toContain("if (out.length >= max) break")
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
