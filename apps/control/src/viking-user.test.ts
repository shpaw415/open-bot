import { afterEach, describe, expect, test } from "bun:test"
import { ensureVikingUser, vikingUserKey } from "./viking-user"

const expected =
  "ZGVza3RvcA.YWdlbnQ.ZjEyNjdmODQxMTE0ODBiYmFhMmYzNGE3NTQzNTMxNGU0MmMwN2UxMDgyOWIyOTJiNzFmZDlmNTkyMWVkY2YzYw"

describe("vikingUserKey", () => {
  test("matches the seeded OpenViking user key", () => {
    expect(vikingUserKey("root-key")).toBe(expected)
  })
})

describe("ensureVikingUser", () => {
  const original = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = original
  })

  test("treats an existing account as success", async () => {
    let url = ""
    let init: RequestInit | undefined
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      options?: RequestInit,
    ) => {
      url = String(input)
      init = options
      return new Response(null, { status: 409 })
    }) as unknown as typeof fetch
    await expect(
      ensureVikingUser("http://10.0.0.2:1933", "root-key"),
    ).resolves.toBeUndefined()
    expect(url).toBe("http://10.0.0.2:1933/api/v1/admin/accounts")
    expect(init?.method).toBe("POST")
    const headers = new Headers(init?.headers)
    expect(headers.get("x-api-key")).toBe("root-key")
    expect(JSON.parse(String(init?.body))).toEqual({
      account_id: "desktop",
      admin_user_id: "agent",
      seed: "root-key",
    })
  })

  test("accepts a matching issued key", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "ok",
        result: { user_key: expected },
      })) as unknown as typeof fetch
    await expect(
      ensureVikingUser("http://10.0.0.2:1933", "root-key"),
    ).resolves.toBeUndefined()
  })

  test("rejects a mismatched issued key", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "ok",
        result: { user_key: "not-the-seeded-key" },
      })) as unknown as typeof fetch
    await expect(
      ensureVikingUser("http://10.0.0.2:1933", "root-key"),
    ).rejects.toThrow(/does not match/)
  })

  test("surfaces other admin API failures", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch
    await expect(
      ensureVikingUser("http://10.0.0.2:1933", "root-key"),
    ).rejects.toThrow(/401/)
  })
})
