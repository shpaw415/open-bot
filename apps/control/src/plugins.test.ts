import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { User } from "@open-bot/db"
import { type Db, openDatabase } from "@open-bot/db"
import { ensureGuardCron, handlePlugins } from "./plugins"

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
      manifest: { ...manifest, version: "nope" },
    })
    const badRes = await handlePlugins(bad.req, bad.url, db, user(), hub)
    expect(badRes?.status).toBe(400)
    const body = (await badRes?.json()) as { issues: unknown[] }
    expect(body.issues.length).toBeGreaterThan(0)
  })

  test("defaults to manual policy and gates changes to admins", async () => {
    const initial = route("/api/plugins/policy")
    const res = await handlePlugins(initial.req, initial.url, db, user(), hub)
    expect(await res?.json()).toEqual({ policy: "manual" })

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
    expect(await allowedRes?.json()).toEqual({ policy: "auto" })
    const after = route("/api/plugins/policy")
    const afterRes = await handlePlugins(after.req, after.url, db, user(), hub)
    expect(await afterRes?.json()).toEqual({ policy: "auto" })
  })

  test("lists installed plugins", async () => {
    const listed = route("/api/plugins/installed")
    const res = await handlePlugins(listed.req, listed.url, db, user(), hub)
    expect(await res?.json()).toMatchObject({ plugins: [], policy: "manual" })
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
})
