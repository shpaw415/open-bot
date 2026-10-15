import { describe, expect, mock, test } from "bun:test"
import type { InstalledPlugin } from "@open-bot/db"
import * as dockerModule from "./docker"
import {
  basePluginPagePort,
  clearPluginPageState,
  ensurePluginPageServer,
  PAGE_PORT_MAX,
  PAGE_PORT_MIN,
  pageCheckoutEntry,
  pageServerCommand,
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

  test("checkout entry resolves only for safe local installs", () => {
    const manifest = {
      files: [{ name: "server.ts", source: "server/server.ts" }],
      dashboard: { pages: { entry: "server.ts" } },
    } as never
    expect(
      pageCheckoutEntry(
        { source: "local", localPath: "/home/agent/plugins-create/stock-pro" },
        manifest,
        "server.ts",
      ),
    ).toBe("/home/agent/plugins-create/stock-pro/server/server.ts")
    expect(
      pageCheckoutEntry(
        { source: "marketplace", localPath: null },
        manifest,
        "server.ts",
      ),
    ).toBeNull()
    expect(
      pageCheckoutEntry(
        { source: "local", localPath: "/tmp/it's" },
        manifest,
        "server.ts",
      ),
    ).toBeNull()
    expect(
      pageCheckoutEntry({ source: "local", localPath: null }, manifest, "x"),
    ).toBeNull()
  })

  test("spawn command records pid, token, port, and the exact command line", () => {
    const base = {
      pidFile: "/home/agent/.open-bot/pages/stock-pro",
      token: "t0k3n",
      port: 4742,
      bin: "/usr/local/bin/ob-plugin-stock-pro-server.ts",
    }
    const frozen = pageServerCommand(base)
    expect(frozen).toContain(
      "echo $$ > '/home/agent/.open-bot/pages/stock-pro.pid'",
    )
    expect(frozen).toContain(".token'")
    expect(frozen).toContain(".port'")
    // The stop path pkills this exact argv, so a spawn whose successor died
    // on EADDRINUSE can still be found and killed.
    expect(frozen).toContain(
      "printf '%s' 'bun run /usr/local/bin/ob-plugin-stock-pro-server.ts' > '/home/agent/.open-bot/pages/stock-pro.cmd'",
    )
    expect(frozen).toContain(
      "exec bun run '/usr/local/bin/ob-plugin-stock-pro-server.ts'",
    )
    const hot = pageServerCommand({
      ...base,
      checkoutEntry: "/checkout/server.ts",
    })
    expect(hot).toContain("exec bun --hot run '/checkout/server.ts'")
    expect(hot).toContain("'bun --hot run /checkout/server.ts'")
    expect(hot).not.toContain("ob-plugin-stock-pro-server.ts'")
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
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
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
      // The resolved port lands in a file so the agent can find it later.
      expect(script).toContain(".port'")
      expect(script).toContain(`printf '%s' '${port}'`)
      // Marketplace installs (no source/localPath) run the frozen bin.
      expect(script).toContain(
        "exec bun run '/usr/local/bin/ob-plugin-stock-pro-server.ts'",
      )
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("local installs hot-run the checkout entry", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        source: "local",
        localPath: "/home/agent/plugins-create/stock-pro",
        manifest: {
          files: [{ name: "server.ts", source: "server/server.ts" }],
          dashboard: { pages: { entry: "server.ts" } },
        },
      } as unknown as InstalledPlugin
      await ensurePluginPageServer("u1", row)
      const script = shCalls.find((args) => args.includes("-d"))?.at(-1) ?? ""
      expect(script).toContain(
        "exec bun --hot run '/home/agent/plugins-create/stock-pro/server/server.ts'",
      )
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("concurrent starts share one spawn instead of racing EADDRINUSE", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      const [a, b] = await Promise.all([
        ensurePluginPageServer("u1", row),
        ensurePluginPageServer("u1", row),
      ])
      expect(a).toBe(b)
      expect(
        shCalls.filter((args) => args.includes("-d")).length,
      ).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("stop kills the pid, pkills the recorded command line, and cleans up", async () => {
    shCalls.length = 0
    await stopPluginPageServer("u1", "stock-pro")
    const script = shCalls.at(-1)?.at(-1) ?? ""
    expect(script).toContain("kill -9")
    expect(script).toContain("kill -0")
    expect(script).toContain("pkill -TERM -x -f")
    expect(script).toContain("pkill -KILL -x -f")
    expect(script).toContain(".cmd'")
    expect(script).toContain("rm -f")
    expect(script).toContain(".pid'")
    expect(script).toContain(".token'")
    expect(script).toContain(".port'")
  })

  test("start stops a stale server before spawning so the pidfile stays truthful", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      await ensurePluginPageServer("u1", row)
      const spawnIndex = shCalls.findIndex((args) => args.includes("-d"))
      expect(spawnIndex).toBeGreaterThan(-1)
      const killIndex = shCalls.findIndex((args) =>
        (args.at(-1) ?? "").includes("pkill -TERM -x -f"),
      )
      expect(killIndex).toBeGreaterThan(-1)
      expect(killIndex).toBeLessThan(spawnIndex)
      // The pre-spawn kill keeps the token file so direct clients survive.
      const killScript = shCalls[killIndex].at(-1) ?? ""
      expect(killScript).not.toContain(
        "rm -f '/home/agent/.open-bot/pages/stock-pro.token'",
      )
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("uninstall log cleanup targets the page log file", async () => {
    shCalls.length = 0
    await removePluginPageLog("u1", "stock-pro")
    const args = shCalls.at(-1) ?? []
    expect(args).toContain("/home/agent/.open-bot/pages/stock-pro.log")
  })
})
