import { describe, expect, test } from "bun:test"
import { type AppEntry, filterApps } from "./app-launcher"

const apps: AppEntry[] = [
  { id: "chrome", name: "Google Chrome" },
  { id: "org.gimp.GIMP", name: "GNU Image Manipulation Program" },
  { id: "xterm", name: "XTerm" },
  { id: "discord", name: "Discord" },
]

describe("app launcher", () => {
  test("empty query returns the catalog, capped at eight", () => {
    const many: AppEntry[] = Array.from({ length: 12 }, (_, i) => ({
      id: `app${i}`,
      name: `App ${i}`,
    }))
    expect(filterApps(many, "")).toHaveLength(8)
    expect(filterApps(many, "   ")[0]?.id).toBe("app0")
  })

  test("matches the name or the id, case-insensitively", () => {
    expect(filterApps(apps, "disc").map((a) => a.id)).toEqual(["discord"])
    expect(filterApps(apps, "GOOGLE").map((a) => a.id)).toEqual(["chrome"])
    expect(filterApps(apps, "gimp").map((a) => a.id)).toEqual(["org.gimp.GIMP"])
    expect(filterApps(apps, "zzz")).toEqual([])
  })
})
