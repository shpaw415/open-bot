// Pinned dev-version installs (report 2026-10-16): `ob-plugin install ID
// --version beta-N` must resolve any listed version, not just the listing's
// latest_version — dev publishes never move latest_version, so comparing
// against it 404ed every pinned dev install even though the marketplace had
// already resolved the exact version row. Needs a marketplace URL and token,
// which are read from env at module load; mock.module("./env") is
// process-global in bun and poisons the rest of the suite, so this file
// self-skips unless configured:
//   OPEN_BOT_MARKETPLACE_URL=http://market.test bun test \
//     apps/control/src/plugins-install-version.test.ts
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { User } from "@open-bot/db"
import { type Db, openDatabase } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import * as dockerModule from "./docker"
import { marketplaceUrl } from "./env"
import * as pluginArtifactModule from "./plugin-artifact"
import { handlePlugins } from "./plugins"
import * as vikingSkillsModule from "./viking-skills"

const run = marketplaceUrl !== ""

const realCreateVikingSkills = vikingSkillsModule.createVikingSkills
type SkillsClient = ReturnType<typeof realCreateVikingSkills>
let fakeSkills: SkillsClient | null = null

if (run) {
  mock.module("./docker", () => ({
    ...dockerModule,
    endpoint: async () => "http://viking.test:1933",
    syncPluginAuth: async () => true,
  }))
  mock.module("./viking-skills", () => ({
    ...vikingSkillsModule,
    createVikingSkills: (
      ...args: Parameters<typeof realCreateVikingSkills>
    ): SkillsClient => fakeSkills ?? realCreateVikingSkills(...args),
  }))
}

function fakeVikingSkills() {
  const client = {
    list: async () => [],
    get: async (name: string) => ({ name, description: "", body: "" }),
    save: async (_input: { name: string; description: string }) => {},
    remove: async (_name: string) => {},
  }
  return client as unknown as SkillsClient
}

function user(): User {
  return {
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  }
}

function route(path: string, method = "GET", body?: unknown) {
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

const manifest = {
  id: "weather-pro",
  name: "Weather Pro",
  version: "beta-2",
  description: "Weather lookups.",
  author: "open-bot",
  repo: "shpaw415/open-bot-plugin-weather-pro",
  category: "utilities",
  tags: [],
} as unknown as PluginManifest

function detail(versions: string[]) {
  return {
    plugin: {
      id: "weather-pro",
      name: "Weather Pro",
      // The listing pointer: a dev publish never moves it off the last
      // stable/promoted version.
      version: "1.0.0",
      description: "Weather lookups.",
      author: "open-bot",
      repo: "shpaw415/open-bot-plugin-weather-pro",
      category: "utilities",
      tags: [],
      status: "approved",
      securityStatus: "pass",
      downloads: 3,
      priceCents: 0,
    },
    manifest,
    readme: null,
    versions: versions.map((version, index) => ({
      version,
      stability: version.includes("-") ? "dev" : "stable",
      createdAt: index + 1,
      notes: null,
      securityStatus: "pass",
    })),
  }
}

describe.skipIf(!run)("pinned marketplace install versions", () => {
  let db: Db
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-pin-")), "bot.sqlite"),
    )
    db.createUser(user())
    db.setSetting("marketplace_api_key", "obm_Mx4Bp9Qw7Tk2Zr8Nv5Lj3Hd6Fg1Sy0C_")
    fakeSkills = fakeVikingSkills()
  })

  test("accepts a listed version that is not the listing's latest", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(detail(["1.0.0", "beta-1", "beta-2"])), {
        status: 200,
      })) as unknown as typeof fetch
    // The manifest ships no files[]/ui, so the artifact is only touched for
    // CONFIG.md extraction — gated here and expected to be non-fatal.
    const spy = spyOn(
      pluginArtifactModule,
      "fetchPluginArtifact",
    ).mockRejectedValue(new Error("artifact gated for test"))
    try {
      const res = await handlePlugins(
        route("/api/plugins/install", "POST", {
          pluginId: "weather-pro",
          version: "beta-2",
          confirm: true,
        }).req,
        route("/api/plugins/install").url,
        db,
        user(),
        hub,
      )
      const body = (await res?.json()) as {
        error?: string
        plugin?: { version: string }
      }
      expect(body?.error).not.toBe("version beta-2 does not exist")
      expect(res?.status).toBe(200)
      expect(body?.plugin?.version).toBe("beta-2")
      expect(db.installedPlugin("a", "weather-pro")?.version).toBe("beta-2")
    } finally {
      spy.mockRestore()
      globalThis.fetch = originalFetch
    }
  })

  test("still 404s a version the marketplace does not list", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(detail(["1.0.0", "beta-1"])), {
        status: 200,
      })) as unknown as typeof fetch
    try {
      const res = await handlePlugins(
        route("/api/plugins/install", "POST", {
          pluginId: "weather-pro",
          version: "beta-9",
          confirm: true,
        }).req,
        route("/api/plugins/install").url,
        db,
        user(),
        hub,
      )
      expect(res?.status).toBe(404)
      expect(await res?.json()).toMatchObject({
        error: "version beta-9 does not exist",
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
