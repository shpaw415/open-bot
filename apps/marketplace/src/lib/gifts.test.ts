import { Database } from "bun:sqlite"
import { beforeAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { SESSION_COOKIE, sha256Hex } from "./auth"
import { getPluginRow } from "./db"
import {
  createGift,
  getOwnerSales,
  getUserPurchases,
  hasLicense,
  listPluginGifts,
  revokeGift,
} from "./purchases"

// Minimal D1 adapter over bun:sqlite: enough surface (prepare/bind/first/
// all/run + meta.changes) for the purchases lib and the gift API route,
// with migrations 0001..0007 applied for a real schema.
class SqliteD1 {
  constructor(readonly raw: Database) {}
  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => {
        const stmt = this.raw.prepare(sql)
        const runMeta = () => stmt.run(...(params as never[]))
        return {
          first: async <T>() =>
            (stmt.all(...(params as never[]))[0] as T | undefined) ?? null,
          all: async <T>() => ({
            results: stmt.all(...(params as never[])) as T[],
          }),
          run: async () => ({ meta: { changes: runMeta().changes } }),
        }
      },
    }
  }
}

function openTestDb(): SqliteD1 {
  const sqlite = new Database(":memory:")
  const dir = join(import.meta.dir, "../../migrations")
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(dir, file), "utf8"))
    }
  }
  return new SqliteD1(sqlite)
}

const OWNER = "user-owner"
const BUYER = "user-buyer"
const FRIEND = "user-friend"
const PLUGIN = "gifted-plugin"

let d1: SqliteD1

function seedPlugin(db: SqliteD1, priceCents: number | null) {
  const now = Date.now()
  db.raw
    .prepare(
      `INSERT INTO plugins (id, name, description, author, repo, category, tags, latest_version, status, downloads, created_at, updated_at, owner_user_id, price_cents)
       VALUES (?1, 'Gifted', 'desc', 'someone', 'u/r', 'tools', '[]', '1.0.0', 'approved', 0, ?2, ?2, ?3, ?4)`,
    )
    .run(PLUGIN, now, OWNER, priceCents)
  db.raw
    .prepare(
      `INSERT INTO plugin_versions (plugin_id, version, manifest, created_at, price_cents)
       VALUES (?1, '1.0.0', '{}', ?2, ?3)`,
    )
    .run(PLUGIN, now, priceCents)
}

function seedUser(db: SqliteD1, id: string, email: string) {
  db.raw
    .prepare(
      "INSERT INTO market_users (id, email, name, created_at, last_login_at) VALUES (?1, ?2, ?3, 1, 1)",
    )
    .run(id, email, id)
}

// A signed-in session for a user: returns the Cookie header value.
async function signIn(db: SqliteD1, userId: string): Promise<string> {
  const token = `test-token-${userId}`
  db.raw
    .prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, 1, ?3)",
    )
    .run(await sha256Hex(token), userId, Date.now() + 60_000)
  return `${SESSION_COOKIE}=${token}`
}

function routeContext(
  request: Request,
  id = PLUGIN,
): EventContext<Env, "id", never> & { env: { DB: D1Database } } {
  return {
    env: { DB: d1 as unknown as D1Database },
    params: { id },
    request,
    data: {},
    functionPath: "",
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    next: () => Promise.resolve(new Response(null)),
  } as never
}

async function giftHandlers(request: Request, id = PLUGIN) {
  const module = await import("../actions/api/plugins/[id]/gift")
  return {
    get: (req: Request = request) => module.onRequestGet(routeContext(req, id)),
    post: (req: Request = request) =>
      module.onRequestPost(routeContext(req, id)),
    delete: (req: Request = request) =>
      module.onRequestDelete(routeContext(req, id)),
  }
}

beforeAll(() => {
  d1 = openTestDb()
  seedPlugin(d1, 999)
  seedUser(d1, OWNER, "owner@example.com")
  seedUser(d1, BUYER, "buyer@example.com")
  seedUser(d1, FRIEND, "friend@example.com")
})

describe("gift licenses", () => {
  test("a gift satisfies hasLicense for the recipient only", async () => {
    const plugin = await getPluginRow(d1 as unknown as D1Database, PLUGIN)
    expect(plugin?.owner_user_id).toBe(OWNER)
    if (!plugin) throw new Error("seeded plugin missing")
    await createGift(d1 as unknown as D1Database, {
      plugin,
      version: "1.0.0",
      fromUserId: OWNER,
      toUserId: FRIEND,
      note: "enjoy",
    })
    expect(await hasLicense(d1 as unknown as D1Database, FRIEND, PLUGIN)).toBe(
      true,
    )
    expect(await hasLicense(d1 as unknown as D1Database, BUYER, PLUGIN)).toBe(
      false,
    )
  })

  test("owner sales exclude gifts; the recipient still sees the gift", async () => {
    const sales = await getOwnerSales(d1 as unknown as D1Database, OWNER)
    expect(sales).toHaveLength(0)
    const purchased = await getUserPurchases(
      d1 as unknown as D1Database,
      FRIEND,
    )
    expect(purchased).toHaveLength(1)
    expect(purchased[0]?.isGift).toBe(true)
    expect(purchased[0]?.giftNote).toBe("enjoy")
    expect(purchased[0]?.amountCents).toBe(0)
  })

  test("only the gifting owner can revoke, and revoking kills the license", async () => {
    const db = d1 as unknown as D1Database
    const gifts = await listPluginGifts(db, PLUGIN)
    expect(gifts).toHaveLength(1)
    expect(gifts[0]?.recipientEmail).toBe("friend@example.com")
    expect(gifts[0]?.status).toBe("paid")
    // A different user's revoke is a no-op.
    await revokeGift(db, gifts[0]?.id, BUYER)
    expect(await hasLicense(db, FRIEND, PLUGIN)).toBe(true)
    // The owner's revoke flips the row and drops the license.
    await revokeGift(db, gifts[0]?.id, OWNER)
    expect(await hasLicense(db, FRIEND, PLUGIN)).toBe(false)
    const after = await listPluginGifts(db, PLUGIN)
    expect(after[0]?.status).toBe("refunded")
  })
})

describe("gift api route", () => {
  test("anon gets 401; non-owner gets 403", async () => {
    const handlers = await giftHandlers(new Request("https://x.test"))
    expect((await handlers.get()).status).toBe(401)
    const friendCookie = await signIn(d1, FRIEND)
    const friendHandlers = await giftHandlers(
      new Request("https://x.test", { headers: { cookie: friendCookie } }),
    )
    expect((await friendHandlers.get()).status).toBe(403)
    expect(
      (
        await friendHandlers.post(
          new Request("https://x.test", {
            method: "POST",
            headers: { cookie: friendCookie },
            body: JSON.stringify({ email: "buyer@example.com" }),
          }),
        )
      ).status,
    ).toBe(403)
  })

  test("owner gifts by email: happy path, unknown user, already-owned, self-gift", async () => {
    const cookie = await signIn(d1, OWNER)
    const handlers = await giftHandlers(
      new Request("https://x.test", { headers: { cookie } }),
    )
    const listing = await handlers.get()
    expect(listing.status).toBe(200)
    // Unknown email → 404 with guidance.
    const unknown = await handlers.post(
      new Request("https://x.test", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ email: "ghost@example.com" }),
      }),
    )
    expect(unknown.status).toBe(404)
    // Happy path (case-insensitive email match).
    const sent = await handlers.post(
      new Request("https://x.test", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ email: "BUYER@example.com", note: "hi" }),
      }),
    )
    expect(sent.status).toBe(200)
    const sentBody = (await sent.json()) as { recipient?: { id?: string } }
    expect(sentBody.recipient?.id).toBe(BUYER)
    expect(await hasLicense(d1 as unknown as D1Database, BUYER, PLUGIN)).toBe(
      true,
    )
    // Already licensed → alreadyOwned, no second row.
    const again = await handlers.post(
      new Request("https://x.test", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ email: "buyer@example.com" }),
      }),
    )
    expect(
      ((await again.json()) as { alreadyOwned?: boolean }).alreadyOwned,
    ).toBe(true)
    // Self-gift refused.
    const self = await handlers.post(
      new Request("https://x.test", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ email: "owner@example.com" }),
      }),
    )
    expect(self.status).toBe(400)
    // Revoke over the route removes the license.
    const gifts = await listPluginGifts(d1 as unknown as D1Database, PLUGIN)
    const target = gifts.find(
      (gift) => gift.recipientEmail === "buyer@example.com",
    )
    expect(target).toBeDefined()
    const removed = await handlers.delete(
      new Request(`https://x.test?giftId=${encodeURIComponent(target?.id)}`, {
        method: "DELETE",
        headers: { cookie },
      }),
    )
    expect(removed.status).toBe(200)
    expect(await hasLicense(d1 as unknown as D1Database, BUYER, PLUGIN)).toBe(
      false,
    )
  })

  test("free plugins refuse gifting", async () => {
    const sqlite = new Database(":memory:")
    const dir = join(import.meta.dir, "../../migrations")
    for (const file of readdirSync(dir).sort()) {
      if (file.endsWith(".sql")) {
        sqlite.exec(readFileSync(join(dir, file), "utf8"))
      }
    }
    const freeDb = new SqliteD1(sqlite)
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO plugins (id, name, description, author, repo, category, tags, latest_version, status, downloads, created_at, updated_at, owner_user_id, price_cents)
         VALUES ('free-plugin', 'Free', 'd', 'a', 'u/r', 'tools', '[]', '1.0.0', 'approved', 0, ?, ?, 'user-owner', NULL)`,
      )
      .run(now, now)
    seedUser(freeDb, OWNER, "owner@example.com")
    const cookie = await signIn(freeDb, OWNER)
    const savedD1 = d1
    d1 = freeDb
    try {
      const handlers = await giftHandlers(
        new Request("https://x.test", { headers: { cookie } }),
        "free-plugin",
      )
      const refused = await handlers.post(
        new Request("https://x.test", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({ email: "owner@example.com" }),
        }),
      )
      expect(refused.status).toBe(400)
      expect(((await refused.json()) as { error?: string }).error).toContain(
        "free",
      )
    } finally {
      d1 = savedD1
    }
  })
})
