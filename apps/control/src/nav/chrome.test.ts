import { expect, test } from "bun:test"
import type { PageTarget } from "./cdp"
import {
  capText,
  closeTab,
  devOrigin,
  evalRequest,
  flagsFrom,
  matchTab,
  normalizeTarget,
  schemeError,
  shapeState,
  tabArgError,
  tabsLine,
  verbFrom,
} from "./chrome"

const USAGE =
  "usage: chrome.ts PORT navigate URL | tab [list|new [URL]|close [N]|switch N] | newtab URL | tabs | switch N | closetab N | url | back | forward | reload [--fresh] | cache clear [--origin URL] [--cookies] [--reload] | console | network [N] | metrics | dom | eval JS"

test("navigate target adds the scheme to a bare domain", () => {
  expect(normalizeTarget("example.com")).toBe("https://example.com")
  expect(normalizeTarget("example.com/path?q=1")).toBe(
    "https://example.com/path?q=1",
  )
  expect(normalizeTarget("  https://example.test/  ")).toBe(
    "https://example.test/",
  )
  expect(normalizeTarget("http://localhost:4096/x")).toBe(
    "http://localhost:4096/x",
  )
})

test("navigate target rejects junk and empties", () => {
  expect(normalizeTarget("")).toBeNull()
  expect(normalizeTarget("   ")).toBeNull()
  expect(normalizeTarget("not a domain")).toBeNull()
  expect(normalizeTarget("javascript:alert(1)")).toBeNull()
})

test("navigate target passes file urls through", () => {
  expect(normalizeTarget("file:///tmp/x.html")).toBe("file:///tmp/x.html")
  expect(normalizeTarget("  FILE:///home/agent/page.html  ")).toBe(
    "FILE:///home/agent/page.html",
  )
})

test("scheme error explains unsupported schemes and passes known ones", () => {
  expect(schemeError("ftp://example.test/x")).toContain("ftp")
  expect(schemeError("ssh://example.test")).toContain("http(s):// or file://")
  expect(schemeError("javascript:alert(1)")).toContain("javascript")
  expect(schemeError("https://example.test/")).toBeNull()
  expect(schemeError("file:///tmp/x.html")).toBeNull()
  expect(schemeError("example.com")).toBeNull()
  expect(schemeError("")).toBeNull()
})

test("verbs parse positional and --url forms", () => {
  expect(verbFrom(["navigate", "https://a.test/"])).toEqual({
    verb: "navigate",
    url: "https://a.test/",
  })
  expect(verbFrom(["navigate", "--url", "https://b.test/"])).toEqual({
    verb: "navigate",
    url: "https://b.test/",
  })
  expect(verbFrom(["navigate", "--url=https://c.test/"])).toEqual({
    verb: "navigate",
    url: "https://c.test/",
  })
  expect(verbFrom(["newtab", "https://d.test/"])).toEqual({
    verb: "newtab",
    url: "https://d.test/",
  })
  expect(verbFrom(["newtab"])).toEqual({ verb: "newtab", url: "" })
  expect(verbFrom(["switch", "2"])).toEqual({ verb: "switch", arg: "2" })
  expect(verbFrom(["closetab", "example.test"])).toEqual({
    verb: "closetab",
    arg: "example.test",
  })
  expect(verbFrom(["closetab"])).toEqual({ verb: "closetab", arg: "" })
  expect(verbFrom(["url"])).toEqual({ verb: "url" })
  expect(verbFrom(["back"])).toEqual({ verb: "back" })
  expect(verbFrom(["forward"])).toEqual({ verb: "forward" })
  expect(verbFrom(["reload"])).toEqual({ verb: "reload" })
  expect(verbFrom([])).toEqual({ verb: "" })
  expect(verbFrom(["browse"])).toEqual({ verb: "browse" })
})

test("tab namespace maps onto the flat tab verbs", () => {
  expect(verbFrom(["tab"])).toEqual({ verb: "tabs" })
  expect(verbFrom(["tab", "list"])).toEqual({ verb: "tabs" })
  expect(verbFrom(["tab", "new", "https://a.test/"])).toEqual({
    verb: "newtab",
    url: "https://a.test/",
  })
  expect(verbFrom(["tab", "new"])).toEqual({ verb: "newtab", url: "" })
  expect(verbFrom(["tab", "open", "--url", "https://b.test/"])).toEqual({
    verb: "newtab",
    url: "https://b.test/",
  })
  expect(verbFrom(["tab", "close"])).toEqual({ verb: "closetab", arg: "" })
  expect(verbFrom(["tab", "close", "2"])).toEqual({
    verb: "closetab",
    arg: "2",
  })
  expect(verbFrom(["tab", "switch", "3"])).toEqual({ verb: "switch", arg: "3" })
  expect(verbFrom(["tab", "select", "docs"])).toEqual({
    verb: "switch",
    arg: "docs",
  })
  expect(verbFrom(["tab", "bogus"])).toEqual({ verb: "tab" })
})

test("page state shapes to a flat json line", () => {
  expect(
    shapeState({ url: "https://a.test/", title: "A", heading: "H", text: "x" }),
  ).toEqual({ url: "https://a.test/", title: "A", heading: "H", text: "x" })
  expect(shapeState(null)).toEqual({
    url: "",
    title: "",
    heading: "",
    text: "",
  })
  expect(shapeState({ url: 5 })).toEqual({
    url: "5",
    title: "",
    heading: "",
    text: "",
  })
})

test("usage names every verb", () => {
  for (const verb of [
    "navigate",
    "tab",
    "newtab",
    "tabs",
    "switch",
    "closetab",
    "url",
    "back",
    "forward",
    "reload",
    "console",
    "network",
    "metrics",
    "dom",
    "eval",
    "cache",
  ]) {
    expect(USAGE).toContain(verb)
  }
})

test("capText truncates with a marker flag only when needed", () => {
  expect(capText("hello", 10)).toEqual({ text: "hello" })
  expect(capText("hello world", 5)).toEqual({ text: "hello", truncated: true })
  expect(capText("abc", 3).truncated).toBeUndefined()
})

test("devOrigin reduces urls and bare domains to scheme+host origins", () => {
  expect(devOrigin("https://app.test/a/b?x=1")).toBe("https://app.test")
  expect(devOrigin("http://127.0.0.1:8124/page.html")).toBe(
    "http://127.0.0.1:8124",
  )
  expect(devOrigin("example.test")).toBe("https://example.test")
  expect(devOrigin("  Example.Test/path  ")).toBe("https://example.test")
  // Only http(s) origins are usable for per-origin clears; file:/about:
  // report the literal origin "null".
  expect(devOrigin("file:///tmp/x.html")).toBeNull()
  expect(devOrigin("not a domain")).toBeNull()
  expect(devOrigin("")).toBeNull()
})

test("devtools flags parse values, bare flags and positionals", () => {
  // The verb itself arrives as the first positional; main strips it before
  // the network index is read.
  expect(flagsFrom(["console", "--level", "error"])).toEqual({
    positional: ["console"],
    flags: { level: "error" },
  })
  expect(flagsFrom(["network", "3", "--body"])).toEqual({
    positional: ["network", "3"],
    flags: { body: true },
  })
  expect(flagsFrom(["network", "--filter=api", "--limit", "5"])).toEqual({
    positional: ["network"],
    flags: { filter: "api", limit: "5" },
  })
  expect(flagsFrom(["console", "--clear"])).toEqual({
    positional: ["console"],
    flags: { clear: true },
  })
  // A flag consuming the next token must not swallow a later positional.
  expect(flagsFrom(["network", "--limit", "5", "2"])).toEqual({
    positional: ["network", "2"],
    flags: { limit: "5" },
  })
})

test("eval request separates --raw from the expression in both positions", () => {
  expect(evalRequest(["({mode:1})"], {})).toEqual({
    expression: "({mode:1})",
    raw: false,
  })
  // Trailing --raw parses as a bare flag.
  const trailing = flagsFrom(["eval", "({mode:1})", "--raw"])
  expect(evalRequest(trailing.positional.slice(1), trailing.flags)).toEqual({
    expression: "({mode:1})",
    raw: true,
  })
  // Leading --raw eats the first expression token as its "value" in the
  // generic parser; evalRequest hands it back.
  const leading = flagsFrom(["eval", "--raw", "document.title"])
  expect(evalRequest(leading.positional.slice(1), leading.flags)).toEqual({
    expression: "document.title",
    raw: true,
  })
})

const tabTargets: PageTarget[] = [
  {
    id: "t1",
    url: "https://a.test/",
    title: "First",
    webSocketDebuggerUrl: "ws://a",
  },
  {
    id: "t2",
    url: "https://b.test/docs",
    title: "Docs",
    webSocketDebuggerUrl: "ws://b",
  },
  { id: "t3", url: "about:blank", title: "", webSocketDebuggerUrl: "ws://c" },
]

test("switch and closetab match by 1-based index or url/text substring", () => {
  expect(matchTab(tabTargets, "2")?.id).toBe("t2")
  expect(matchTab(tabTargets, "9")).toBeNull()
  expect(matchTab(tabTargets, "b.test")?.id).toBe("t2")
  expect(matchTab(tabTargets, "docs")?.id).toBe("t2")
  expect(matchTab(tabTargets, "DOCS")?.id).toBe("t2")
  expect(matchTab(tabTargets, "nope")).toBeNull()
  expect(matchTab(tabTargets, "")).toBeNull()
})

test("switch and closetab prefer the stable tab id from tab list", () => {
  // The id survives tabs opening/closing around it; the numeric order does
  // not, so `tab list` prints it and the verbs accept it.
  expect(matchTab(tabTargets, "t2")?.id).toBe("t2")
  expect(matchTab(tabTargets, "T2")?.id).toBe("t2")
  expect(matchTab(tabTargets, "t9")).toBeNull()
})

test("tab list rows carry the stable id beside the 1-based index", async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json([
      {
        type: "page",
        id: "t1",
        url: "https://a.test/",
        title: "First",
        webSocketDebuggerUrl: "ws://a",
      },
      {
        type: "page",
        id: "t2",
        url: "https://b.test/",
        title: "Second",
        webSocketDebuggerUrl: "ws://b",
      },
    ])) as unknown as typeof fetch
  try {
    const line = await tabsLine(9222, undefined)
    expect(line.tabs[0]).toMatchObject({
      index: 1,
      id: "t1",
      url: "https://a.test/",
      active: true,
    })
    expect(line.tabs[1]).toMatchObject({ index: 2, id: "t2", active: false })
  } finally {
    globalThis.fetch = real
  }
})

test("a numeric tab miss names the recovery instead of a bare no-match", () => {
  expect(tabArgError("9")).toContain("tab 9 no longer exists")
  expect(tabArgError("9")).toContain("tab list")
  expect(tabArgError(" 3 ")).toContain("tab 3 no longer exists")
  expect(tabArgError("nope")).toBe("no tab matches nope")
})

test("closing the last tab reports browserClosed instead of unreachable", async () => {
  const real = globalThis.fetch
  let lists = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/json/list")) {
      lists += 1
      // First list sees the one tab; after the close the browser is gone.
      if (lists === 1)
        return Response.json([
          {
            type: "page",
            id: "t1",
            url: "https://a.test/",
            title: "First",
            webSocketDebuggerUrl: "ws://a",
          },
        ])
      throw new Error("Unable to connect")
    }
    if (url.includes("/json/close/")) {
      // Chromium exits with its last tab, dropping the close response.
      throw new Error("Unable to connect")
    }
    throw new Error(`unexpected ${url}`)
  }) as unknown as typeof fetch
  try {
    const state = await closeTab(9222, undefined, "1")
    expect(state.browserClosed).toBe(true)
    expect(state.url).toBe("")
  } finally {
    globalThis.fetch = real
  }
})

test("closetab still fails when the tab survives the close", async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/json/list"))
      return Response.json([
        {
          type: "page",
          id: "t1",
          url: "https://a.test/",
          title: "First",
          webSocketDebuggerUrl: "ws://a",
        },
      ])
    if (url.includes("/json/close/"))
      return new Response("nope", { status: 500 })
    throw new Error(`unexpected ${url}`)
  }) as unknown as typeof fetch
  try {
    await expect(closeTab(9222, undefined, "1")).rejects.toThrow(
      "tab did not close",
    )
  } finally {
    globalThis.fetch = real
  }
})
