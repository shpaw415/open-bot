import { expect, test } from "bun:test"
import { normalizeTarget, shapeState, verbFrom } from "./chrome"

const USAGE =
  "usage: chrome.ts PORT navigate URL | url | back | forward | reload"

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
  expect(verbFrom(["url"])).toEqual({ verb: "url" })
  expect(verbFrom(["back"])).toEqual({ verb: "back" })
  expect(verbFrom(["forward"])).toEqual({ verb: "forward" })
  expect(verbFrom(["reload"])).toEqual({ verb: "reload" })
  expect(verbFrom([])).toEqual({ verb: "" })
  expect(verbFrom(["browse"])).toEqual({ verb: "browse" })
})

test("page state shapes to a flat json line", () => {
  expect(shapeState({ url: "https://a.test/", title: "A" })).toEqual({
    url: "https://a.test/",
    title: "A",
  })
  expect(shapeState(null)).toEqual({ url: "", title: "" })
  expect(shapeState({ url: 5 })).toEqual({ url: "5", title: "" })
})

test("usage names every verb", () => {
  for (const verb of ["navigate", "url", "back", "forward", "reload"]) {
    expect(USAGE).toContain(verb)
  }
})
