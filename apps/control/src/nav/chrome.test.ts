import { expect, test } from "bun:test"
import type { PageTarget } from "./cdp"
import { matchTab, normalizeTarget, shapeState, verbFrom } from "./chrome"

const USAGE =
  "usage: chrome.ts PORT navigate URL | newtab URL | tabs | switch N | closetab N | url | back | forward | reload"

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
    "newtab",
    "tabs",
    "switch",
    "closetab",
    "url",
    "back",
    "forward",
    "reload",
  ]) {
    expect(USAGE).toContain(verb)
  }
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
