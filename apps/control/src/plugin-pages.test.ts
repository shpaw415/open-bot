import { describe, expect, mock, setSystemTime, test } from "bun:test"
import type { InstalledPlugin, User } from "@open-bot/db"
import * as dockerModule from "./docker"
import {
  basePluginPagePort,
  clearPluginPageState,
  ensurePluginPageServer,
  isPageCheckoutPath,
  mintPageFrameToken,
  PAGE_PORT_MAX,
  PAGE_PORT_MIN,
  pageCheckoutEntry,
  pageServerCommand,
  pageStateFor,
  pageUiEnv,
  parsePluginPagePath,
  pendingPluginPageRestartsCount,
  pluginPageBin,
  pluginPagePath,
  proxyPluginPage,
  proxyPluginPageFrame,
  removePluginPageLog,
  schedulePluginPageRestart,
  stopPluginPageServer,
  sweepIdlePluginPageServers,
  touchPluginPageActivity,
} from "./plugin-pages"
import { FRAME_STORAGE_SHIM, rewritePreviewHtml } from "./preview"
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
    expect(
      parsePluginPagePath("/api/pages/stock-pro//evil.example/x"),
    ).toBeNull()
    expect(parsePluginPagePath("/api/pages/stock-pro/%252e%252e/x")).toBeNull()
    expect(
      parsePluginPagePath("/api/pages/stock-pro/%2f%2fevil.example"),
    ).toBeNull()
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

  test("checkout entry falls back to <localPath>/<entry> outside files[]", () => {
    const manifest = {
      dashboard: { pages: { entry: "server.ts" } },
    } as never
    expect(
      pageCheckoutEntry(
        { source: "local", localPath: "/home/agent/plugins-create/stock-pro" },
        manifest,
        "server.ts",
      ),
    ).toBe("/home/agent/plugins-create/stock-pro/server.ts")
    // A relative localPath would make `test -f <path>` parse the operand as
    // an operator (dash builtin has no `--`); the caller drops those.
    expect(
      isPageCheckoutPath(
        pageCheckoutEntry(
          { source: "local", localPath: "relative/checkout" },
          manifest,
          "server.ts",
        ),
      ),
    ).toBe(false)
    expect(isPageCheckoutPath(null)).toBe(false)
    expect(
      isPageCheckoutPath("/home/agent/plugins-create/stock-pro/server.ts"),
    ).toBe(true)
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

  test("bundled UI env only rides frozen installs that declare a ui entry", () => {
    const withUi = {
      dashboard: { pages: { entry: "server.ts", ui: "server/index.html" } },
    } as never
    const withoutUi = {
      dashboard: { pages: { entry: "server.ts" } },
    } as never
    expect(pageUiEnv("stock-pro", withUi, null)).toEqual([
      "-e",
      "OPEN_BOT_PAGE_UI=/usr/local/bin/ob-plugin-stock-pro-ui.html",
    ])
    // Local checkouts import the HTML live — no built copy, no env.
    expect(
      pageUiEnv("stock-pro", withUi, "/checkout/server/server.ts"),
    ).toEqual([])
    expect(pageUiEnv("stock-pro", withoutUi, null)).toEqual([])
  })

  test("frozen starts pass the bundled UI path through the environment", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: {
          dashboard: {
            pages: { entry: "server.ts", ui: "server/index.html" },
          },
        },
      } as unknown as InstalledPlugin
      await ensurePluginPageServer("u1", row)
      const spawn = shCalls.find((args) => args.includes("-d"))
      expect(spawn).toContain(
        "OPEN_BOT_PAGE_UI=/usr/local/bin/ob-plugin-stock-pro-ui.html",
      )
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
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
      expect(shCalls.filter((args) => args.includes("-d")).length).toBe(1)
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

  test("frame html carries the storage shim ahead of page scripts", () => {
    const page =
      `<!doctype html><html><head><title>T</title></head>` +
      `<body><script>const v = localStorage.getItem("k")</script></body></html>`
    const framed = rewritePreviewHtml(page, "/api/pages/_frame/tok", true)
    expect(framed).toContain(FRAME_STORAGE_SHIM)
    expect(framed.indexOf("Object.defineProperty")).toBeLessThan(
      framed.indexOf("localStorage.getItem"),
    )
    expect(framed).toContain(`<base href="/api/pages/_frame/tok/">`)
    // Direct proxy responses stay byte-faithful (session-credentialed origin).
    expect(rewritePreviewHtml(page, "/api/pages/stock-pro")).not.toContain(
      "Object.defineProperty",
    )
    // Headless documents still get the shim first.
    const bare = rewritePreviewHtml("<p>hi</p>", "/api/pages/_frame/tok", true)
    expect(bare.startsWith("<script>")).toBe(true)
    expect(bare).toContain("<base")
    // A page with its own <base> keeps it (root-relative href rewritten to the
    // frame prefix) and still gets the shim on top.
    const owned = rewritePreviewHtml(
      `<html><head><base href="/x/"></head></html>`,
      "/api/pages/_frame/tok",
      true,
    )
    expect(owned.startsWith(`<script>`)).toBe(true)
    expect(owned).toContain(`<base href="/api/pages/_frame/tok/x/">`)
  })

  test("frame proxy injects the shim, direct proxy does not", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    const html = async () =>
      new Response(
        `<!doctype html><html><head><title>S</title></head>` +
          `<body><h1>S</h1></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      )
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/healthz")
        ? new Response("ok")
        : await html()) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      const db = {
        installedPlugin: (_userId: string, pluginId: string) =>
          pluginId === "stock-pro" ? row : null,
      } as never
      const hub = { emit() {} } as never
      const server = { upgrade: () => false } as never
      const token = mintPageFrameToken("u1", "stock-pro").token

      const framed = await proxyPluginPageFrame(
        new Request(`http://x/api/pages/_frame/${token}/`, {
          headers: { origin: "null" },
        }),
        new URL(`http://x/api/pages/_frame/${token}/`),
        db,
        hub,
        server,
      )
      expect(framed?.status).toBe(200)
      // Credentialed CORS: echo the opaque origin, never "*", so edge SSO
      // cookies ride the frame page's fetches.
      expect(framed?.headers.get("access-control-allow-origin")).toBe("null")
      expect(framed?.headers.get("access-control-allow-credentials")).toBe(
        "true",
      )
      const framedBody = await framed?.text()
      expect(framedBody).toContain(FRAME_STORAGE_SHIM)
      expect(framedBody).toContain('credentials="include"')
      expect(framedBody).toContain("withCredentials=true")
      expect(framedBody).toContain(`<base href="/api/pages/_frame/${token}/">`)

      // Even auth failures carry CORS so a dead frame token shows up as a
      // 401 in the page instead of an opaque CORS error.
      const dead = "A".repeat(43)
      const denied = await proxyPluginPageFrame(
        new Request(`http://x/api/pages/_frame/${dead}/api/items`, {
          headers: { origin: "null" },
        }),
        new URL(`http://x/api/pages/_frame/${dead}/api/items`),
        db,
        hub,
        server,
      )
      expect(denied?.status).toBe(401)
      expect(denied?.headers.get("access-control-allow-origin")).toBe("null")
      expect(denied?.headers.get("access-control-allow-credentials")).toBe(
        "true",
      )

      const direct = await proxyPluginPage(
        new Request("http://x/api/pages/stock-pro/"),
        new URL("http://x/api/pages/stock-pro/"),
        db,
        { id: "u1" } as unknown as User,
        hub,
        server,
      )
      expect(direct?.status).toBe(200)
      expect(await direct?.text()).not.toContain("Object.defineProperty")
    } finally {
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
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

  test("idle sweep stops stale servers; activity extends the window", async () => {
    clearPluginPageState()
    shCalls.length = 0
    const originalFetch = globalThis.fetch
    const realNow = Date.now()
    globalThis.fetch = (async () =>
      new Response("ok")) as unknown as typeof fetch
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      await ensurePluginPageServer("u1", row)
      expect(pageStateFor("u1", "stock-pro")).not.toBeNull()

      // Four quiet minutes: still inside the window.
      setSystemTime(realNow + 4 * 60 * 1000)
      await sweepIdlePluginPageServers()
      expect(pageStateFor("u1", "stock-pro")).not.toBeNull()

      // A request resets the window: eight minutes after the start but four
      // after the touch, the server stays up.
      touchPluginPageActivity("u1", "stock-pro")
      setSystemTime(realNow + 8 * 60 * 1000)
      await sweepIdlePluginPageServers()
      expect(pageStateFor("u1", "stock-pro")).not.toBeNull()

      // Past the window the sweeper stops the server and keeps the page
      // token, so the next visit restarts transparently.
      setSystemTime(realNow + 14 * 60 * 1000)
      await sweepIdlePluginPageServers()
      expect(pageStateFor("u1", "stock-pro")).toBeNull()
      const stop = shCalls.find((args) =>
        (args.at(-1) ?? "").includes("pkill -KILL -x -f"),
      )
      expect(stop).toBeDefined()
      expect(stop?.at(-1)).not.toContain(".token'")
    } finally {
      setSystemTime()
      globalThis.fetch = originalFetch
      clearPluginPageState()
    }
  })

  test("a settings save never boots a stopped page server", async () => {
    clearPluginPageState()
    shCalls.length = 0
    try {
      const row = {
        pluginId: "stock-pro",
        enabled: true,
        manifest: { dashboard: { pages: { entry: "server.ts" } } },
      } as unknown as InstalledPlugin
      const db = { installedPlugin: () => null } as never
      schedulePluginPageRestart(db, "u1", row)
      await new Promise((resolve) => setTimeout(resolve, 2_300))
      // No state entry → the deferred restart is a no-op, no docker exec.
      expect(shCalls).toHaveLength(0)
    } finally {
      clearPluginPageState()
    }
  })
})
