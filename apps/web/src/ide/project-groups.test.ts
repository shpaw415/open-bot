import { describe, expect, test } from "bun:test"
import { groupProjects } from "./project-groups"
import type { ProjectInfo } from "./types"

function project(overrides: Partial<ProjectInfo>): ProjectInfo {
  return {
    id: "p",
    name: "P",
    path: "/home/agent/workspace/p",
    createdAt: 0,
    ...overrides,
  }
}

describe("group projects", () => {
  test("splits plugin projects from the rest", () => {
    const plugins = groupProjects([
      project({ id: "1", path: "/home/agent/workspace/app" }),
      project({ id: "2", path: "/home/agent/plugins-create/price-scout" }),
      project({ id: "3", path: "/home/agent/workspace/site" }),
      project({ id: "4", path: "/home/agent/plugins-create/pager" }),
    ])
    expect(plugins.plugins.map((p) => p.id)).toEqual(["2", "4"])
    expect(plugins.general.map((p) => p.id)).toEqual(["1", "3"])
  })

  test("prefers the category field over the path", () => {
    const grouped = groupProjects([
      project({
        id: "1",
        category: "plugins",
        path: "/home/agent/workspace/x",
      }),
      project({ id: "2", category: "general", path: "/other/place" }),
    ])
    expect(grouped.plugins.map((p) => p.id)).toEqual(["1"])
    expect(grouped.general.map((p) => p.id)).toEqual(["2"])
  })

  test("falls back to the path prefix when category is missing", () => {
    const grouped = groupProjects([
      project({ id: "1", path: "/home/agent/plugins-create/solo" }),
      project({ id: "2", path: "/home/agent/plugins-create" }),
      project({ id: "3", path: "/home/agent/plugins-create-evil/x" }),
    ])
    expect(grouped.plugins.map((p) => p.id)).toEqual(["1", "2"])
    expect(grouped.general.map((p) => p.id)).toEqual(["3"])
  })

  test("handles an empty list", () => {
    expect(groupProjects([])).toEqual({ plugins: [], general: [] })
  })
})
