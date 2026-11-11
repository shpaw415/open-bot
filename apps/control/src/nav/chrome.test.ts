import { expect, test } from "bun:test"
import type { PageTarget } from "./cdp"
import {
  capText,
  closeTab,
  devOrigin,
  EVAL_TIMEOUT_MAX_MS,
  EVAL_TIMEOUT_MS,
  evalRequest,
  flagsFrom,
  matchTab,
  nextActiveAfterClose,
  normalizeTarget,
  recoveryAdvice,
  schemeError,
  shapeIdbEntry,
  storageRequest,
  shapeState,
  tabArgError,
  tabsLine,
  verbFrom,
} from "./chrome"

const USAGE =
  "usage: chrome.ts PORT navigate URL | tab [list|new [URL]|close [N]|switch N] | newtab URL | tabs | switch N | closetab N | url | back | forward | reload [--fresh] | cache clear [--origin URL] [--cookies] [--reload] | console | network [N] | metrics | dom | eval JS | viewport [list | mobile [PRESET] | PRESET | WxH | rotate | off]"

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
  // viewport passes through untouched: it parses its own argv tail.
  expect(verbFrom(["viewport", "mobile"])).toEqual({ verb: "viewport" })
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
    "viewport",
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
    timeoutMs: EVAL_TIMEOUT_MS,
  })
  // Trailing --raw parses as a bare flag.
  const trailing = flagsFrom(["eval", "({mode:1})", "--raw"])
  expect(evalRequest(trailing.positional.slice(1), trailing.flags)).toEqual({
    expression: "({mode:1})",
    raw: true,
    timeoutMs: EVAL_TIMEOUT_MS,
  })
  // Leading --raw eats the first expression token as its "value" in the
  // generic parser; evalRequest hands it back.
  const leading = flagsFrom(["eval", "--raw", "document.title"])
  expect(evalRequest(leading.positional.slice(1), leading.flags)).toEqual({
    expression: "document.title",
    raw: true,
    timeoutMs: EVAL_TIMEOUT_MS,
  })
})

test("eval request parses a bounded --timeout in seconds (#107/#112)", () => {
  const leading = flagsFrom(["eval", "--timeout", "90", "work()"])
  expect(evalRequest(leading.positional.slice(1), leading.flags)).toEqual({
    expression: "work()",
    raw: false,
    timeoutMs: 90_000,
  })
  const trailing = flagsFrom(["eval", "work()", "--timeout=5"])
  expect(
    evalRequest(trailing.positional.slice(1), trailing.flags).timeoutMs,
  ).toBe(5_000)
  // Past the documented ceiling clamps instead of hanging the CLI.
  const over = flagsFrom(["eval", "--timeout", "9999", "work()"])
  expect(evalRequest(over.positional.slice(1), over.flags).timeoutMs).toBe(
    EVAL_TIMEOUT_MAX_MS,
  )
  expect(() => evalRequest(["work()"], { timeout: "soon" })).toThrow(
    "--timeout",
  )
  expect(() => evalRequest(["work()"], { timeout: "0" })).toThrow("--timeout")
})

test("storage request parses a read-only idb export (#109)", () => {
  expect(storageRequest(["idb", "http://127.0.0.1:4702/game"], {})).toEqual({
    origin: "http://127.0.0.1:4702",
    database: "",
    store: "",
    limit: 50,
  })
  expect(
    storageRequest(["idb", "https://x.test", "saves", "slots"], {
      limit: "9999",
    }),
  ).toEqual({
    origin: "https://x.test",
    database: "saves",
    store: "slots",
    limit: 500,
  })
  expect(() => storageRequest(["idb"], {})).toThrow("origin")
  expect(() => storageRequest(["idb", "file:///etc"], {})).toThrow("origin")
  expect(() => storageRequest(["local", "https://x.test"], {})).toThrow(
    "usage:",
  )
})

test("idb entries shape to bounded provenance rows (#109)", () => {
  const row = shapeIdbEntry({
    key: { type: "string", value: "slot1" },
    primaryKey: { type: "string", value: "slot1" },
    value: { type: "object", value: { hp: 10 } },
  })
  expect(row.key).toBe("slot1")
  expect(row.value).toEqual({ hp: 10 })
  expect(row.valueBytes).toBe(JSON.stringify({ hp: 10 }).length)
  expect(row.valueSha256).toMatch(/^[0-9a-f]{64}$/)
  // An unserializable remote object keeps its description, never invents data.
  const opaque = shapeIdbEntry({
    key: { type: "number", value: 3 },
    value: { type: "object", className: "Blob", description: "Blob" },
  })
  expect(opaque.value).toBeUndefined()
  expect(opaque.note).toContain("Blob")
})

test("an eval timeout never gets navigate-and-replay advice (#107/#112)", () => {
  const evalTimeout =
    "eval timed out after 30s — the expression may still be running"
  expect(recoveryAdvice(evalTimeout)).toBe(evalTimeout)
  expect(recoveryAdvice(evalTimeout)).not.toContain("navigate URL")
  // A dead-renderer timeout on other verbs keeps the new-tab recovery.
  expect(recoveryAdvice("cdp call timed out: Page.navigate")).toContain(
    "Recover with ob-chrome --session SESSION navigate URL",
  )
  expect(recoveryAdvice("no element 3 on this page")).toBe(
    "no element 3 on this page",
  )
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

test("closing a tab keeps the previously active survivor active (#24)", () => {
  const targets = [
    {
      id: "t1",
      url: "https://a.test/",
      title: "A",
      webSocketDebuggerUrl: "ws://a",
    },
    {
      id: "t2",
      url: "https://b.test/",
      title: "B",
      webSocketDebuggerUrl: "ws://b",
    },
    {
      id: "t3",
      url: "https://c.test/",
      title: "C",
      webSocketDebuggerUrl: "ws://c",
    },
  ]
  // Closing inactive t3 must not steal focus from active t2 to t1.
  expect(nextActiveAfterClose(targets.slice(0, 2), "t2")?.id).toBe("t2")
  // Closing the active tab falls back to the first real survivor.
  expect(nextActiveAfterClose([targets[0], targets[2]], "t2")?.id).toBe("t1")
  expect(nextActiveAfterClose([], "t2")).toBeNull()
})

test("eval gets a documented longer budget than ordinary CDP calls (#67)", () => {
  expect(EVAL_TIMEOUT_MS).toBe(30_000)
})

test("eval timeout flag is bounded and defaults to the eval ceiling (#107)", async () => {
  const { parseEvalTimeoutMs, EVAL_TIMEOUT_MS } = await import("./chrome")
  expect(parseEvalTimeoutMs({})).toBe(EVAL_TIMEOUT_MS)
  expect(parseEvalTimeoutMs({ timeout: "45" })).toBe(45_000)
  expect(parseEvalTimeoutMs({ timeout: "9999" })).toBe(180_000)
  expect(parseEvalTimeoutMs({ timeout: "0" })).toBe(1_000)
  expect(parseEvalTimeoutMs({ timeout: "junk" })).toBe(EVAL_TIMEOUT_MS)
})
