import { describe, expect, test } from "bun:test"
import type { Db, InstalledPlugin } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import {
  clearWebhookState,
  parseWebhookPath,
  publicPagesEnabled,
  resolveUserWebhookTarget,
  resolveWebhookTarget,
  webhookRetryAfter,
  webhookSecret,
} from "./plugin-webhooks"

const USER_ID = "1f0e3dad-9931-4d9a-b1a0-1a2b3c4d5e6f"

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://control.test${url}`, { headers })
}

function install(
  overrides: Partial<InstalledPlugin> & {
    userId: string
    pluginId: string
    webhookToken?: string | null
  },
): InstalledPlugin {
  return {
    id: `${overrides.userId}-${overrides.pluginId}`,
    version: "1.0.0",
    manifest: {
      dashboard: { pages: { entry: "server.js", public: true } },
    } as unknown as Record<string, unknown>,
    readme: null,
    enabled: true,
    source: "marketplace",
    localPath: null,
    applied: {
      personaIds: [],
      cronJobIds: [],
      skills: [],
      keys: [],
      tools: [],
      opencode: false,
    },
    latestVersion: null,
    latestCheckedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as InstalledPlugin
}

function dbOf(rows: InstalledPlugin[]) {
  return {
    installedPluginsByPluginId: (pluginId: string) =>
      rows.filter((row) => row.pluginId === pluginId),
    installedPlugin: (userId: string, pluginId: string) =>
      rows.find((row) => row.userId === userId && row.pluginId === pluginId) ??
      null,
  } as unknown as Db
}

describe("plugin webhooks", () => {
  test("parses legacy hook paths", () => {
    expect(parseWebhookPath("/hooks/stock-pro")).toEqual({
      kind: "legacy",
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parseWebhookPath("/hooks/stock-pro/")).toEqual({
      kind: "legacy",
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parseWebhookPath("/hooks/stock-pro/api/event?x=1")).toEqual({
      kind: "legacy",
      pluginId: "stock-pro",
      rest: "/api/event?x=1",
    })
    expect(parseWebhookPath("/hooks/stock-pro/api/event")).toEqual({
      kind: "legacy",
      pluginId: "stock-pro",
      rest: "/api/event",
    })
  })

  test("parses user-scoped hook paths", () => {
    expect(parseWebhookPath(`/hooks/${USER_ID}/stock-pro`)).toEqual({
      kind: "user",
      userId: USER_ID,
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parseWebhookPath(`/hooks/${USER_ID}/stock-pro/`)).toEqual({
      kind: "user",
      userId: USER_ID,
      pluginId: "stock-pro",
      rest: "/",
    })
    expect(parseWebhookPath(`/hooks/${USER_ID}/stock-pro/api/event`)).toEqual({
      kind: "user",
      userId: USER_ID,
      pluginId: "stock-pro",
      rest: "/api/event",
    })
    expect(
      parseWebhookPath(`/hooks/${USER_ID}/stock-pro/api/event?x=1`),
    ).toEqual({
      kind: "user",
      userId: USER_ID,
      pluginId: "stock-pro",
      rest: "/api/event?x=1",
    })
  })

  test("rejects bad plugin ids and traversal in both shapes", () => {
    expect(parseWebhookPath("/hooks/")).toBeNull()
    expect(parseWebhookPath("/hooks/Stock-Pro/")).toBeNull()
    expect(parseWebhookPath("/hooks/a/../etc")).toBeNull()
    expect(parseWebhookPath("/hooks/stock-pro/../..")).toBeNull()
    expect(parseWebhookPath("/hooks/%2e%2e/x")).toBeNull()
    expect(parseWebhookPath(`/hooks/${USER_ID}/Stock-Pro/`)).toBeNull()
    expect(parseWebhookPath(`/hooks/${USER_ID}/../etc`)).toBeNull()
    expect(parseWebhookPath(`/hooks/${USER_ID}/stock-pro/../..`)).toBeNull()
    expect(parseWebhookPath(`/hooks/${USER_ID}/stock-pro/%2e%2e/x`)).toBeNull()
  })

  test("secrets come from the header or the query", () => {
    const url = new URL("http://control.test/hooks/stock-pro/api/event")
    expect(webhookSecret(request("/hooks/stock-pro/api/event"), url)).toBeNull()
    expect(
      webhookSecret(
        request("/hooks/stock-pro/api/event", {
          "x-open-bot-webhook-secret": " s3cret ",
        }),
        url,
      ),
    ).toBe("s3cret")
    expect(
      webhookSecret(
        request("/hooks/stock-pro/api/event?secret=abc"),
        new URL("http://control.test/hooks/stock-pro/api/event?secret=abc"),
      ),
    ).toBe("abc")
  })

  test("public flag needs a page entry", () => {
    expect(
      publicPagesEnabled({
        dashboard: { pages: { entry: "server.js", public: true } },
      } as PluginManifest),
    ).toBe(true)
    expect(
      publicPagesEnabled({
        dashboard: { pages: { entry: "server.js" } },
      } as PluginManifest),
    ).toBe(false)
    expect(
      publicPagesEnabled({
        dashboard: { pages: { entry: "server.js", public: false } },
      } as PluginManifest),
    ).toBe(false)
    expect(publicPagesEnabled({} as PluginManifest)).toBe(false)
  })

  test("public installs resolve by plugin id alone", () => {
    const row = install({ userId: "u1", pluginId: "stock-pro" })
    expect(resolveWebhookTarget(dbOf([row]), "stock-pro", null)).toEqual({
      kind: "ok",
      row,
    })
    expect(resolveWebhookTarget(dbOf([row]), "stock-pro", "x")).toEqual({
      kind: "not_found",
    })
    expect(resolveWebhookTarget(dbOf([]), "stock-pro", null)).toEqual({
      kind: "not_found",
    })
  })

  test("secured installs require and match the secret", () => {
    const row = install({
      userId: "u1",
      pluginId: "stock-pro",
      webhookToken: "s3cret",
    })
    expect(resolveWebhookTarget(dbOf([row]), "stock-pro", null)).toEqual({
      kind: "not_found",
    })
    expect(resolveWebhookTarget(dbOf([row]), "stock-pro", "wrong")).toEqual({
      kind: "not_found",
    })
    expect(resolveWebhookTarget(dbOf([row]), "stock-pro", "s3cret")).toEqual({
      kind: "ok",
      row,
    })
  })

  test("disabled and non-opted installs are invisible", () => {
    const off = install({ userId: "u1", pluginId: "stock-pro", enabled: false })
    const noflag = install({
      userId: "u1",
      pluginId: "stock-pro",
      manifest: {
        dashboard: { pages: { entry: "server.js" } },
      } as unknown as Record<string, unknown>,
    })
    for (const row of [off, noflag]) {
      expect(resolveWebhookTarget(dbOf([row]), "stock-pro", null)).toEqual({
        kind: "not_found",
      })
    }
  })

  test("user-scoped installs resolve directly per user", () => {
    const row = install({ userId: USER_ID, pluginId: "stock-pro" })
    expect(
      resolveUserWebhookTarget(dbOf([row]), USER_ID, "stock-pro", null),
    ).toEqual({ kind: "ok", row })
    // Another user's install is invisible.
    const other = install({ userId: "u2", pluginId: "stock-pro" })
    expect(
      resolveUserWebhookTarget(dbOf([row, other]), "u2", "stock-pro", null),
    ).toEqual({ kind: "ok", row: other })
    expect(
      resolveUserWebhookTarget(dbOf([row, other]), "u3", "stock-pro", null),
    ).toEqual({ kind: "not_found" })
    expect(
      resolveUserWebhookTarget(dbOf([row, other]), USER_ID, "nope", null),
    ).toEqual({ kind: "not_found" })
  })

  test("user-scoped secured installs require and match the secret", () => {
    const row = install({
      userId: USER_ID,
      pluginId: "stock-pro",
      webhookToken: "s3cret",
    })
    expect(
      resolveUserWebhookTarget(dbOf([row]), USER_ID, "stock-pro", null),
    ).toEqual({ kind: "not_found" })
    expect(
      resolveUserWebhookTarget(dbOf([row]), USER_ID, "stock-pro", "wrong"),
    ).toEqual({ kind: "not_found" })
    expect(
      resolveUserWebhookTarget(dbOf([row]), USER_ID, "stock-pro", "s3cret"),
    ).toEqual({ kind: "ok", row })
    const open = install({ userId: USER_ID, pluginId: "weather-pro" })
    expect(
      resolveUserWebhookTarget(dbOf([open]), USER_ID, "weather-pro", "x"),
    ).toEqual({ kind: "not_found" })
  })

  test("user-scoped disabled and non-opted installs are invisible", () => {
    const off = install({
      userId: USER_ID,
      pluginId: "stock-pro",
      enabled: false,
    })
    const noflag = install({
      userId: USER_ID,
      pluginId: "stock-pro",
      manifest: {
        dashboard: { pages: { entry: "server.js" } },
      } as unknown as Record<string, unknown>,
    })
    for (const row of [off, noflag]) {
      expect(
        resolveUserWebhookTarget(dbOf([row]), USER_ID, "stock-pro", null),
      ).toEqual({ kind: "not_found" })
    }
  })

  test("several public installs of one id are ambiguous, one secured wins", () => {
    const a = install({ userId: "u1", pluginId: "stock-pro" })
    const b = install({ userId: "u2", pluginId: "stock-pro" })
    expect(resolveWebhookTarget(dbOf([a, b]), "stock-pro", null)).toEqual({
      kind: "ambiguous",
    })
    const secured = install({
      userId: "u3",
      pluginId: "stock-pro",
      webhookToken: "s3cret",
    })
    expect(
      resolveWebhookTarget(dbOf([a, b, secured]), "stock-pro", "s3cret"),
    ).toEqual({ kind: "ok", row: secured })
    expect(
      resolveWebhookTarget(dbOf([a, b, secured]), "stock-pro", "nope"),
    ).toEqual({ kind: "not_found" })
  })

  test("throttle allows a burst then asks to slow down", () => {
    clearWebhookState()
    for (let i = 0; i < 30; i++) {
      expect(webhookRetryAfter("u1", "stock-pro")).toBe(0)
    }
    expect(webhookRetryAfter("u1", "stock-pro")).toBeGreaterThan(0)
    expect(webhookRetryAfter("u2", "stock-pro")).toBe(0)
    expect(webhookRetryAfter("u1", "weather-pro")).toBe(0)
    clearWebhookState()
    expect(webhookRetryAfter("u1", "stock-pro")).toBe(0)
  })
})
