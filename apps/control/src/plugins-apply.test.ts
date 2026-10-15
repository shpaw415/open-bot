import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InstalledPlugin, User } from "@open-bot/db"
import { openDatabase } from "@open-bot/db"
import * as dockerModule from "./docker"
import {
  clearPendingPluginConfigSyncs,
  flushPendingPluginConfigs,
  pendingPluginConfigSyncCount,
  pluginsForVaultSlug,
  pluginVaultKeys,
  reapplyPluginConfig,
} from "./plugins-apply"

let syncPluginAuthMode: "ok" | "down" | "fail" = "ok"
const syncCalls: { pluginId: string; data: unknown }[] = []
mock.module("./docker", () => ({
  ...dockerModule,
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
