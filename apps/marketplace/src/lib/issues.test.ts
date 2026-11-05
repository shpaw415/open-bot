import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  onRequestPost as createRoute,
  onRequestGet as listRoute,
} from "../actions/api/issues"
import {
  fileMarketplaceIssue,
  listIssues,
  pushIssueToGithub,
  setIssueStatus,
  validateIssueInput,
} from "./issues"

// Minimal D1 adapter over bun:sqlite (same pattern as gifts.test.ts), with
// every migration applied for a real schema.
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

const PLUGIN = "weather-pro"
const PLUGIN_REPO = "shpaw415/open-bot-plugin-weather-pro"
const ENV = { githubToken: "gh-test", openBotRepo: "shpaw415/open-bot" }

function seedPlugin(db: SqliteD1) {
  const now = Date.now()
  db.raw
    .prepare(
      `INSERT INTO plugins (id, name, description, author, repo, category, tags, latest_version, status, downloads, created_at, updated_at)
       VALUES (?1, 'Weather Pro', 'desc', 'someone', ?2, 'tools', '[]', '1.0.0', 'approved', 0, ?3, ?3)`,
    )
    .run(PLUGIN, PLUGIN_REPO, now)
}

function fakeFetch(fail?: string) {
  const calls: { url: string; body: { title?: string; body?: string } }[] = []
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      title?: string
      body?: string
    }
    calls.push({ url: String(url), body })
    if (fail) {
      return Response.json({ message: fail }, { status: 422 })
    }
    const repo = String(url)
      .replace("https://api.github.com/repos/", "")
      .replace("/issues", "")
    return Response.json(
      {
        html_url: `https://github.com/${repo}/issues/${calls.length}`,
        number: calls.length,
      },
      { status: 201 },
    )
  }) as typeof fetch
  return { fetchFn, calls }
}

const BASE = {
  kind: "bug",
  surface: "nav",
  title: "ob-nav exits blocked with no url",
  detail: "Expected a url. Actual: blocked.",
}

describe("marketplace issue validation", () => {
  test("accepts a minimal open-bot report and a plugin report", () => {
    expect(validateIssueInput(BASE)).toMatchObject({
      input: { pluginId: null, kind: "bug" },
    })
    expect(validateIssueInput({ ...BASE, pluginId: PLUGIN })).toMatchObject({
      input: { pluginId: PLUGIN },
    })
    // `body` is accepted as the detail alias (comments API vocabulary).
    expect(
      validateIssueInput({ kind: "bug", title: "t", body: "from body" }),
    ).toMatchObject({ input: { detail: "from body" } })
  })

  test("rejects bad kind, slug, and oversize fields", () => {
    expect(validateIssueInput({ ...BASE, kind: "idea" })).toEqual({
      error: "kind must be bug, friction, or feature",
    })
    expect(validateIssueInput({ ...BASE, pluginId: "Weather Pro!" })).toEqual({
      error: "pluginId must be a plugin slug (lowercase letters, digits, -)",
    })
    expect(validateIssueInput({ ...BASE, title: "x".repeat(121) })).toEqual({
      error: "title must be 1–120 characters",
    })
  })
})

describe("marketplace issue filing", () => {
  test("open-bot report pushes to the open-bot repo and stores the issue", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const filed = await fileMarketplaceIssue(db, ENV, BASE, fetchFn)
    expect(filed).toMatchObject({
      duplicate: false,
      issue: {
        pluginId: null,
        repo: "shpaw415/open-bot",
        status: "open",
        githubUrl: "https://github.com/shpaw415/open-bot/issues/1",
        githubNumber: 1,
        pushError: null,
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/shpaw415/open-bot/issues",
    )
    expect(calls[0]?.body.title).toBe(BASE.title)
    expect(calls[0]?.body.body).toContain("Expected a url")
    if (!("issue" in filed)) throw new Error("expected an issue")
    expect(calls[0]?.body.body).toContain(filed.issue.id)
  })

  test("plugin report pushes to the listing's repo", async () => {
    const d1 = openTestDb()
    seedPlugin(d1)
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const filed = await fileMarketplaceIssue(
      db,
      ENV,
      { ...BASE, surface: "other", pluginId: PLUGIN },
      fetchFn,
    )
    expect(filed).toMatchObject({
      issue: { pluginId: PLUGIN, repo: PLUGIN_REPO },
    })
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/${PLUGIN_REPO}/issues`,
    )
  })

  test("unknown plugin is a 404 and files nothing", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const filed = await fileMarketplaceIssue(
      db,
      ENV,
      { ...BASE, pluginId: "not-listed" },
      fetchFn,
    )
    expect(filed).toEqual({ error: "plugin not found", status: 404 })
    expect(calls).toHaveLength(0)
    expect(await listIssues(db, {})).toHaveLength(0)
  })

  test("same fingerprint dedupes across filers into one GitHub issue", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const first = await fileMarketplaceIssue(
      db,
      ENV,
      { ...BASE, fingerprint: "fp-1", reportId: "local-1" },
      fetchFn,
    )
    const second = await fileMarketplaceIssue(
      db,
      ENV,
      {
        ...BASE,
        fingerprint: "fp-1",
        reportId: "local-2",
        detail:
          "Expected a url. Actual: blocked. Longer repro from another instance.",
      },
      fetchFn,
    )
    expect(first).toMatchObject({ duplicate: false })
    expect(second).toMatchObject({
      duplicate: true,
      issue: {
        hits: 2,
        githubUrl: "https://github.com/shpaw415/open-bot/issues/1",
        detail:
          "Expected a url. Actual: blocked. Longer repro from another instance.",
      },
    })
    expect(calls).toHaveLength(1)
    expect(await listIssues(db, {})).toHaveLength(1)
  })

  test("a failed push is recorded and a retry clears it", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const failing = fakeFetch("Validation Failed: title is too long")
    const filed = await fileMarketplaceIssue(db, ENV, BASE, failing.fetchFn)
    if (!("issue" in filed)) throw new Error("expected an issue")
    expect(filed.issue.githubUrl).toBeNull()
    expect(filed.issue.pushError).toContain("Validation Failed")
    const ok = fakeFetch()
    const retried = await pushIssueToGithub(db, ENV, filed.issue.id, ok.fetchFn)
    expect(retried).toMatchObject({
      issue: {
        githubUrl: "https://github.com/shpaw415/open-bot/issues/1",
        pushError: null,
      },
    })
    // A second retry on a pushed issue is a no-op.
    const again = await pushIssueToGithub(db, ENV, filed.issue.id, ok.fetchFn)
    expect(again).toMatchObject({ alreadyPushed: true })
    expect(ok.calls).toHaveLength(1)
  })

  test("no GitHub token files the issue un-pushed", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const filed = await fileMarketplaceIssue(
      db,
      { openBotRepo: "shpaw415/open-bot" },
      BASE,
      fetchFn,
    )
    if (!("issue" in filed)) throw new Error("expected an issue")
    expect(filed.issue.githubUrl).toBeNull()
    expect(filed.issue.pushError).toContain("not configured")
    expect(calls).toHaveLength(0)
  })

  test("refiling a done issue opens a fresh one", async () => {
    const d1 = openTestDb()
    const db = d1 as unknown as D1Database
    const { fetchFn, calls } = fakeFetch()
    const first = await fileMarketplaceIssue(
      db,
      ENV,
      { ...BASE, fingerprint: "fp-9" },
      fetchFn,
    )
    if (!("issue" in first)) throw new Error("expected an issue")
    const done = await setIssueStatus(
      db,
      first.issue.id,
      "done",
      "fixed in 1.2",
    )
    expect(done).toMatchObject({ status: "done", note: "fixed in 1.2" })
    expect(done?.resolvedAt).toBeGreaterThan(0)
    const refiled = await fileMarketplaceIssue(
      db,
      ENV,
      { ...BASE, fingerprint: "fp-9" },
      fetchFn,
    )
    expect(refiled).toMatchObject({ duplicate: false })
    if (!("issue" in refiled)) throw new Error("expected an issue")
    expect(refiled.issue.id).not.toBe(first.issue.id)
    expect(calls).toHaveLength(2)
    expect(await listIssues(db, { status: "open" })).toHaveLength(1)
    expect(await listIssues(db, { status: "all" })).toHaveLength(2)
  })
})

describe("marketplace issue routes", () => {
  function context(
    d1: SqliteD1,
    request: Request,
    params: Record<string, string> = {},
  ) {
    return {
      env: {
        DB: d1 as unknown as D1Database,
        MARKETPLACE_TOKEN: "instance-token",
        ADMIN_TOKEN: "admin-token",
        GITHUB_TOKEN: "gh-test",
        OPEN_BOT_REPO: "shpaw415/open-bot",
      },
      request,
      params,
    } as never
  }

  test("create needs write auth; list needs the admin token", async () => {
    const d1 = openTestDb()
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json(
        {
          html_url: "https://github.com/shpaw415/open-bot/issues/3",
          number: 3,
        },
        { status: 201 },
      )) as typeof fetch
    try {
      const payload = JSON.stringify(BASE)
      const anon = await createRoute(
        context(
          d1,
          new Request("http://m/api/issues", { method: "POST", body: payload }),
        ),
      )
      expect(anon.status).toBe(401)
      const created = await createRoute(
        context(
          d1,
          new Request("http://m/api/issues", {
            method: "POST",
            headers: { authorization: "Bearer instance-token" },
            body: payload,
          }),
        ),
      )
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as {
        issue: { githubUrl: string }
        duplicate: boolean
      }
      expect(createdBody.duplicate).toBe(false)
      expect(createdBody.issue.githubUrl).toBe(
        "https://github.com/shpaw415/open-bot/issues/3",
      )

      const listAnon = await listRoute(
        context(d1, new Request("http://m/api/issues?status=open")),
      )
      expect(listAnon.status).toBe(401)
      const list = await listRoute(
        context(
          d1,
          new Request("http://m/api/issues?status=open", {
            headers: { authorization: "Bearer admin-token" },
          }),
        ),
      )
      expect(list.status).toBe(200)
      const listed = (await list.json()) as { issues: unknown[] }
      expect(listed.issues).toHaveLength(1)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
