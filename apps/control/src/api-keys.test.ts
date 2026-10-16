import { describe, expect, test } from "bun:test"
import type { Db, InstalledPlugin, User } from "@open-bot/db"
import { handleKeys, isKeysRequest } from "./api-keys"

type FakeKey = {
  apiKey: string
  accountId?: string
  gatewayId?: string
  gatewayToken?: string
  gatewaySlug?: string
  baseUrl?: string
}

function pluginRow(
  pluginId: string,
  perms: { vaultRead?: string[]; vaultCreate?: string[] },
  name = pluginId,
): InstalledPlugin {
  return {
    pluginId,
    enabled: true,
    manifest: { id: pluginId, name, permissions: perms },
  } as unknown as InstalledPlugin
}

function fakeDb(
  keys: Record<string, FakeKey | null>,
  plugins: InstalledPlugin[] = [],
  team: Record<string, FakeKey | null> = {},
  mode: "personal" | "team" = "personal",
): Db {
  return {
    getSetting: (key: string) =>
      key === "team_config" ? JSON.stringify({ mode }) : null,
    getUserKey: (_userId: string, slug: string) => keys[slug] ?? null,
    getTeamKey: (slug: string) => team[slug] ?? null,
    installedPlugins: (_userId: string) => plugins,
  } as unknown as Db
}

const user = { id: "u1" } as unknown as User

function url(path: string) {
  return new URL(`http://localhost${path}`)
}

describe("isKeysRequest", () => {
  test("matches GET list and detail only", () => {
    expect(isKeysRequest("/api/keys", "GET")).toBe(true)
    expect(isKeysRequest("/api/keys/xai", "GET")).toBe(true)
    expect(isKeysRequest("/api/keys", "PUT")).toBe(false)
    expect(isKeysRequest("/api/keys", "DELETE")).toBe(false)
    expect(isKeysRequest("/api/keys", "POST")).toBe(false)
    expect(isKeysRequest("/api/keysx", "GET")).toBe(false)
    expect(isKeysRequest("/api/other", "GET")).toBe(false)
  })
})

describe("handleKeys", () => {
  test("list reports set slugs without secrets", async () => {
    const db = fakeDb({ xai: { apiKey: "sekret" } })
    const res = handleKeys(url("/api/keys"), db, user)
    expect(res?.status).toBe(200)
    const body = JSON.parse((await res?.text()) ?? "{}")
    const xai = body.keys.find((k: { slug: string }) => k.slug === "xai")
    const fal = body.keys.find((k: { slug: string }) => k.slug === "fal")
    expect(xai.hasKey).toBe(true)
    expect(fal.hasKey).toBe(false)
    expect(JSON.stringify(body)).not.toContain("sekret")
  })

  test("detail returns the full record", async () => {
    const db = fakeDb({
      cloudflare: {
        apiKey: "cf-token",
        accountId: "",
        gatewayId: "",
        gatewayToken: "",
        gatewaySlug: "",
        baseUrl: "",
      },
    })
    const res = handleKeys(url("/api/keys/cloudflare"), db, user)
    expect(res?.status).toBe(200)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body).toEqual({
      slug: "cloudflare",
      apiKey: "cf-token",
      accountId: "",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })
  })

  test("known slug without a key is a 404", async () => {
    const db = fakeDb({})
    const res = handleKeys(url("/api/keys/xai"), db, user)
    expect(res?.status).toBe(404)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body.error).toContain("no xai key set")
  })

  test("unknown slug is a 400 with the valid slugs", async () => {
    const db = fakeDb({})
    const res = handleKeys(url("/api/keys/nope"), db, user)
    expect(res?.status).toBe(400)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body.slugs).toContain("xai")
  })

  test("a bad percent-encoding is a 400, not a crash", async () => {
    const db = fakeDb({})
    const res = handleKeys(url("/api/keys/%zz"), db, user)
    expect(res?.status).toBe(400)
  })
})

describe("plugin vault keys", () => {
  test("list adds vaultCreate plugin slugs, not vaultRead-only ones", async () => {
    const db = fakeDb({}, [
      pluginRow("weather", { vaultCreate: ["weatherapi"] }, "Weather"),
      pluginRow("alerts", { vaultRead: ["hookdeck"] }, "Alerts"),
    ])
    const res = handleKeys(url("/api/keys"), db, user)
    const body = JSON.parse((await res?.text()) ?? "{}")
    const weatherapi = body.keys.find(
      (k: { slug: string }) => k.slug === "weatherapi",
    )
    expect(weatherapi).toEqual({
      slug: "weatherapi",
      label: "Weather · weatherapi",
      chatProvider: false,
      plugin: true,
      hasKey: false,
    })
    expect(
      body.keys.find((k: { slug: string }) => k.slug === "hookdeck"),
    ).toBeUndefined()
  })

  test("detail returns a plugin create key with blank gateway fields", async () => {
    const db = fakeDb(
      {
        weatherapi: {
          apiKey: "wkey",
          accountId: "acc",
          gatewayId: "should-vanish",
          gatewayToken: "should-vanish",
          gatewaySlug: "should-vanish",
          baseUrl: "https://api.weather.example",
        },
      },
      [pluginRow("weather", { vaultCreate: ["weatherapi"] }, "Weather")],
    )
    const res = handleKeys(url("/api/keys/weatherapi"), db, user)
    expect(res?.status).toBe(200)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body).toEqual({
      slug: "weatherapi",
      apiKey: "wkey",
      accountId: "acc",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "https://api.weather.example",
    })
  })

  test("a vaultRead-only slug is unknown to the agent", async () => {
    const db = fakeDb({ hookdeck: { apiKey: "hkey" } }, [
      pluginRow("alerts", { vaultRead: ["hookdeck"] }, "Alerts"),
    ])
    const res = handleKeys(url("/api/keys/hookdeck"), db, user)
    expect(res?.status).toBe(400)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body.error).toContain("unknown key slug: hookdeck")
  })

  test("unknown-slug 400 lists plugin create slugs as valid", async () => {
    const db = fakeDb({}, [
      pluginRow("weather", { vaultCreate: ["weatherapi"] }, "Weather"),
    ])
    const res = handleKeys(url("/api/keys/nope"), db, user)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(body.slugs).toContain("weatherapi")
  })

  test("team mode reads shared slugs from team keys, plugins stay per-user", async () => {
    const db = fakeDb(
      { weatherapi: { apiKey: "mine" } },
      [pluginRow("weather", { vaultCreate: ["weatherapi"] }, "Weather")],
      { xai: { apiKey: "shared-xai" } },
      "team",
    )
    const res = handleKeys(url("/api/keys"), db, user)
    const body = JSON.parse((await res?.text()) ?? "{}")
    expect(
      body.keys.find((k: { slug: string }) => k.slug === "xai").hasKey,
    ).toBe(true)
    expect(
      body.keys.find((k: { slug: string }) => k.slug === "weatherapi").hasKey,
    ).toBe(true)
    const detail = handleKeys(url("/api/keys/xai"), db, user)
    expect(detail?.status).toBe(200)
    expect(JSON.parse((await detail?.text()) ?? "{}").apiKey).toBe("shared-xai")
    const pluginDetail = handleKeys(url("/api/keys/weatherapi"), db, user)
    expect(JSON.parse((await pluginDetail?.text()) ?? "{}").apiKey).toBe("mine")
    const missing = handleKeys(url("/api/keys/openai"), db, user)
    expect(missing?.status).toBe(404)
  })

  test("personal mode never reads team keys", async () => {
    const db = fakeDb({}, [], { xai: { apiKey: "shared-xai" } })
    const res = handleKeys(url("/api/keys/xai"), db, user)
    expect(res?.status).toBe(404)
  })
})
