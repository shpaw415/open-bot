import { describe, expect, test } from "bun:test"
import type { Db, User } from "@open-bot/db"
import { handleKeys, isKeysRequest } from "./api-keys"

type FakeKey = {
  apiKey: string
  accountId?: string
  gatewayId?: string
  gatewayToken?: string
  gatewaySlug?: string
  baseUrl?: string
}

function fakeDb(keys: Record<string, FakeKey | null>): Db {
  return {
    getUserKey: (_userId: string, slug: string) => keys[slug] ?? null,
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
