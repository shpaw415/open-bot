import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { User } from "@open-bot/db"
import { type Db, emptyAppliedLog, openDatabase } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import * as dockerModule from "./docker"
import * as pluginArtifactModule from "./plugin-artifact"
import { ensureGuardCron, handlePlugins } from "./plugins"
import {
  applyPluginInstall,
  applyPluginUninstall,
  reapplyPluginSetup,
  setPluginEnabled,
  withVikingRetries,
} from "./plugins-apply"
import * as vikingSkillsModule from "./viking-skills"

// The install/uninstall skill paths resolve the desktop viking endpoint and
// client; tests below swap in a fake client and a fixed endpoint.
const realCreateVikingSkills = vikingSkillsModule.createVikingSkills
type SkillsClient = ReturnType<typeof realCreateVikingSkills>
let fakeSkills: SkillsClient | null = null

// Router tests run without a desktop: the config file write reports its
// deferral instead of silently skipping.
const syncPluginAuthDown = true

mock.module("./docker", () => ({
  ...dockerModule,
  endpoint: async () => "http://viking.test:1933",
  syncPluginAuth: async () => !syncPluginAuthDown,
}))
mock.module("./viking-skills", () => ({
  ...vikingSkillsModule,
  createVikingSkills: (
    ...args: Parameters<typeof realCreateVikingSkills>
  ): SkillsClient => fakeSkills ?? realCreateVikingSkills(...args),
}))

function fakeVikingSkills(existing: { name: string; description: string }[]) {
  const saves: { name: string; description: string }[] = []
  const client = {
    list: async () => existing.map((s) => ({ ...s })),
    get: async (name: string) => ({
      name,
      description: existing.find((s) => s.name === name)?.description ?? "",
      body: "",
    }),
    save: async (input: { name: string; description: string }) => {
      saves.push({ name: input.name, description: input.description })
      const found = existing.find((s) => s.name === input.name)
      if (found) found.description = input.description
      else existing.push({ name: input.name, description: input.description })
    },
    remove: async (name: string) => {
      const index = existing.findIndex((s) => s.name === name)
      if (index >= 0) existing.splice(index, 1)
    },
  }
  return { client: client as unknown as SkillsClient, saves }
}

const manifest = {
  id: "weather-pro",
  name: "Weather Pro",
  version: "1.0.0",
  description: "Weather lookups.",
  author: "open-bot",
  repo: "shpaw415/open-bot-plugin-weather-pro",
  category: "utilities",
  tags: [],
}

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
  }
}

function route(
  path: string,
  method = "GET",
  body?: unknown,
): { req: Request; url: URL } {
  return {
    req: new Request(`http://control.test${path}`, {
      method,
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }
        : {}),
    }),
    url: new URL(`http://control.test${path}`),
  }
}

const hub = { emit: () => {} }

describe("plugins router", () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
    db.createUser(user())
  })

  test("validates manifests", async () => {
    const good = route("/api/plugins/validate", "POST", { manifest })
    const goodRes = await handlePlugins(good.req, good.url, db, user(), hub)
    expect(await goodRes?.json()).toMatchObject({ ok: true })

    const bad = route("/api/plugins/validate", "POST", {
      manifest: { ...manifest, version: "nope!" },
    })
    const badRes = await handlePlugins(bad.req, bad.url, db, user(), hub)
    expect(badRes?.status).toBe(400)
    const body = (await badRes?.json()) as { issues: unknown[] }
    expect(body.issues.length).toBeGreaterThan(0)
  })

  test("defaults to manual policy and gates changes to admins", async () => {
    const initial = route("/api/plugins/policy")
    const res = await handlePlugins(initial.req, initial.url, db, user(), hub)
    expect(await res?.json()).toEqual({
      policy: "manual",
      autoUpdate: "off",
    })

    const denied = route("/api/plugins/policy", "PUT", { policy: "auto" })
    const deniedRes = await handlePlugins(
      denied.req,
      denied.url,
      db,
      user(),
      hub,
    )
    expect(deniedRes?.status).toBe(403)

    const allowed = route("/api/plugins/policy", "PUT", { policy: "auto" })
    const allowedRes = await handlePlugins(
      allowed.req,
      allowed.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await allowedRes?.json()).toEqual({
      policy: "auto",
      autoUpdate: "off",
    })
    const after = route("/api/plugins/policy")
    const afterRes = await handlePlugins(after.req, after.url, db, user(), hub)
    expect(await afterRes?.json()).toEqual({
      policy: "auto",
      autoUpdate: "off",
    })

    const toggle = route("/api/plugins/policy", "PUT", { autoUpdate: "stable" })
    const toggleRes = await handlePlugins(
      toggle.req,
      toggle.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await toggleRes?.json()).toEqual({
      policy: "auto",
      autoUpdate: "stable",
    })
  })

  test("lists installed plugins", async () => {
    const listed = route("/api/plugins/installed")
    const res = await handlePlugins(listed.req, listed.url, db, user(), hub)
    expect(await res?.json()).toMatchObject({ plugins: [], policy: "manual" })
  })

  test("local install rejects a bad path and a missing local row", async () => {
    const both = route("/api/plugins/install", "POST", {
      pluginId: "weather-pro",
      path: "/plugin/root",
    })
    const bothRes = await handlePlugins(both.req, both.url, db, user(), hub)
    expect(bothRes?.status).toBe(400)
    expect(await bothRes?.json()).toMatchObject({
      error: "pass pluginId or path, not both",
    })

    const neither = route("/api/plugins/install", "POST", {})
    const neitherRes = await handlePlugins(
      neither.req,
      neither.url,
      db,
      user(),
      hub,
    )
    expect(neitherRes?.status).toBe(400)

    const relative = route("/api/plugins/install", "POST", {
      path: "plugin/root",
    })
    const relativeRes = await handlePlugins(
      relative.req,
      relative.url,
      db,
      user(),
      hub,
    )
    expect(relativeRes?.status).toBe(400)
    expect(await relativeRes?.json()).toMatchObject({
      error: "path must be an absolute desktop path",
    })

    const traversal = route("/api/plugins/install", "POST", {
      path: "/plugin/../root",
    })
    const traversalRes = await handlePlugins(
      traversal.req,
      traversal.url,
      db,
      user(),
      hub,
    )
    expect(traversalRes?.status).toBe(400)

    const missing = route("/api/plugins/install", "POST", {
      pluginId: "weather-pro",
      local: true,
      confirm: true,
    })
    const missingRes = await handlePlugins(
      missing.req,
      missing.url,
      db,
      user(),
      hub,
    )
    expect(missingRes?.status).toBe(404)
    expect(await missingRes?.json()).toMatchObject({
      error: "not a local plugin",
    })
  })

  test("install accepts dev tags and prereleases, rejects malformed versions", async () => {
    const bad = route("/api/plugins/install", "POST", {
      pluginId: "weather-pro",
      version: "beta!",
    })
    const badRes = await handlePlugins(bad.req, bad.url, db, user(), hub)
    expect(badRes?.status).toBe(400)
    expect(await badRes?.json()).toMatchObject({
      error: "version must be semver or a dev tag (e.g. beta-1)",
    })

    for (const version of ["beta-1", "staging.2", "1.2.3-beta.1"]) {
      const dev = route("/api/plugins/install", "POST", {
        pluginId: "weather-pro",
        version,
      })
      let err: { status?: number } | null = null
      try {
        await handlePlugins(dev.req, dev.url, db, user(), hub)
      } catch (caught) {
        err = caught as { status?: number }
      }
      expect(err?.status).toBe(503)
    }
  })

  test("ensureGuardCron creates and updates one daily job", () => {
    const first = ensureGuardCron(db, user(), manifest)
    const jobs = db.cronJobs("a")
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.name).toBe("plugin:weather-pro:guard")
    expect(jobs[0]?.everySeconds).toBe(86_400)
    expect(jobs[0]?.enabled).toBe(true)
    expect(jobs[0]?.message).toContain("weather-pro")

    const second = ensureGuardCron(db, user(), manifest)
    expect(second).toBe(first)
    expect(db.cronJobs("a")).toHaveLength(1)
  })

  test("stores marketplace API keys in the real generated format", async () => {
    const key = "obm_Mx4Bp9Qw7Tk2Zr8Nv5Lj3Hd6Fg1Sy0C_"

    const bad = route("/api/plugins/marketplace/key", "PUT", { key: "obm_x" })
    const badRes = await handlePlugins(
      bad.req,
      bad.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(badRes?.status).toBe(400)
    expect(await badRes?.json()).toMatchObject({
      error: "that does not look like a marketplace API key",
    })

    const saved = route("/api/plugins/marketplace/key", "PUT", { key })
    const savedRes = await handlePlugins(
      saved.req,
      saved.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await savedRes?.json()).toMatchObject({
      ok: true,
      hint: key.slice(-4),
    })

    const info = route("/api/plugins/marketplace/key")
    const infoRes = await handlePlugins(
      info.req,
      info.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await infoRes?.json()).toMatchObject({
      source: "account",
      hint: key.slice(-4),
    })

    const removed = route("/api/plugins/marketplace/key", "DELETE")
    const removedRes = await handlePlugins(
      removed.req,
      removed.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await removedRes?.json()).toMatchObject({ ok: true })

    const cleared = route("/api/plugins/marketplace/key")
    const clearedRes = await handlePlugins(
      cleared.req,
      cleared.url,
      db,
      user({ role: "admin" }),
      hub,
    )
    expect(await clearedRes?.json()).toMatchObject({ source: "instance" })
  })

  test("unknown plugin routes return null so the server can 404", async () => {
    const missing = route("/api/plugins/nope")
    expect(handlePlugins(missing.req, missing.url, db, user(), hub)).toBeNull()
  })

  test("plugin notices require an installed, enabled, permitted plugin", async () => {
    const emitted: { type: string; properties?: unknown }[] = []
    const localHub = {
      emit: (_id: string, event: { type: string; properties?: unknown }) =>
        emitted.push(event),
    }

    const missing = route("/api/plugins/notice", "POST", {
      pluginId: "weather-pro",
      title: "Hi",
    })
    const missingRes = await handlePlugins(
      missing.req,
      missing.url,
      db,
      user(),
      localHub,
    )
    expect(missingRes?.status).toBe(404)

    const permitted = {
      ...manifest,
      permissions: { notifications: true },
    }
    db.createInstalledPlugin({
      id: "row-1",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify(permitted),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    const ok = route("/api/plugins/notice", "POST", {
      pluginId: "weather-pro",
      title: "Backup done",
      body: "3 files copied",
    })
    const okRes = await handlePlugins(ok.req, ok.url, db, user(), localHub)
    expect(await okRes?.json()).toMatchObject({ ok: true })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: "plugin.notice",
      properties: { pluginId: "weather-pro", title: "Backup done" },
    })

    db.setInstalledPluginEnabled("a", "weather-pro", false)
    const disabled = route("/api/plugins/notice", "POST", {
      pluginId: "weather-pro",
      title: "Hi",
    })
    const disabledRes = await handlePlugins(
      disabled.req,
      disabled.url,
      db,
      user(),
      localHub,
    )
    expect(disabledRes?.status).toBe(409)
  })

  test("plugin notices reject missing permission, bad input, and flood", async () => {
    db.createInstalledPlugin({
      id: "row-1",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify(manifest),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    const denied = route("/api/plugins/notice", "POST", {
      pluginId: "weather-pro",
      title: "Hi",
    })
    const deniedRes = await handlePlugins(
      denied.req,
      denied.url,
      db,
      user(),
      hub,
    )
    expect(deniedRes?.status).toBe(403)

    const tooLong = route("/api/plugins/notice", "POST", {
      pluginId: "weather-pro",
      title: "x".repeat(121),
    })
    const tooLongRes = await handlePlugins(
      tooLong.req,
      tooLong.url,
      db,
      user(),
      hub,
    )
    expect(tooLongRes?.status).toBe(400)

    const update = db.installedPlugin("a", "weather-pro")
    if (update) {
      const withPermission = {
        ...manifest,
        permissions: { notifications: true },
      }
      db.updateInstalledPlugin("a", "weather-pro", {
        version: update.version,
        manifest: JSON.stringify(withPermission),
        readme: null,
      })
    }
    for (let index = 0; index < 30; index++) {
      const flood = route("/api/plugins/notice", "POST", {
        pluginId: "weather-pro",
        title: `note ${index}`,
      })
      const floodRes = await handlePlugins(
        flood.req,
        flood.url,
        db,
        user(),
        hub,
      )
      expect(floodRes?.status).toBe(index < 30 - 1 ? 200 : 429)
    }
  })

  test("settings PUT validates typed configs", async () => {
    db.createInstalledPlugin({
      id: "row-1",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({
        ...manifest,
        configs: [
          {
            key: "units",
            label: "Units",
            def: "metric",
            type: "enum",
            options: ["metric", "imperial"],
          },
          { key: "alerts", label: "Alerts", def: "false", type: "bool" },
          { key: "token", label: "Token", def: "", type: "secret" },
        ],
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    const badEnum = route(
      "/api/plugins/installed/weather-pro/settings",
      "PUT",
      {
        settings: { units: "kelvin" },
      },
    )
    const badEnumRes = await handlePlugins(
      badEnum.req,
      badEnum.url,
      db,
      user(),
      hub,
    )
    expect(badEnumRes?.status).toBe(400)

    const unknown = route(
      "/api/plugins/installed/weather-pro/settings",
      "PUT",
      {
        settings: { nope: "x" },
      },
    )
    const unknownRes = await handlePlugins(
      unknown.req,
      unknown.url,
      db,
      user(),
      hub,
    )
    expect(unknownRes?.status).toBe(400)

    const good = route("/api/plugins/installed/weather-pro/settings", "PUT", {
      settings: { units: "imperial", alerts: "1", token: "hunter2" },
    })
    const goodRes = await handlePlugins(good.req, good.url, db, user(), hub)
    expect(await goodRes?.json()).toMatchObject({ ok: true })
    const values = Object.fromEntries(
      db.pluginSettings("a", "weather-pro").map((s) => [s.key, s.value]),
    )
    expect(values).toEqual({
      units: "imperial",
      alerts: "true",
      token: "hunter2",
    })

    const listed = route("/api/plugins/installed")
    const listedRes = await handlePlugins(
      listed.req,
      listed.url,
      db,
      user(),
      hub,
    )
    const body = (await listedRes?.json()) as {
      plugins: { settings: Record<string, string> }[]
    }
    expect(body.plugins[0]?.settings).toMatchObject({ units: "imperial" })
  })

  test("stores, serves, and validates the dashboard layout", async () => {
    const missing = route("/api/plugins/dashboard-layout")
    const missingRes = await handlePlugins(
      missing.req,
      missing.url,
      db,
      user(),
      hub,
    )
    expect(await missingRes?.json()).toEqual({ layout: null })

    const layout = JSON.stringify({
      pages: [
        { items: [{ type: "app", key: "weather-pro:today" }] },
        {
          items: [
            {
              type: "folder",
              id: "misc",
              name: "Misc",
              items: [{ type: "app", key: "weather-pro:hourly" }],
            },
          ],
        },
      ],
    })
    const put = route("/api/plugins/dashboard-layout", "PUT", { layout })
    const putRes = await handlePlugins(put.req, put.url, db, user(), hub)
    expect(await putRes?.json()).toMatchObject({ ok: true })
    const get = route("/api/plugins/dashboard-layout")
    const getRes = await handlePlugins(get.req, get.url, db, user(), hub)
    expect(await getRes?.json()).toEqual({ layout })

    const badKey = route("/api/plugins/dashboard-layout", "PUT", {
      layout: JSON.stringify({
        pages: [{ items: [{ type: "app", key: "WEATHER PRO/today" }] }],
      }),
    })
    expect(
      (await handlePlugins(badKey.req, badKey.url, db, user(), hub))?.status,
    ).toBe(400)

    const duplicate = route("/api/plugins/dashboard-layout", "PUT", {
      layout: JSON.stringify({
        pages: [
          {
            items: [
              { type: "app", key: "weather-pro:today" },
              { type: "app", key: "weather-pro:today" },
            ],
          },
        ],
      }),
    })
    expect(
      (await handlePlugins(duplicate.req, duplicate.url, db, user(), hub))
        ?.status,
    ).toBe(400)

    const oversized = route("/api/plugins/dashboard-layout", "PUT", {
      layout: "x".repeat(20000),
    })
    expect(
      (await handlePlugins(oversized.req, oversized.url, db, user(), hub))
        ?.status,
    ).toBe(400)
  })

  test("vault write path fills vaultCreate slugs and never echoes values", async () => {
    db.createInstalledPlugin({
      id: "row-vault",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({
        ...manifest,
        permissions: { vaultCreate: ["weatherapi"], vaultRead: ["openai"] },
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    const notFound = route("/api/plugins/installed/other/vault", "POST", {
      slug: "weatherapi",
      value: { apiKey: "k" },
    })
    const notFoundRes = await handlePlugins(
      notFound.req,
      notFound.url,
      db,
      user(),
      hub,
      undefined,
      true,
    )
    expect(notFoundRes?.status).toBe(404)

    const notDeclared = route(
      "/api/plugins/installed/weather-pro/vault",
      "POST",
      { slug: "openai", value: { apiKey: "k" } },
    )
    const notDeclaredRes = await handlePlugins(
      notDeclared.req,
      notDeclared.url,
      db,
      user(),
      hub,
      undefined,
      true,
    )
    expect(notDeclaredRes?.status).toBe(400)

    const good = route("/api/plugins/installed/weather-pro/vault", "POST", {
      slug: "weatherapi",
      value: { apiKey: "wx-key-123", accountId: "acct-1" },
    })
    const goodRes = await handlePlugins(
      good.req,
      good.url,
      db,
      user(),
      hub,
      undefined,
      true,
    )
    // No desktop in this test env: the file write defers, the response says so.
    expect(await goodRes?.json()).toEqual({
      ok: true,
      slug: "weatherapi",
      configSync: expect.stringContaining("deferred"),
    })
    const saved = db.getUserKey("a", "weatherapi")
    expect(saved?.apiKey).toBe("wx-key-123")
    expect(saved?.accountId).toBe("acct-1")

    const listed = route("/api/plugins/installed/weather-pro/vault")
    const listedRes = await handlePlugins(
      listed.req,
      listed.url,
      db,
      user(),
      hub,
      undefined,
      true,
    )
    expect(await listedRes?.json()).toEqual({
      slugs: [{ slug: "weatherapi", hasKey: true }],
    })

    // An empty apiKey clears the key.
    const clear = route("/api/plugins/installed/weather-pro/vault", "POST", {
      slug: "weatherapi",
      value: { apiKey: "" },
    })
    const clearRes = await handlePlugins(
      clear.req,
      clear.url,
      db,
      user(),
      hub,
      undefined,
      true,
    )
    expect(await clearRes?.json()).toEqual({
      ok: true,
      slug: "weatherapi",
      configSync: expect.stringContaining("deferred"),
    })
    expect(db.getUserKey("a", "weatherapi")?.apiKey).toBe("")
  })

  test("dashboard vault lists declared keys and fills custom read slugs", async () => {
    db.createInstalledPlugin({
      id: "row-vault-ui",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({
        ...manifest,
        permissions: {
          vaultCreate: ["weatherapi"],
          vaultRead: ["openai", "hookdeck"],
        },
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    // The dashboard GET lists the union with status metadata (never secrets).
    const listed = route("/api/plugins/installed/weather-pro/vault")
    const listedRes = await handlePlugins(
      listed.req,
      listed.url,
      db,
      user(),
      hub,
    )
    expect(await listedRes?.json()).toEqual({
      slugs: [
        {
          slug: "weatherapi",
          hasKey: false,
          access: "create",
          shared: false,
          accountId: "",
          baseUrl: "",
        },
        {
          slug: "openai",
          hasKey: false,
          access: "read",
          shared: true,
          accountId: "",
          baseUrl: "",
        },
        {
          slug: "hookdeck",
          hasKey: false,
          access: "read",
          shared: false,
          accountId: "",
          baseUrl: "",
        },
      ],
    })

    // Shared provider slugs stay on the Keys tab (its chat re-push runs there).
    const shared = route("/api/plugins/installed/weather-pro/vault", "POST", {
      slug: "openai",
      value: { apiKey: "k" },
    })
    const sharedRes = await handlePlugins(
      shared.req,
      shared.url,
      db,
      user(),
      hub,
    )
    expect(sharedRes?.status).toBe(400)
    expect(((await sharedRes?.json()) as { error: string }).error).toContain(
      "Keys tab",
    )

    // Custom read slugs are settable from the dashboard.
    const custom = route("/api/plugins/installed/weather-pro/vault", "POST", {
      slug: "hookdeck",
      value: { apiKey: "hd-key-1", baseUrl: "https://hookdeck.example" },
    })
    const customRes = await handlePlugins(
      custom.req,
      custom.url,
      db,
      user(),
      hub,
    )
    expect(await customRes?.json()).toEqual({
      ok: true,
      slug: "hookdeck",
      configSync: expect.stringContaining("deferred"),
    })
    expect(db.getUserKey("a", "hookdeck")?.apiKey).toBe("hd-key-1")
    expect(db.getUserKey("a", "hookdeck")?.baseUrl).toBe(
      "https://hookdeck.example",
    )

    // Unknown slugs stay rejected.
    const unknown = route("/api/plugins/installed/weather-pro/vault", "POST", {
      slug: "other",
      value: { apiKey: "k" },
    })
    expect(
      (await handlePlugins(unknown.req, unknown.url, db, user(), hub))?.status,
    ).toBe(400)
  })

  test("install prunes settings the new manifest no longer declares", async () => {
    db.setPluginSetting("a", "weather-pro", "units", "imperial")
    db.setPluginSetting("a", "weather-pro", "legacy", "junk")
    const row = await applyPluginInstall(db, user(), {
      id: "weather-pro",
      version: "1.1.0",
      status: "approved",
      manifest: {
        ...manifest,
        configs: [{ key: "units", label: "Units", def: "metric" }],
      } as unknown as PluginManifest,
      readme: null,
      downloads: 0,
    })
    expect(row.version).toBe("1.1.0")
    const keys = db
      .pluginSettings("a", "weather-pro")
      .map((setting) => setting.key)
      .sort()
    expect(keys).toEqual(["units"])
    // The saved value (not the default) survives the upgrade.
    expect(
      db.pluginSettings("a", "weather-pro").find((s) => s.key === "units")
        ?.value,
    ).toBe("imperial")
  })

  test("reinstall keeps saved settings and request settings win", async () => {
    db.setPluginSetting("a", "weather-pro", "units", "imperial")
    db.setPluginSetting("a", "weather-pro", "token", "hunter2")
    await applyPluginInstall(db, user(), {
      id: "weather-pro",
      version: "1.2.0",
      status: "approved",
      manifest: {
        ...manifest,
        configs: [
          { key: "units", label: "Units", def: "metric" },
          { key: "token", label: "Token", def: "", type: "secret" },
        ],
      } as unknown as PluginManifest,
      readme: null,
      downloads: 0,
    })
    const values = Object.fromEntries(
      db.pluginSettings("a", "weather-pro").map((s) => [s.key, s.value]),
    )
    expect(values).toEqual({ units: "imperial", token: "hunter2" })

    await applyPluginInstall(
      db,
      user(),
      {
        id: "weather-pro",
        version: "1.3.0",
        status: "approved",
        manifest: {
          ...manifest,
          configs: [
            { key: "units", label: "Units", def: "metric" },
            { key: "token", label: "Token", def: "", type: "secret" },
          ],
        } as unknown as PluginManifest,
        readme: null,
        downloads: 0,
      },
      { settings: { units: "kelvin" } },
    ).catch(() => {})
    // kelvin is not a declared enum-less string config value... string type
    // accepts it; the request value must win over the saved one.
    const after = Object.fromEntries(
      db.pluginSettings("a", "weather-pro").map((s) => [s.key, s.value]),
    )
    expect(after.units).toBe("kelvin")
    expect(after.token).toBe("hunter2")
  })

  test("setup retry surfaces failures", async () => {
    db.createInstalledPlugin({
      id: "row-1",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({
        ...manifest,
        setup: { commands: ["echo hello"] },
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })

    const none = route("/api/plugins/installed/unknown/setup", "POST")
    const noneRes = await handlePlugins(none.req, none.url, db, user(), hub)
    expect(noneRes?.status).toBe(404)

    // No desktop is running in tests, so the docker exec path fails with a
    // surfaced error rather than a silent ok.
    const retry = route("/api/plugins/installed/weather-pro/setup", "POST")
    const retryRes = await handlePlugins(retry.req, retry.url, db, user(), hub)
    expect(retryRes?.status).toBe(502)
    const body = (await retryRes?.json()) as { error?: string }
    expect(body.error).toBeTruthy()
  })
})

describe("plugin boot re-apply", () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
    db.createUser(user())
  })

  function installRow(
    pluginId: string,
    overrides: {
      enabled?: boolean
      setup?: boolean
      files?: boolean
      createdAt?: number
    } = {},
  ) {
    const extra: Record<string, unknown> = {}
    if (overrides.setup) {
      extra.setup = { commands: ["echo hello"] }
    }
    if (overrides.files) {
      extra.files = [{ name: "tool", source: "files/tool" }]
    }
    db.createInstalledPlugin({
      id: `row-${pluginId}`,
      userId: "a",
      pluginId,
      version: "1.0.0",
      manifest: JSON.stringify({ ...manifest, id: pluginId, ...extra }),
      readme: null,
      enabled: overrides.enabled ?? true,
      applied: "{}",
      createdAt: overrides.createdAt ?? 1,
      updatedAt: 1,
      ...(overrides.files
        ? { source: "local", localPath: "/home/agent/plugins" }
        : {}),
    })
  }

  test("continues past a failing plugin and skips disabled ones", async () => {
    installRow("local-pro", { files: true, createdAt: 1 })
    installRow("disabled-pro", { files: true, enabled: false, createdAt: 2 })
    installRow("setup-pro", { setup: true, createdAt: 3 })

    // No desktop runs in tests: the local file read fails with a surfaced
    // 409, and every other step no-ops. The boot loop must still process
    // every enabled plugin instead of stopping at the first failure.
    const errors: string[] = []
    const spy = spyOn(console, "error").mockImplementation((message) => {
      errors.push(String(message))
    })
    try {
      await reapplyPluginSetup(db, "a")
    } finally {
      spy.mockRestore()
    }
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain("local-pro boot file sync failed")
    // The setup plugin reached its commands and found no desktop (expected in
    // tests); the disabled plugin was never processed.
    expect(errors[1]).toContain("setup-pro boot setup failed")
    expect(errors.join("\n")).not.toContain("disabled-pro")
  })

  test("keeps the recorded init when the desktop is not running", async () => {
    const recorded = {
      ranAt: 42,
      ok: true,
      output: "earlier install run",
    }
    installRow("setup-pro", { setup: true })
    db.setInstalledPluginApplied("a", "setup-pro", {
      ...emptyAppliedLog(),
      init: recorded,
    })

    const spy = spyOn(console, "error").mockImplementation(() => {})
    try {
      await reapplyPluginSetup(db, "a")
    } finally {
      spy.mockRestore()
    }
    const row = db.installedPlugin("a", "setup-pro")
    expect(row?.applied.init).toEqual(recorded)
  })
})

describe("plugin remove/reinstall orphans", () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
    db.createUser(user())
  })

  function installRow(pluginId: string, cron?: { name: string }) {
    db.createInstalledPlugin({
      id: `row-${pluginId}`,
      userId: "a",
      pluginId,
      version: "1.0.0",
      manifest: JSON.stringify({
        ...manifest,
        id: pluginId,
        ...(cron
          ? { cron: [{ ...cron, message: "tick", everySeconds: 60 }] }
          : {}),
      }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
  }

  test("uninstall sweeps orphaned plugin crons (guard cron) and keeps foreign ones", async () => {
    installRow("weather-pro")
    // The publish flow creates this outside apply — not on applied.cronJobIds.
    ensureGuardCron(db, user(), manifest)
    ensureGuardCron(db, user(), { ...manifest, id: "other-pro" })
    expect(db.cronJobs("a")).toHaveLength(2)

    const result = await applyPluginUninstall(db, user(), {
      ...(db.installedPlugin("a", "weather-pro") as NonNullable<
        ReturnType<typeof db.installedPlugin>
      >),
    })

    expect(result).toEqual({ leftoverSkills: [] })
    const names = db.cronJobs("a").map((job) => job.name)
    expect(names).toEqual(["plugin:other-pro:guard"])
  })

  test("install replaces stale plugin crons instead of refusing", async () => {
    const cronManifest = {
      ...manifest,
      cron: [{ name: "tick", message: "tick", everySeconds: 60 }],
    } as unknown as PluginManifest
    const entry = {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: cronManifest,
      readme: null,
      downloads: 0,
    }
    await applyPluginInstall(db, user(), entry)
    expect(
      db.cronJobs("a").filter((job) => job.name === "plugin:weather-pro:tick"),
    ).toHaveLength(1)

    // Simulate the old leak: the row disappears but the job stays behind.
    db.deleteInstalledPlugin("a", "weather-pro")
    const freshId = db.cronJobs("a")[0]?.id
    const row = await applyPluginInstall(db, user(), entry)

    expect(row.pluginId).toBe("weather-pro")
    const jobs = db
      .cronJobs("a")
      .filter((job) => job.name === "plugin:weather-pro:tick")
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.id).not.toBe(freshId)
    expect(row.applied.cronJobIds).toEqual([jobs[0]?.id])
  })

  test("install upserts over an orphan row instead of failing UNIQUE", async () => {
    const entry = {
      id: "weather-pro",
      version: "2.0.0",
      status: "approved" as const,
      manifest,
      readme: null,
      downloads: 0,
    }
    // A killed install left a stale row behind (remove never saw it).
    installRow("weather-pro")
    expect(db.installedPlugins("a")).toHaveLength(1)

    const row = await applyPluginInstall(db, user(), entry)

    const rows = db.installedPlugins("a")
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe("2.0.0")
    expect(row.applied.personaIds).toEqual([])
    expect(rows[0]?.id).toBe(row.id)
  })

  test("install creates script/auto cron jobs from the manifest", async () => {    const scriptManifest = {
      ...manifest,
      cron: [
        {
          name: "watcher",
          message: "Handle what changed",
          script: "echo '[cron-agent] inbox changed'",
          run: "auto",
          everySeconds: 900,
        },
        {
          name: "snapshot",
          script: "df -h",
          run: "script",
          cronExpr: "0 6 * * *",
        },
      ],
    } as unknown as PluginManifest
    const entry = {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: scriptManifest,
      readme: null,
      downloads: 0,
    }
    await applyPluginInstall(db, user(), entry)
    const jobs = Object.fromEntries(
      db
        .cronJobs("a")
        .filter((job) => job.name.startsWith("plugin:weather-pro:"))
        .map((job) => [job.name, job]),
    )
    expect(jobs["plugin:weather-pro:watcher"]?.runKind).toBe("auto")
    expect(jobs["plugin:weather-pro:watcher"]?.script).toContain("cron-agent")
    expect(jobs["plugin:weather-pro:watcher"]?.message).toBe(
      "Handle what changed",
    )
    expect(jobs["plugin:weather-pro:snapshot"]?.runKind).toBe("script")
    expect(jobs["plugin:weather-pro:snapshot"]?.message).toBe("")
    expect(jobs["plugin:weather-pro:snapshot"]?.script).toBe("df -h")
    expect(jobs["plugin:weather-pro:snapshot"]?.cronExpr).toBe("0 6 * * *")
  })

  test("withVikingRetries backs off transient errors and fails fast otherwise", async () => {
    let calls = 0
    const ok = await withVikingRetries(async () => {
      calls++
      if (calls < 3) throw new Error("lock acquire timed out after 0ms")
      return "ok"
    }, [1, 1])
    expect(ok).toBe("ok")
    expect(calls).toBe(3)

    calls = 0
    let caught = ""
    await withVikingRetries(async () => {
      calls++
      throw new Error("a skill named x is a built-in")
    }, [1, 1]).catch((error: unknown) => {
      caught = error instanceof Error ? error.message : ""
    })
    expect(caught).toBe("a skill named x is a built-in")
    expect(calls).toBe(1)

    calls = 0
    await withVikingRetries(async () => {
      calls++
      throw new Error("lock acquire timed out after 0ms")
    }, [1, 1]).catch(() => {})
    expect(calls).toBe(3)
  })

  test("upgrade that drops a cron entry deletes the previously-owned job", async () => {
    const v1 = {
      ...manifest,
      cron: [{ name: "tick", message: "tick", everySeconds: 60 }],
    } as unknown as PluginManifest
    const v1entry = {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: v1,
      readme: null,
      downloads: 0,
    }
    await applyPluginInstall(db, user(), v1entry)
    expect(db.cronJobs("a")).toHaveLength(1)

    // v2 drops the cron — the job must not survive the upgrade orphaned.
    const v2entry = { ...v1entry, version: "2.0.0", manifest }
    const row = await applyPluginInstall(db, user(), v2entry)

    expect(db.cronJobs("a")).toHaveLength(0)
    expect(row.applied.cronJobIds).toEqual([])
  })

  test("install adopts a skill left behind by an aborted install", async () => {
    db.ensureDesktop({
      userId: "a",
      llmToken: "tok",
      opencodePassword: "pw",
      vikingKey: "vk",
      selectedProvider: null,
      selectedModel: null,
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    const skillManifest = {
      ...manifest,
      skills: [
        {
          name: "weather-pro",
          description: "Weather lookups helper.",
          body: "# weather-pro\nLook up weather.",
        },
      ],
    } as unknown as PluginManifest
    const entry = {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: skillManifest,
      readme: null,
      downloads: 0,
    }
    // An install that died after the skill save but before the row landed
    // leaves the skill with exactly the declared description.
    const { client, saves } = fakeVikingSkills([
      { name: "weather-pro", description: "Weather lookups helper." },
    ])
    fakeSkills = client
    try {
      const row = await applyPluginInstall(db, user(), entry)
      expect(row.applied.skills).toEqual(["weather-pro"])
      expect(saves.map((s) => s.name)).toEqual(["weather-pro"])
    } finally {
      fakeSkills = null
    }
  })

  test("install still refuses a foreign skill with the same name", async () => {
    db.ensureDesktop({
      userId: "a",
      llmToken: "tok",
      opencodePassword: "pw",
      vikingKey: "vk",
      selectedProvider: null,
      selectedModel: null,
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    const skillManifest = {
      ...manifest,
      skills: [
        {
          name: "weather-pro",
          description: "Weather lookups helper.",
          body: "# weather-pro\nLook up weather.",
        },
      ],
    } as unknown as PluginManifest
    const entry = {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: skillManifest,
      readme: null,
      downloads: 0,
    }
    const { client } = fakeVikingSkills([
      { name: "weather-pro", description: "A user's own unrelated skill." },
    ])
    fakeSkills = client
    try {
      await expect(applyPluginInstall(db, user(), entry)).rejects.toThrow(
        /already exists and was not created by this install/,
      )
    } finally {
      fakeSkills = null
    }
  })
})

describe("plugin config guide", () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
    db.createUser(user())
  })

  const GUIDE = "# weather-pro\n\nAsk the user for the API key, then verify.\n"

  // Builds a real release tarball (single root dir) like a GitHub release.
  function tarballWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "ob-guide-tar-"))
    const root = join(dir, "weather-pro-1.0.0")
    mkdirSync(root, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, name), content)
    }
    const out = join(dir, "release.tgz")
    Bun.spawnSync(["tar", "-czf", out, "-C", dir, "weather-pro-1.0.0"])
    return out
  }

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      id: "weather-pro",
      version: "1.0.0",
      status: "approved" as const,
      manifest: { ...manifest } as unknown as PluginManifest,
      readme: null,
      downloads: 0,
      ...overrides,
    }
  }

  function createRow(applied: Record<string, unknown> = {}) {
    db.createInstalledPlugin({
      id: "row-guide",
      userId: "a",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify(manifest),
      readme: null,
      enabled: true,
      applied: JSON.stringify(applied),
      createdAt: 1,
      updatedAt: 1,
    })
  }

  test("marketplace install extracts CONFIG.md and syncs it to the desktop", async () => {
    const artifactSpy = spyOn(
      pluginArtifactModule,
      "fetchPluginArtifact",
    ).mockResolvedValue({
      tarballPath: tarballWith({ "CONFIG.md": GUIDE }),
      sha256: "x",
    })
    const guideCalls: (string | null)[] = []
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async (_userId, _pluginId, data) => {
      guideCalls.push(data)
      return true
    })
    try {
      const row = await applyPluginInstall(db, user(), entry())
      expect(artifactSpy).toHaveBeenCalled()
      expect(guideCalls).toEqual([GUIDE])
      expect(row.applied.configGuide).toBe(true)
    } finally {
      artifactSpy.mockRestore()
      guideSpy.mockRestore()
    }
  })

  test("a release without CONFIG.md installs normally", async () => {
    spyOn(pluginArtifactModule, "fetchPluginArtifact").mockResolvedValue({
      tarballPath: tarballWith({ "README.md": "docs" }),
      sha256: "x",
    })
    const guideCalls: (string | null)[] = []
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async (_userId, _pluginId, data) => {
      guideCalls.push(data)
      return true
    })
    try {
      const row = await applyPluginInstall(db, user(), entry())
      expect(guideCalls).toEqual([])
      expect(row.applied.configGuide).toBeUndefined()
    } finally {
      guideSpy.mockRestore()
    }
  })

  test("local install keeps going when the checkout has no readable guide", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    try {
      const row = await applyPluginInstall(db, user(), entry(), {
        source: "local",
        localPath: "/home/agent/plugins-create/weather-pro",
        files: [],
      })
      expect(row.pluginId).toBe("weather-pro")
      expect(row.applied.configGuide).toBeUndefined()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test("uninstall removes the guide", async () => {
    createRow({ configGuide: true })
    const guideCalls: (string | null)[] = []
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async (_userId, _pluginId, data) => {
      guideCalls.push(data)
      return true
    })
    try {
      await applyPluginUninstall(db, user(), {
        ...(db.installedPlugin("a", "weather-pro") as NonNullable<
          ReturnType<typeof db.installedPlugin>
        >),
      })
      // revertApplied removes the recorded guide and the uninstall sweep
      // removes it unconditionally (covers rows without the marker).
      expect(guideCalls).toEqual([null, null])
    } finally {
      guideSpy.mockRestore()
    }
  })

  test("local guide reader reads the checkout CONFIG.md", async () => {
    const execSpy = spyOn(dockerModule, "opencodeExec").mockImplementation(
      async (_userId, args) => {
        const [cmd, ...rest] = args
        const target = rest[rest.length - 1]
        if (cmd === "realpath") {
          if (target === "/plugin" || target === "/plugin/CONFIG.md") {
            return { code: 0, stdout: `${target}\n`, stderr: "" }
          }
          return { code: 1, stdout: "", stderr: "No such file or directory" }
        }
        const content = target === "/plugin/CONFIG.md" ? GUIDE : undefined
        if (content === undefined) {
          return { code: 1, stdout: "", stderr: "No such file or directory" }
        }
        if (cmd === "stat") {
          return {
            code: 0,
            stdout: `${Buffer.byteLength(content)}\n`,
            stderr: "",
          }
        }
        if (cmd === "cat") return { code: 0, stdout: content, stderr: "" }
        return { code: 0, stdout: "", stderr: "" }
      },
    )
    const { readLocalPluginConfigGuide } = await import("./plugin-local")
    try {
      expect(await readLocalPluginConfigGuide("a", "/plugin")).toBe(GUIDE)
    } finally {
      execSpy.mockRestore()
    }
  })

  test("local guide reader returns null when the checkout has no CONFIG.md", async () => {
    const execSpy = spyOn(dockerModule, "opencodeExec").mockImplementation(
      async (_userId, args) => {
        const [cmd, ...rest] = args
        const target = rest[rest.length - 1]
        if (cmd === "realpath" && target === "/plugin") {
          return { code: 0, stdout: `${target}\n`, stderr: "" }
        }
        return { code: 1, stdout: "", stderr: "No such file or directory" }
      },
    )
    const { readLocalPluginConfigGuide } = await import("./plugin-local")
    try {
      expect(await readLocalPluginConfigGuide("a", "/plugin")).toBeNull()
    } finally {
      execSpy.mockRestore()
    }
  })

  test("disable removes the guide and enable restores it", async () => {
    createRow({ configGuide: true })
    const artifactSpy = spyOn(
      pluginArtifactModule,
      "fetchPluginArtifact",
    ).mockResolvedValue({
      tarballPath: tarballWith({ "CONFIG.md": GUIDE }),
      sha256: "x",
    })
    const guideCalls: (string | null)[] = []
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async (_userId, _pluginId, data) => {
      guideCalls.push(data)
      return true
    })
    try {
      const row = db.installedPlugin("a", "weather-pro") as NonNullable<
        ReturnType<typeof db.installedPlugin>
      >
      await setPluginEnabled(db, user(), row, false)
      expect(guideCalls).toEqual([null])

      guideCalls.length = 0
      await setPluginEnabled(
        db,
        user(),
        db.installedPlugin("a", "weather-pro") as NonNullable<
          ReturnType<typeof db.installedPlugin>
        >,
        true,
      )
      expect(guideCalls).toEqual([GUIDE])
    } finally {
      artifactSpy.mockRestore()
      guideSpy.mockRestore()
    }
  })

  test("enable without a recorded guide does not touch the desktop file", async () => {
    createRow({})
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async () => true)
    try {
      await setPluginEnabled(
        db,
        user(),
        db.installedPlugin("a", "weather-pro") as NonNullable<
          ReturnType<typeof db.installedPlugin>
        >,
        true,
      )
      expect(guideSpy).not.toHaveBeenCalled()
    } finally {
      guideSpy.mockRestore()
    }
  })

  test("boot re-sync restores the guide only for installs that recorded one", async () => {
    createRow({ configGuide: true })
    // A second enabled plugin with no recorded guide.
    db.createInstalledPlugin({
      id: "row-plain",
      userId: "a",
      pluginId: "plain-pro",
      version: "1.0.0",
      manifest: JSON.stringify({ ...manifest, id: "plain-pro" }),
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 2,
      updatedAt: 2,
    })
    const artifactSpy = spyOn(
      pluginArtifactModule,
      "fetchPluginArtifact",
    ).mockResolvedValue({
      tarballPath: tarballWith({ "CONFIG.md": GUIDE }),
      sha256: "x",
    })
    const guideCalls: [string, string | null][] = []
    const guideSpy = spyOn(
      dockerModule,
      "syncPluginConfigGuide",
    ).mockImplementation(async (_userId, pluginId, data) => {
      guideCalls.push([pluginId, data])
      return true
    })
    try {
      await reapplyPluginSetup(db, "a")
      expect(guideCalls).toEqual([["weather-pro", GUIDE]])
    } finally {
      artifactSpy.mockRestore()
      guideSpy.mockRestore()
    }
  })
})
