import { describe, expect, test } from "bun:test"
import { applyFilters, filterValues, parseFilters } from "./reports.ts"

const rows = [
  {
    id: "1",
    kind: "bug",
    surface: "nav",
    title: "ob-nav failed",
    detail: "blocked with no url",
    hits: 2,
    email: "a@localhost",
    lastSeenAt: 1,
    status: "open",
    sessionId: null,
    note: null,
  },
  {
    id: "2",
    kind: "feature",
    surface: "chat",
    title: "longer replies",
    detail: "user wanted a summary",
    hits: 1,
    email: "b@localhost",
    lastSeenAt: 2,
    status: "open",
    sessionId: null,
    note: null,
  },
]

describe("report filters", () => {
  test("parses a comma-separated --filters list", () => {
    expect(
      filterValues(["--filters", "kind=bug,surface=nav,user=a@localhost"]),
    ).toEqual({
      status: "open",
      kind: "bug",
      surface: "nav",
      user: "a@localhost",
    })
  })

  test("keeps --status as a status filter", () => {
    expect(filterValues(["--status", "all", "--filters", "q=url"])).toEqual({
      status: "all",
      q: "url",
    })
  })

  test("rejects an unknown filter", () => {
    expect(parseFilters(["hits=2"])).toEqual({ error: "unknown filter: hits" })
  })

  test("matches kind, surface, user, and text", () => {
    const filters = parseFilters(["kind=bug", "surface=nav", "q=blocked"])
    if ("error" in filters) throw new Error(filters.error)
    expect(applyFilters(rows, filters).map((row) => row.id)).toEqual(["1"])
  })
})
