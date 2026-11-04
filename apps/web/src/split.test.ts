import { describe, expect, test } from "bun:test"
import { buildSplitUrl, clampSplitRatio, parseSplit, stripSplit } from "./split"

describe("parseSplit", () => {
  test("no split param is single-pane", () => {
    expect(parseSplit("")).toBeNull()
    expect(parseSplit("?thread=abc")).toBeNull()
  })

  test("decodes the second pane's full url", () => {
    const search = `?thread=abc&split=${encodeURIComponent("/stock:grid")}`
    expect(parseSplit(search)).toBe("/stock:grid")
  })

  test("keeps the second pane's own query params", () => {
    const search = `?split=${encodeURIComponent("/chat?thread=xyz")}`
    expect(parseSplit(search)).toBe("/chat?thread=xyz")
  })

  test("strips a nested split param so panes cannot recurse", () => {
    const nested = `/chat?split=${encodeURIComponent("/media")}&thread=t1`
    const search = `?split=${encodeURIComponent(nested)}`
    expect(parseSplit(search)).toBe("/chat?thread=t1")
  })

  test("rejects non-local or malformed pane urls", () => {
    expect(
      parseSplit(`?split=${encodeURIComponent("https://evil.example/x")}`),
    ).toBeNull()
    expect(
      parseSplit(`?split=${encodeURIComponent("//evil.example")}`),
    ).toBeNull()
    expect(parseSplit(`?split=${encodeURIComponent("chat")}`)).toBeNull()
    expect(parseSplit("?split=")).toBeNull()
  })

  test("rejects an oversized pane url", () => {
    const huge = `/chat?thread=${"x".repeat(2100)}`
    expect(parseSplit(`?split=${encodeURIComponent(huge)}`)).toBeNull()
  })
})

describe("buildSplitUrl", () => {
  test("adds the second pane without touching primary params", () => {
    expect(buildSplitUrl("/chat?thread=abc", "/apps")).toBe(
      `/chat?thread=abc&split=${encodeURIComponent("/apps")}`,
    )
  })

  test("round-trips through parseSplit", () => {
    const url = buildSplitUrl("/media?album=a1", "/chat?thread=t9")
    const search = url.slice(url.indexOf("?"))
    expect(parseSplit(search)).toBe("/chat?thread=t9")
  })

  test("replaces an existing second pane", () => {
    const first = buildSplitUrl("/chat", "/apps")
    const second = buildSplitUrl(first, "/projects?id=p1")
    const search = second.slice(second.indexOf("?"))
    expect(parseSplit(search)).toBe("/projects?id=p1")
  })

  test("null closes the split and keeps the primary intact", () => {
    const open = buildSplitUrl("/chat?thread=abc", "/apps")
    expect(buildSplitUrl(open, null)).toBe("/chat?thread=abc")
    expect(stripSplit(open)).toBe("/chat?thread=abc")
  })

  test("an invalid second pane url closes instead of encoding junk", () => {
    expect(buildSplitUrl("/chat", "https://evil.example")).toBe("/chat")
  })

  test("strips split from the second pane url being stored", () => {
    const url = buildSplitUrl("/apps", "/chat?split=%2Fmedia&thread=t2")
    const search = url.slice(url.indexOf("?"))
    expect(parseSplit(search)).toBe("/chat?thread=t2")
  })
})

describe("clampSplitRatio", () => {
  test("keeps in-range ratios", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5)
    expect(clampSplitRatio(0.3)).toBe(0.3)
  })

  test("clamps panes to a usable minimum share", () => {
    expect(clampSplitRatio(0.05)).toBe(0.25)
    expect(clampSplitRatio(0.97)).toBe(0.75)
  })

  test("falls back to half for unreadable values", () => {
    expect(clampSplitRatio(Number.NaN)).toBe(0.5)
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(0.5)
  })
})
