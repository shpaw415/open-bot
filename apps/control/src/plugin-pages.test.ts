import { describe, expect, test } from "bun:test"
import type { InstalledPlugin } from "@open-bot/db"
import {
  basePluginPagePort,
  clearPluginPageState,
  PAGE_PORT_MAX,
  PAGE_PORT_MIN,
  parsePluginPagePath,
  pendingPluginPageRestartsCount,
  pluginPageBin,
  pluginPagePath,
  schedulePluginPageRestart,
} from "./plugin-pages"

describe("plugin pages", () => {
  test("parses proxy paths", () => {
    expect(parsePluginPagePath("/api/pages/stock-pro/")).toEqual({
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parsePluginPagePath("/api/pages/stock-pro/api/items?x=1")).toEqual({
      pluginId: "stock-pro",
      rest: "/api/items?x=1",
    })
    expect(parsePluginPagePath("/api/pages/stock-pro")).toEqual({
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parsePluginPagePath("/api/pages/")).toBeNull()
    expect(parsePluginPagePath("/api/pages/Stock-Pro/")).toBeNull()
    expect(parsePluginPagePath("/api/pages/a/../etc")).toBeNull()
    expect(parsePluginPagePath("/api/pages/a/\\etc")).toBeNull()
    expect(parsePluginPagePath("/api/pages/%2e%2e/x")).toBeNull()
  })

  test("ports stay inside the page range and are deterministic", () => {
    for (const id of ["stock-pro", "a", "zzzzzz-plugin-name-long"]) {
      const port = basePluginPagePort(id)
      expect(port).toBeGreaterThanOrEqual(PAGE_PORT_MIN)
      expect(port).toBeLessThanOrEqual(PAGE_PORT_MAX)
      expect(basePluginPagePort(id)).toBe(port)
    }
  })

  test("paths follow the desktop tool conventions", () => {
    expect(pluginPageBin("stock-pro", "server.js")).toBe(
      "/usr/local/bin/ob-plugin-stock-pro-server.js",
    )
    expect(pluginPagePath("stock-pro")).toBe(
      "/home/agent/.open-bot/pages/stock-pro",
    )
  })

  test("scheduled restarts coalesce per user+plugin and are clearable", () => {
    clearPluginPageState()
    const row = (id: string) =>
      ({ pluginId: id, enabled: true }) as unknown as InstalledPlugin
    // Same user+plugin twice collapses into one pending restart.
    schedulePluginPageRestart({} as never, "u1", row("stock-pro"))
    schedulePluginPageRestart({} as never, "u1", row("stock-pro"))
    schedulePluginPageRestart({} as never, "u1", row("weather-pro"))
    schedulePluginPageRestart({} as never, "u2", row("stock-pro"))
    expect(pendingPluginPageRestartsCount()).toBe(3)
    clearPluginPageState()
    expect(pendingPluginPageRestartsCount()).toBe(0)
  })
})
