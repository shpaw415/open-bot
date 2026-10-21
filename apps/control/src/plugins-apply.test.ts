import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InstalledPlugin, User } from "@open-bot/db"
import { openDatabase } from "@open-bot/db"
import * as dockerModule from "./docker"
import * as mcpModule from "./mcp"
import {
  clearPendingPluginConfigSyncs,
  flushPendingPluginConfigs,
  pendingPluginConfigSyncCount,
  pluginConfigPayload,
  pluginsForVaultSlug,
  pluginVaultKeys,
  reapplyPluginConfig,
  resyncPluginsForLanguage,
  setPluginEnabled,
} from "./plugins-apply"

let syncPluginAuthMode: "ok" | "down" | "fail" = "ok"
const syncCalls: { pluginId: string; data: unknown }[] = []
let syncOpencodeMode: "ok" | "fail" = "ok"
const opencodePatches: unknown[] = []
// bun's mock.module is process-wide, so heavy docker surfaces must proxy to
// the real implementation unless these tests explicitly disable them — a
// plain no-op would break restart.test.ts, which tests the real functions.
// The real functions are captured at factory time: the dockerModule binding
// points at this very mock by the time the proxy runs.
let noopHeavyDocker = false
mock.module("./docker", () => {
  const real = { ...dockerModule }
  return {
    ...real,
    syncPluginAuth: async (
      _userId: string,
      pluginId: string,
      data: Record<string, unknown> | null,
    ) => {
      syncCalls.push({ pluginId, data })
      if (syncPluginAuthMode === "down") return false
      if (syncPluginAuthMode === "fail") throw new Error("exec boom")
      return true
    },
    syncOpencodePlugin: async (_userId: string, patch: unknown) => {
      opencodePatches.push(patch)
      if (syncOpencodeMode === "fail") throw new Error("jq boom")
      return true
    },
    restartOpencode: async (
      ...args: Parameters<typeof real.restartOpencode>
    ) => {
      if (noopHeavyDocker) return
      return real.restartOpencode(...args)
    },
    syncPluginAgentsMd: async (
      ...args: Parameters<typeof real.syncPluginAgentsMd>
    ) => {
      if (noopHeavyDocker) return
      return real.syncPluginAgentsMd(...args)
    },
  }
})
mock.module("./mcp", () => ({
  ...mcpModule,
  connectMcpServers: async () => ({}),
  disconnectMcpServers: async () => {},
}))

function row(
  pluginId: string,
  enabled: boolean,
  vaultRead?: string[],
  vaultCreate?: string[],
  name?: string,
) {
  return {
    pluginId,
    enabled,
    manifest: {
      ...(name ? { name } : {}),
      ...(vaultRead || vaultCreate
        ? { permissions: { vaultRead, vaultCreate } }
        : {}),
    },
  } as unknown as InstalledPlugin
}

describe("pluginsForVaultSlug", () => {
  test("matches enabled plugins declaring the slug in vaultRead", () => {
    const rows = [
      row("a", true, ["xai"]),
      row("b", true, ["fal", "xai"]),
      row("c", true),
      row("d", false, ["xai"]),
    ]
    expect(pluginsForVaultSlug(rows, "xai").map((r) => r.pluginId)).toEqual([
      "a",
      "b",
    ])
  })

  test("matches vaultCreate-only plugins so vault writes re-sync them", () => {
    const rows = [
      row("writer", true, undefined, ["weatherapi"]),
      row("both", true, ["other"], ["weatherapi"]),
      row("reader", true, ["fal"]),
      row("off", false, undefined, ["weatherapi"]),
    ]
    expect(
      pluginsForVaultSlug(rows, "weatherapi").map((r) => r.pluginId),
    ).toEqual(["writer", "both"])
  })

  test("returns nothing when no manifest declares the slug", () => {
    const rows = [row("a", true, ["fal"]), row("b", true)]
    expect(pluginsForVaultSlug(rows, "xai")).toEqual([])
  })
})

describe("pluginVaultKeys", () => {
  test("merges vaultCreate and vaultRead slugs into one entry per slug", () => {
    const rows = [
      row("weather", true, undefined, ["weatherapi"], "Weather"),
      row("alerts", true, ["weatherapi"], undefined, "Alerts"),
    ]
    expect(pluginVaultKeys(rows)).toEqual([
      {
        slug: "weatherapi",
        pluginIds: ["weather", "alerts"],
        pluginNames: ["Weather", "Alerts"],
        access: "create",
        enabled: true,
      },
    ])
  })

  test("excludes shared provider slugs the static vault already owns", () => {
    const rows = [
      row("a", true, ["xai"], undefined, "A"),
      row("b", true, undefined, ["openai", "custom"], "B"),
    ]
    expect(pluginVaultKeys(rows).map((key) => key.slug)).toEqual(["custom"])
  })

  test("vaultRead-only slugs stay access read; disabled plugins mark the entry", () => {
    const rows = [
      row("reader", false, ["hookdeck"], undefined, "Reader"),
      row("writer", true, undefined, ["hookdeck"], "Writer"),
    ]
    const keys = pluginVaultKeys(rows)
    expect(keys).toEqual([
      {
        slug: "hookdeck",
        pluginIds: ["reader", "writer"],
        pluginNames: ["Reader", "Writer"],
        access: "create",
        enabled: true,
      },
    ])
    expect(
      pluginVaultKeys([row("reader", false, ["hookdeck"], undefined, "R")]),
    ).toEqual([
      {
        slug: "hookdeck",
        pluginIds: ["reader"],
        pluginNames: ["R"],
        access: "read",
        enabled: false,
      },
    ])
  })

  test("plugins without vault permissions contribute nothing", () => {
    expect(pluginVaultKeys([row("a", true), row("b", false)])).toEqual([])
  })
})

describe("pluginConfigPayload", () => {
  function user(): User {
    return {
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    } as User
  }

  function db() {
    const database = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    database.createUser(user())
    return database
  }

  test("vaultCreate-only plugins get the documented vault section", () => {
    const database = db()
    database.setUserKey("a", "email-address", {
      apiKey: "justin@example.com",
      accountId: "",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })
    const payload = pluginConfigPayload(
      database,
      "a",
      {
        id: "email-bridge",
        version: "1.0.0",
        permissions: { vaultCreate: ["email-address", "email-app-password"] },
      } as never,
      {},
    )
    expect(payload.vault).toEqual({
      "email-address": {
        apiKey: "justin@example.com",
        accountId: "",
        baseUrl: "",
      },
    })
  })

  test("vault slugs union across access levels without duplicates", () => {
    const database = db()
    database.setUserKey("a", "shared", {
      apiKey: "k1",
      accountId: "acc",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "https://example.com",
    })
    database.setUserKey("a", "read-only", {
      apiKey: "k2",
      accountId: "",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })
    const payload = pluginConfigPayload(
      database,
      "a",
      {
        id: "p",
        version: "1.0.0",
        permissions: {
          vaultRead: ["shared", "read-only"],
          vaultCreate: ["shared"],
        },
      } as never,
      {},
    )
    expect(Object.keys(payload.vault as object).sort()).toEqual([
      "read-only",
      "shared",
    ])
  })

  test("payload carries the host language; a saved value wins", () => {
    const database = db()
    const manifest = { id: "p", version: "1.0.0" } as never
    expect(pluginConfigPayload(database, "a", manifest, {}).language).toBe("fr")
    database.setSetting("language", "en")
    expect(pluginConfigPayload(database, "a", manifest, {}).language).toBe("en")
  })

  test("an invalid saved language falls back to the default", () => {
    const database = db()
    database.setSetting("language", "klingon")
    const payload = pluginConfigPayload(
      database,
      "a",
      { id: "p", version: "1.0.0" } as never,
      {},
    )
    expect(payload.language).toBe("fr")
  })
})

describe("deferred plugin config syncs", () => {
  function user(overrides: Partial<User> = {}): User {
    return {
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
      ...overrides,
    } as User
  }

  function setupDb() {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user())
    const dir = mkdtempSync(join(tmpdir(), "ob-plugin-files-"))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "open-bot.plugin.json"),
      JSON.stringify({
        id: "voice-agent",
        version: "1.0.0",
        permissions: { vaultRead: ["xai"] },
      }),
    )
    db.createInstalledPlugin({
      id: "row-voice-agent",
      userId: "a",
      pluginId: "voice-agent",
      version: "1.0.0",
      manifest: JSON.stringify({
        id: "voice-agent",
        version: "1.0.0",
        permissions: { vaultRead: ["xai"] },
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    db.setUserKey("a", "xai", {
      apiKey: "fresh-key",
      accountId: "acc",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })
    return db
  }

  beforeEach(() => {
    syncCalls.length = 0
    syncPluginAuthMode = "ok"
    clearPendingPluginConfigSyncs()
  })

  test("a write that misses the desktop defers and flushes with fresh values", async () => {
    const db = setupDb()
    const row = db.installedPlugin("a", "voice-agent") as InstalledPlugin

    syncPluginAuthMode = "down"
    await expect(reapplyPluginConfig(db, user(), row)).rejects.toThrow(
      "deferred",
    )
    expect(pendingPluginConfigSyncCount()).toBe(1)

    // A newer key lands in the vault while the write is still pending.
    db.setUserKey("a", "xai", {
      apiKey: "newer-key",
      accountId: "acc",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })

    syncPluginAuthMode = "ok"
    await flushPendingPluginConfigs(db, "a")

    expect(pendingPluginConfigSyncCount()).toBe(0)
    const last = syncCalls.at(-1)
    expect(last?.pluginId).toBe("voice-agent")
    expect(
      (last?.data as { vault: { xai: Record<string, string> } }).vault.xai,
    ).toEqual({ apiKey: "newer-key", accountId: "acc", baseUrl: "" })
  })

  test("a flush error keeps the plugin queued; unrelated users are untouched", async () => {
    const db = setupDb()
    const row = db.installedPlugin("a", "voice-agent") as InstalledPlugin

    syncPluginAuthMode = "fail"
    await expect(reapplyPluginConfig(db, user(), row)).rejects.toThrow(
      "exec boom",
    )
    expect(pendingPluginConfigSyncCount()).toBe(1)

    syncPluginAuthMode = "down"
    await flushPendingPluginConfigs(db, "b")
    expect(pendingPluginConfigSyncCount()).toBe(1)

    await flushPendingPluginConfigs(db, "a")
    expect(pendingPluginConfigSyncCount()).toBe(1)

    syncPluginAuthMode = "ok"
    await flushPendingPluginConfigs(db, "a")
    expect(pendingPluginConfigSyncCount()).toBe(0)
  })
})

describe("resyncPluginsForLanguage", () => {
  function user(): User {
    return {
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    } as User
  }

  function setupDb() {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user())
    for (const [rowId, pluginId, enabled] of [
      ["row-on", "on-plugin", true],
      ["row-off", "off-plugin", false],
    ] as const) {
      db.createInstalledPlugin({
        id: rowId,
        userId: "a",
        pluginId,
        version: "1.0.0",
        manifest: JSON.stringify({ id: pluginId, version: "1.0.0" }),
        readme: null,
        enabled,
        applied: "{}",
        createdAt: 1,
        updatedAt: 1,
      })
    }
    return db
  }

  beforeEach(() => {
    syncCalls.length = 0
    syncPluginAuthMode = "ok"
    clearPendingPluginConfigSyncs()
  })

  test("re-syncs only enabled plugins and the payload rides the language", async () => {
    const db = setupDb()
    const failed = await resyncPluginsForLanguage(db, user())
    expect(failed).toEqual([])
    expect(syncCalls.map((call) => call.pluginId)).toEqual(["on-plugin"])
    expect((syncCalls[0]?.data as { language?: string }).language).toBe("fr")
  })

  test("a failed sync lands in the pending queue and is reported", async () => {
    const db = setupDb()
    syncPluginAuthMode = "fail"
    const failed = await resyncPluginsForLanguage(db, user())
    expect(failed).toEqual(["on-plugin"])
    expect(pendingPluginConfigSyncCount()).toBe(1)

    syncPluginAuthMode = "ok"
    await flushPendingPluginConfigs(db, "a")
    expect(pendingPluginConfigSyncCount()).toBe(0)
  })
})

describe("setPluginEnabled", () => {
  beforeEach(() => {
    syncCalls.length = 0
    syncPluginAuthMode = "ok"
    syncOpencodeMode = "ok"
    opencodePatches.length = 0
    noopHeavyDocker = true
    clearPendingPluginConfigSyncs()
  })

  afterEach(() => {
    noopHeavyDocker = false
    syncOpencodeMode = "ok"
  })

  function user() {
    return {
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    } as User
  }

  function setupDb(manifest: Record<string, unknown>) {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user())
    db.createInstalledPlugin({
      id: "row-effectcraft",
      userId: "a",
      pluginId: "effectcraft-video",
      version: "0.1.1",
      manifest: JSON.stringify(manifest),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    return db
  }

  const surfacesManifest = {
    id: "effectcraft-video",
    version: "0.1.1",
    opencode: {
      mcp: { effectcraft: { type: "local", command: ["bun", "gate.ts"] } },
      agents: { "effectcraft-worker": { description: "worker" } },
      agentTools: { build: { "effectcraft_*": false } },
    },
  }

  test("a failed opencode surface leaves the enabled flag untouched", async () => {
    const db = setupDb(surfacesManifest)
    const row = db.installedPlugin("a", "effectcraft-video") as InstalledPlugin

    syncOpencodeMode = "fail"
    await expect(setPluginEnabled(db, user(), row, false)).rejects.toThrow(
      "jq boom",
    )
    expect(db.installedPlugin("a", "effectcraft-video")?.enabled).toBe(true)
  })

  test("disable removes the surfaces, then flips the flag", async () => {
    const db = setupDb(surfacesManifest)
    const row = db.installedPlugin("a", "effectcraft-video") as InstalledPlugin

    const updated = await setPluginEnabled(db, user(), row, false)
    expect(updated.enabled).toBe(false)
    expect(db.installedPlugin("a", "effectcraft-video")?.enabled).toBe(false)
    // The removal patch carries the plugin's mcp/agents/agentTools.
    const patch = opencodePatches.at(-1) as {
      removeMcp: string[]
      removeAgents: string[]
      removeAgentTools: Record<string, Record<string, boolean>>
    }
    expect(patch.removeMcp).toEqual(["effectcraft"])
    expect(patch.removeAgents).toEqual(["effectcraft-worker"])
    expect(patch.removeAgentTools).toEqual({
      build: { "effectcraft_*": false },
    })
    // The config file (vault secrets) is dropped after the flag flips.
    const auth = syncCalls.at(-1)
    expect(auth?.pluginId).toBe("effectcraft-video")
    expect(auth?.data).toBeNull()
  })

  test("enable re-adds the surfaces and restores the config", async () => {
    const db = setupDb(surfacesManifest)
    const row = db.installedPlugin("a", "effectcraft-video") as InstalledPlugin
    await setPluginEnabled(db, user(), row, false)
    opencodePatches.length = 0

    const enabledRow = db.installedPlugin(
      "a",
      "effectcraft-video",
    ) as InstalledPlugin
    const updated = await setPluginEnabled(db, user(), enabledRow, true)
    expect(updated.enabled).toBe(true)
    const oc = surfacesManifest.opencode as Record<
      string,
      Record<string, unknown>
    >
    const patch = opencodePatches.at(-1) as {
      addMcp: Record<string, unknown>
      addAgents: Record<string, unknown>
      addAgentTools: Record<string, unknown>
    }
    expect(patch.addMcp).toEqual(oc.mcp)
    expect(patch.addAgents).toEqual(oc.agents)
    expect(patch.addAgentTools).toEqual(oc.agentTools)
  })
})
