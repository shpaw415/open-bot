// Per-user marketplace keys backing paid-plugin installs. Deliberately no
// marketplace mocking: mock.module("./env") is process-global in bun and
// poisons other test files in the suite, so marketplace-dependent behavior
// (the install 402 gate, license proxy, artifact paywall) is covered by the
// marketplace-side tests and manual Stripe test-mode runs instead.
import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { User } from "@open-bot/db"
import { type Db, openDatabase } from "@open-bot/db"
import { handlePlugins } from "./plugins"

function user(overrides: Partial<User> = {}): User {
  return {
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
    marketplaceApiKey: null,
    ...overrides,
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

describe("per-user marketplace key", () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-paid-")), "bot.sqlite"),
    )
    db.createUser(user())
  })

  test("set, hint, and remove round-trip on the user row", async () => {
    const bad = route("/api/plugins/marketplace/user-key", "PUT", {
      key: "nope",
    })
    const badRes = await handlePlugins(bad.req, bad.url, db, user(), hub)
    expect(badRes?.status).toBe(400)
    expect((await badRes?.json())?.error).toBe(
      "that does not look like a marketplace API key",
    )
    expect(db.userById("a")?.marketplaceApiKey).toBeNull()

    const key = `obm_${"A".repeat(40)}`
    const put = route("/api/plugins/marketplace/user-key", "PUT", { key })
    const putRes = await handlePlugins(put.req, put.url, db, user(), hub)
    expect(putRes?.status).toBe(200)
    expect((await putRes?.json())?.hint).toBe(key.slice(-4))
    expect(db.userById("a")?.marketplaceApiKey).toBe(key)

    const info = route("/api/plugins/marketplace/user-key")
    const infoRes = await handlePlugins(info.req, info.url, db, user(), hub)
    expect(await infoRes?.json()).toEqual({ set: true, hint: key.slice(-4) })

    const remove = route("/api/plugins/marketplace/user-key", "DELETE")
    const removeRes = await handlePlugins(
      remove.req,
      remove.url,
      db,
      user(),
      hub,
    )
    expect(removeRes?.status).toBe(200)
    expect(db.userById("a")?.marketplaceApiKey).toBeNull()

    const cleared = await ((
      await handlePlugins(info.req, info.url, db, user(), hub)
    )?.json() ?? {})
    expect(cleared).toEqual({ set: false, hint: null })
  })

  test("keys are per user: one user's key never leaks to another", async () => {
    db.createUser(user({ id: "b", email: "b@localhost" }))
    const putA = route("/api/plugins/marketplace/user-key", "PUT", {
      key: `obm_${"A".repeat(40)}`,
    })
    await handlePlugins(putA.req, putA.url, db, user(), hub)
    expect(db.userById("a")?.marketplaceApiKey).toBe(`obm_${"A".repeat(40)}`)
    const infoB = route("/api/plugins/marketplace/user-key")
    const other = await ((
      await handlePlugins(infoB.req, infoB.url, db, user({ id: "b" }), hub)
    )?.json() ?? {})
    expect(other).toEqual({ set: false, hint: null })
    expect(db.userById("b")?.marketplaceApiKey).toBeNull()
  })
})
