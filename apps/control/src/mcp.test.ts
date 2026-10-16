import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Desktop, User } from "@open-bot/db"

const shCalls: string[][] = []
let execResults: { code: number; stdout: string; stderr: string }[] = []
let running = true

mock.module("./docker", () => ({
  endpoint: async () => "http://10.0.0.1:4096",
  isRunning: async () => running,
  opencodeExec: async (_userId: string, args: string[]) => {
    shCalls.push(args)
    return execResults.shift() ?? { code: 0, stdout: "{}", stderr: "" }
  },
  restartOpencode: async () => {
    shCalls.push(["restart"])
  },
}))

mock.module("./effort", () => ({
  basicOpencodeAuth: () => ({ authorization: "Basic b3BlbmNvZGU6" }),
}))

mock.module("./env", () => ({
  names: () => ({ opencode: "ob-oc-test" }),
}))

const { handleMcp, pluginMcpOwners, validateMcpEntry } = await import("./mcp")
const { httpErrorResponse } = await import("./http-error")

type HubEvent = { type: string }
const fakeHub = (events: HubEvent[]) =>
  ({
    emit: (_userId: string, event: HubEvent) => {
      events.push(event)
    },
  }) as never

const user = { id: "u1" } as User
const desktop = { opencodePassword: "secret" } as Desktop
const ensure = async () => desktop
const hubEvents: HubEvent[] = []
const hub = fakeHub(hubEvents)

const dbWith = (
  plugins: { pluginId: string; enabled: boolean; manifest: object }[],
) =>
  ({
    installedPlugins: () => plugins,
  }) as never

// handleMcp throws HttpError; the server's top-level catch converts it the
// same way, so tests run it through httpErrorResponse too.
function mcpRequest(req: Request, url: URL, db: ReturnType<typeof dbWith>) {
  return handleMcp(req, url, db, user, hub, ensure).catch(httpErrorResponse)
}

function route(method: string, path: string, body?: unknown) {
  return new Request(`http://control.test${path}`, {
    method,
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  })
}

beforeEach(() => {
  shCalls.length = 0
  execResults = []
  hubEvents.length = 0
  running = true
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ search: { status: "connected" } }), {
      status: 200,
    })) as unknown as typeof fetch
})

describe("pluginMcpOwners", () => {
  test("collects mcp keys from enabled plugin manifests", () => {
    const owners = pluginMcpOwners(
      dbWith([
        {
          pluginId: "blender-pro",
          enabled: true,
          manifest: {
            name: "Blender Pro",
            opencode: {
              mcp: { blender: { type: "local", command: ["blender"] } },
            },
          },
        },
        {
          pluginId: "off-pro",
          enabled: false,
          manifest: { name: "Off", opencode: { mcp: { gone: {} } } },
        },
      ]),
      "u1",
    )
    expect(owners.get("blender")).toEqual({
      id: "blender-pro",
      name: "Blender Pro",
    })
    expect(owners.has("gone")).toBe(false)
  })
})

describe("validateMcpEntry", () => {
  test("accepts a local entry", () => {
    const entry = validateMcpEntry({
      type: "local",
      command: ["npx", "-y", "srv"],
      environment: { KEY: "v" },
    })
    expect(entry.command).toEqual(["npx", "-y", "srv"])
  })

  test("rejects a local entry without a command", () => {
    expect(() => validateMcpEntry({ type: "local", command: [] })).toThrow()
    expect(() => validateMcpEntry({ type: "local" })).toThrow()
  })

  test("rejects a remote entry without an http url", () => {
    expect(() => validateMcpEntry({ type: "remote", url: "ftp://x" })).toThrow()
    expect(() => validateMcpEntry({ type: "remote" })).toThrow()
  })

  test("rejects non-string env values and bad timeouts", () => {
    expect(() =>
      validateMcpEntry({
        type: "local",
        command: ["x"],
        environment: { K: 3 },
      }),
    ).toThrow()
    expect(() =>
      validateMcpEntry({ type: "local", command: ["x"], timeout: -1 }),
    ).toThrow()
  })
})

describe("handleMcp GET /api/mcp", () => {
  test("merges config, live status, and plugin ownership", async () => {
    execResults = [
      {
        code: 0,
        stdout: JSON.stringify({
          files: { type: "local", command: ["npx", "files"] },
          blender: { type: "local", command: ["blender"], enabled: false },
          search: { type: "remote", url: "https://x/mcp" },
        }),
        stderr: "",
      },
    ]
    const response = await mcpRequest(
      route("GET", "/api/mcp"),
      new URL("http://control.test/api/mcp"),
      dbWith([
        {
          pluginId: "blender-pro",
          enabled: true,
          manifest: { name: "Blender Pro", opencode: { mcp: { blender: {} } } },
        },
      ]),
    )
    const body = (await response?.json()) as {
      servers: {
        name: string
        status: string
        enabled: boolean
        plugin?: { name: string } | null
      }[]
      live: boolean
    }
    expect(body.live).toBe(true)
    const byName = Object.fromEntries(body.servers.map((s) => [s.name, s]))
    expect(byName.files.status).toBe("unknown")
    expect(byName.files.enabled).toBe(true)
    expect(byName.blender.status).toBe("disabled")
    expect(byName.blender.plugin?.name).toBe("Blender Pro")
    expect(byName.search.status).toBe("connected")
  })

  test("returns an empty list while the desktop agent container is down", async () => {
    running = false
    const response = await mcpRequest(
      route("GET", "/api/mcp"),
      new URL("http://control.test/api/mcp"),
      dbWith([]),
    )
    const body = (await response?.json()) as {
      servers: unknown[]
      live: boolean
    }
    expect(body.servers).toEqual([])
    expect(body.live).toBe(false)
    expect(shCalls).toHaveLength(0)
  })
})

describe("handleMcp mutations", () => {
  test("PUT validates the name and refuses plugin-owned keys", async () => {
    const db = dbWith([
      {
        pluginId: "p",
        enabled: true,
        manifest: { name: "P", opencode: { mcp: { taken: {} } } },
      },
    ])
    const bad = await mcpRequest(
      route("PUT", "/api/mcp", {
        name: "bad name!",
        server: { type: "local", command: ["x"] },
      }),
      new URL("http://control.test/api/mcp"),
      db,
    )
    expect(bad?.status).toBe(400)
    const owned = await mcpRequest(
      route("PUT", "/api/mcp", {
        name: "taken",
        server: { type: "local", command: ["x"] },
      }),
      new URL("http://control.test/api/mcp"),
      db,
    )
    expect(owned?.status).toBe(409)
    expect(shCalls).toHaveLength(0)
  })

  test("PUT writes the entry, restarts opencode, and emits mcp.changed", async () => {
    execResults = [
      { code: 0, stdout: "{}", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]
    const response = await mcpRequest(
      route("PUT", "/api/mcp", {
        name: "files",
        server: { type: "local", command: ["npx", "files"] },
      }),
      new URL("http://control.test/api/mcp"),
      dbWith([]),
    )
    expect(
      (await response?.json()) as { ok: boolean; replaced: boolean },
    ).toEqual({ ok: true, replaced: false })
    expect(shCalls).toContainEqual(["restart"])
    expect(hubEvents.map((e) => e.type)).toEqual(["mcp.changed"])
    const write = shCalls.find((args) => args.join(" ").includes(".mcp = "))
    expect(write?.join(" ")).toContain("files")
  })

  test("POST disable refuses plugin-owned keys", async () => {
    const response = await mcpRequest(
      route("POST", "/api/mcp/blender/disable"),
      new URL("http://control.test/api/mcp/blender/disable"),
      dbWith([
        {
          pluginId: "p",
          enabled: true,
          manifest: { name: "P", opencode: { mcp: { blender: {} } } },
        },
      ]),
    )
    expect(response?.status).toBe(409)
  })

  test("POST disable 404s unknown names", async () => {
    execResults = [{ code: 0, stdout: "{}", stderr: "" }]
    const response = await mcpRequest(
      route("POST", "/api/mcp/ghost/disable"),
      new URL("http://control.test/api/mcp/ghost/disable"),
      dbWith([]),
    )
    expect(response?.status).toBe(404)
  })

  test("POST disable sets enabled=false and restarts", async () => {
    execResults = [
      {
        code: 0,
        stdout: '{"files":{"type":"local","command":["x"]}}',
        stderr: "",
      },
      { code: 0, stdout: "", stderr: "" },
    ]
    const response = await mcpRequest(
      route("POST", "/api/mcp/files/disable"),
      new URL("http://control.test/api/mcp/files/disable"),
      dbWith([]),
    )
    expect(
      (await response?.json()) as { ok: boolean; enabled: boolean },
    ).toEqual({
      ok: true,
      enabled: false,
    })
    expect(shCalls).toContainEqual(["restart"])
    expect(hubEvents.map((e) => e.type)).toEqual(["mcp.changed"])
  })

  test("DELETE removes the key and restarts", async () => {
    execResults = [
      {
        code: 0,
        stdout: '{"files":{"type":"local","command":["x"]}}',
        stderr: "",
      },
      { code: 0, stdout: "", stderr: "" },
    ]
    const response = await mcpRequest(
      route("DELETE", "/api/mcp/files"),
      new URL("http://control.test/api/mcp/files"),
      dbWith([]),
    )
    expect((await response?.json()) as { ok: boolean }).toEqual({ ok: true })
    expect(shCalls).toContainEqual(["restart"])
    expect(hubEvents.map((e) => e.type)).toEqual(["mcp.changed"])
  })

  test("DELETE leaves plugin-owned keys alone", async () => {
    const response = await mcpRequest(
      route("DELETE", "/api/mcp/blender"),
      new URL("http://control.test/api/mcp/blender"),
      dbWith([
        {
          pluginId: "p",
          enabled: true,
          manifest: { name: "P", opencode: { mcp: { blender: {} } } },
        },
      ]),
    )
    expect(response?.status).toBe(409)
    expect(shCalls).toHaveLength(0)
  })

  test("mutations 502 while the desktop agent container is down", async () => {
    running = false
    const response = await mcpRequest(
      route("DELETE", "/api/mcp/files"),
      new URL("http://control.test/api/mcp/files"),
      dbWith([]),
    )
    expect(response?.status).toBe(502)
  })
})
