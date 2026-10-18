import { describe, expect, test } from "bun:test"
import {
  flattenSearchGroups,
  initialSearchResults,
  moveSearchSelection,
  runSearch,
  type SearchEntry,
  scoreSearchEntry,
  searchAppEntries,
  searchNavEntries,
  searchProjectEntries,
  searchThreadEntries,
} from "./search"

describe("search — sources", () => {
  test("navigation covers the main views, settings sections and admin by role", () => {
    const user = searchNavEntries("user")
    const admin = searchNavEntries("admin")
    expect(user.some((entry) => entry.path === "/")).toBe(true)
    expect(user.some((entry) => entry.path === "/config/plugins")).toBe(true)
    expect(user.some((entry) => entry.path === "/admin")).toBe(false)
    expect(admin.some((entry) => entry.path === "/admin")).toBe(true)
  })

  test("threads map to conversation opens, not paths", () => {
    const entries = searchThreadEntries([
      { id: "s1", title: "Fix the login flow" },
      { id: "s2" },
    ])
    expect(entries[0]).toEqual({
      id: "thread:s1",
      group: "threads",
      title: "Fix the login flow",
      sessionId: "s1",
    })
    expect(entries[1].title).toBe("New thread")
  })

  test("apps expose their plugin route and projects their view", () => {
    const apps = searchAppEntries([
      { key: "stock:grid", title: "Grid", pluginName: "Stock" },
    ])
    expect(apps[0].path).toBe("/stock:grid")
    expect(apps[0].hint).toBe("Stock")
    const projects = searchProjectEntries([{ id: "p1", name: "open-bot" }])
    expect(projects[0].path).toBe("/projects")
    // A named result must open THAT project, not just the Projects view.
    expect(projects[0].projectId).toBe("p1")
  })
})

describe("search — ranking", () => {
  const entries: SearchEntry[] = [
    { id: "1", group: "nav", title: "Settings" },
    { id: "2", group: "nav", title: "System1", hint: "Settings" },
    { id: "3", group: "apps", title: "Stock grid", hint: "Stock" },
    { id: "4", group: "threads", title: "preset setter" },
    { id: "5", group: "projects", title: "open-bot" },
  ]

  test("prefix beats word-start beats substring", () => {
    expect(scoreSearchEntry("set", entries[0])).toBe(0)
    expect(scoreSearchEntry("set", entries[3])).toBe(1)
    expect(scoreSearchEntry("ett", entries[0])).toBe(2)
  })

  test("hints match too", () => {
    expect(scoreSearchEntry("settings", entries[1])).toBe(2)
    expect(scoreSearchEntry("stock", entries[2])).toBe(0)
  })

  test("no match is null; empty query matches nothing", () => {
    expect(scoreSearchEntry("zzz", entries[0])).toBeNull()
    expect(scoreSearchEntry("", entries[0])).toBeNull()
  })

  test("runSearch groups in stable order and respects the limit", () => {
    const groups = runSearch("s", [
      { id: "t", group: "threads", title: "shipping" },
      { id: "n", group: "nav", title: "Settings" },
      { id: "a", group: "apps", title: "Stock" },
      { id: "p", group: "projects", title: "seaside" },
    ])
    expect(groups.map((group) => group.id)).toEqual([
      "nav",
      "apps",
      "threads",
      "projects",
    ])
    const flat = flattenSearchGroups(groups)
    expect(flat.map((entry) => entry.id)).toEqual(["n", "a", "t", "p"])
    const limited = runSearch(
      "e",
      Array.from({ length: 30 }, (_, index) => ({
        id: `x${index}`,
        group: "nav" as const,
        title: `entry ${index}`,
      })),
    )
    expect(flattenSearchGroups(limited).length).toBeLessThanOrEqual(24)
  })

  test("the empty-query landing state shows destinations only", () => {
    const groups = initialSearchResults([
      { id: "1", group: "nav", title: "Chat" },
      { id: "2", group: "threads", title: "some thread" },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["1"])
  })
})

describe("search — keyboard selection", () => {
  test("moves and clamps without wrapping", () => {
    expect(moveSearchSelection(-1, 1, 3)).toBe(0)
    expect(moveSearchSelection(0, 1, 3)).toBe(1)
    expect(moveSearchSelection(2, 1, 3)).toBe(2)
    expect(moveSearchSelection(0, -1, 3)).toBe(0)
    expect(moveSearchSelection(2, -1, 3)).toBe(1)
  })

  test("an empty list stays at -1", () => {
    expect(moveSearchSelection(0, 1, 0)).toBe(-1)
  })
})
