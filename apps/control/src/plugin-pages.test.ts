import { describe, expect, mock, test } from "bun:test"
import type { Db, InstalledPlugin } from "@open-bot/db"
import * as dockerModule from "./docker"
import {
  basePluginPagePort,
  clearPluginPageState,
  ensurePluginPageServer,
  PAGE_PORT_MAX,
  PAGE_PORT_MIN,
  parsePluginPagePath,
  pendingPluginPageRestartsCount,
  pluginPageBin,
  pluginPagePath,
  removePluginPageLog,
  schedulePluginPageRestart,
  stopPluginPageServer,
} from "./plugin-pages"
import * as shellModule from "./shell"

const shCalls: string[][] = []
mock.module("./shell", () => ({
  ...shellModule,
  sh: async (args: string[]) => {
    shCalls.push(args)
    return { code: 0, stdout: "", stderr: "" }
  },
}))
mock.module("./docker", () => ({
  ...dockerModule,
  desktopPhase: async () => "running",
  endpoint: async () => "http://opencode:4096",
}))

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

  test("start redirects server output into the page log file", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      const port = await ensurePluginPageServer("u1", row)
      expect(port).toBeGreaterThanOrEqual(PAGE_PORT_MIN)
      const spawn = shCalls.find((args) => args.includes("-d"))
      expect(spawn).toBeDefined()
      const script = spawn?.at(-1) ?? ""
      expect(script).toContain(".log' 2>&1")
      expect(script).toContain("echo $$ >")
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("stop waits for the old pid and escalates to KILL before the port is reused", async () => {
    shCalls.length = 0
    await stopPluginPageServer("u1", "stock-pro")
    const script = shCalls.at(-1)?.at(-1) ?? ""
    expect(script).toContain("kill -9")
    expect(script).toContain("kill -0")
    expect(script).toContain("rm -f")
    expect(script).toContain(".pid'")
    expect(script).toContain(".token'")
  })

  test("uninstall log cleanup targets the page log file", async () => {
    shCalls.length = 0
    await removePluginPageLog("u1", "stock-pro")
    const args = shCalls.at(-1) ?? []
    expect(args).toContain("/home/agent/.open-bot/pages/stock-pro.log")
  })
})
