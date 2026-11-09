import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, type User } from "@open-bot/db"
import {
  fileImprovement,
  handleImprovementPost,
  type ImprovementIssueDeps,
  improvementFingerprint,
  type MarketplaceIssuePayload,
  NEW_ROW_LIMIT,
  parseImprovementInput,
  stripSecrets,
} from "./improvements"

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

function db() {
  const opened = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
  )
  opened.createUser(user())
  return opened
}

describe("improvement reports", () => {
  test("strips tokens and keys", () => {
    expect(stripSecrets("Authorization: Bearer abc.def")).toBe(
      "Authorization: Bearer [redacted]",
    )
    expect(stripSecrets("key sk-12345678 failed")).toBe("key [redacted] failed")
    expect(stripSecrets("password=hunter2")).toBe("password=[redacted]")
  })

  test("fingerprint ignores title case and spacing", () => {
    expect(improvementFingerprint("bug", "nav", "Ob-nav  failed")).toBe(
      improvementFingerprint("bug", "nav", "ob-nav failed"),
    )
  })

  test("fingerprint canonicalizes paraphrased reports of one defect family", () => {
    // Real agent-filed titles for the ob-skill save hang (38 GitHub issues
    // from one root cause): wording, language, kind, and surface all vary.
    const hangTitles = [
      "ob-skill save hangs after durable write",
      "ob-skill save persists then hangs",
      "ob-skill save times out after successful persistence",
      "ob-skill save reste bloqué après sauvegarde OpenViking réussie",
      "OpenViking skill save times out despite successful persistence",
      "ob-skill save hangs without acknowledgement",
      "ob-skill save reports OpenViking timeout after successful persistence",
    ]
    const hangPrints = new Set(
      hangTitles.map((title, i) =>
        improvementFingerprint(
          i % 2 ? "friction" : "bug",
          i % 2 ? "other" : "config",
          title,
        ),
      ),
    )
    expect(hangPrints.size).toBe(1)
    const lossA = improvementFingerprint(
      "bug",
      "config",
      "ob-skill replacement loses existing skill when upstream returns 429",
    )
    const lossB = improvementFingerprint(
      "bug",
      "config",
      "ob-skill replace failing HTTP429 removes the previously installed skill",
    )
    expect(lossA).toBe(lossB)
    // The French quota/restore wording of the same replace failure (#97).
    expect(
      improvementFingerprint(
        "bug",
        "config",
        "ob-skill save replace et restauration échouent lors des quotas OpenViking",
      ),
    ).toBe(lossA)
    expect(lossA).not.toBe([...hangPrints][0])
    // Distinct families stay distinct.
    const typeA = improvementFingerprint(
      "bug",
      "desktop",
      "ob-page type updates React input DOM but not controlled state",
    )
    const typeB = improvementFingerprint(
      "bug",
      "nav",
      "ob-page type changes a React controlled input visually without updating its state",
    )
    expect(typeA).toBe(typeB)
    const memA = improvementFingerprint(
      "friction",
      "other",
      "Memory search returns unrelated high-confidence results",
    )
    const memB = improvementFingerprint(
      "friction",
      "chat",
      "Memory retrieval ranks unrelated entities highly for exact technical identifiers",
    )
    expect(memA).toBe(memB)
    expect(new Set([[...hangPrints][0], lossA, typeA, memA]).size).toBe(4)
    // Plugin scoping still separates canonical families.
    expect(
      improvementFingerprint("bug", "config", hangTitles[0], "weather-pro"),
    ).not.toBe([...hangPrints][0])
  })

  test("fingerprint keeps the legacy hash without a plugin and separates plugins", () => {
    const legacy = improvementFingerprint("bug", "nav", "ob-nav failed")
    expect(improvementFingerprint("bug", "nav", "ob-nav failed", null)).toBe(
      legacy,
    )
    const plugin = improvementFingerprint(
      "bug",
      "nav",
      "ob-nav failed",
      "weather-pro",
    )
    expect(plugin).not.toBe(legacy)
    expect(
      improvementFingerprint("bug", "nav", "ob-nav failed", "other-plugin"),
    ).not.toBe(plugin)
  })

  test("rejects a bad kind", () => {
    const parsed = parseImprovementInput({
      kind: "idea",
      surface: "nav",
      title: "broken",
      detail: "it failed",
    })
    expect(parsed).toEqual({ error: "kind must be bug, friction, or feature" })
  })

  test("parses an optional plugin slug and rejects bad slugs", () => {
    const withPlugin = parseImprovementInput({
      kind: "bug",
      surface: "other",
      title: "weather widget stale",
      detail: "it never refreshes",
      plugin: "weather-pro",
    })
    expect(withPlugin).toMatchObject({ plugin: "weather-pro" })
    const without = parseImprovementInput({
      kind: "bug",
      surface: "nav",
      title: "broken",
      detail: "it failed",
    })
    expect(without).toMatchObject({ plugin: null })
    const bad = parseImprovementInput({
      kind: "bug",
      surface: "nav",
      title: "broken",
      detail: "it failed",
      plugin: "Weather Pro!",
    })
    expect(bad).toEqual({
      error: "plugin must be a plugin slug (lowercase letters, digits, -)",
    })
  })

  test("bumps an open duplicate and caps new rows", () => {
    const opened = db()
    const first = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "ob-nav failed",
        detail: "short",
        sessionId: null,
        plugin: null,
      },
      1_000,
    )
    expect(first).toEqual({
      id: expect.any(String),
      duplicate: false,
      hits: 1,
    })
    const again = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "OB-nav   failed",
        detail: "a longer reproduction",
        sessionId: "ses_1",
        plugin: null,
      },
      2_000,
    )
    expect(again).toMatchObject({ duplicate: true, hits: 2 })
    if (!("id" in again)) throw new Error("expected a row")
    expect(opened.improvementById(again.id)?.detail).toBe(
      "a longer reproduction",
    )
    expect(opened.listImprovements("open")).toHaveLength(1)

    const done = opened.setImprovementStatus(again.id, "done", "fixed")
    expect(done?.status).toBe("done")
    const regression = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "ob-nav failed",
        detail: "came back",
        sessionId: null,
        plugin: null,
      },
      3_000,
    )
    expect(regression).toMatchObject({ duplicate: false, hits: 1 })
    expect(opened.listImprovements("open")).toHaveLength(1)

    for (let i = 0; i < NEW_ROW_LIMIT; i++) {
      fileImprovement(
        opened,
        user(),
        {
          kind: "feature",
          surface: "chat",
          title: `missing ${i}`,
          detail: "needed during work",
          sessionId: null,
          plugin: null,
        },
        4_000 + i,
      )
    }
    const limited = fileImprovement(
      opened,
      user(),
      {
        kind: "feature",
        surface: "chat",
        title: "one more",
        detail: "needed during work",
        sessionId: null,
        plugin: null,
      },
      5_000,
    )
    expect(limited).toEqual({
      error: "too many new reports this hour",
      status: 429,
    })
  })

  test("same title for open-bot and for a plugin are separate reports", () => {
    const opened = db()
    const core = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "other",
        title: "widget stale",
        detail: "core copy",
        sessionId: null,
        plugin: null,
      },
      1_000,
    )
    const plugin = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "other",
        title: "widget stale",
        detail: "plugin copy",
        sessionId: null,
        plugin: "weather-pro",
      },
      2_000,
    )
    expect(core).toMatchObject({ duplicate: false })
    expect(plugin).toMatchObject({ duplicate: false })
    if (!("id" in plugin)) throw new Error("expected a row")
    expect(opened.improvementById(plugin.id)?.plugin).toBe("weather-pro")
    expect(opened.listImprovements("open")).toHaveLength(2)
  })

  test("delete user removes their reports", () => {
    const opened = db()
    fileImprovement(
      opened,
      user(),
      {
        kind: "friction",
        surface: "config",
        title: "model picker resets",
        detail: "saving the model clears the field",
        sessionId: null,
        plugin: null,
      },
      1,
    )
    opened.deleteUser("a")
    expect(opened.listImprovements()).toHaveLength(0)
  })
})

function fakeDeps(overrides: Partial<ImprovementIssueDeps> = {}) {
  const calls = {
    market: [] as MarketplaceIssuePayload[],
    issues: [] as { repo: string; title: string; body: string }[],
  }
  const deps: ImprovementIssueDeps = {
    openBotRepo: "shpaw415/open-bot",
    githubConfigured: true,
    allowExternal: () => true,
    postMarketplaceIssue: async (_db, payload) => {
      calls.market.push(payload)
      const repo = payload.pluginId
        ? "shpaw415/open-bot-plugin-weather-pro"
        : "shpaw415/open-bot"
      return {
        id: `mi-${calls.market.length}`,
        repo,
        githubUrl: `https://github.com/${repo}/issues/${calls.market.length}`,
        githubNumber: calls.market.length,
        url: `https://market.example/api/issues/mi-${calls.market.length}`,
      }
    },
    createIssue: async (repo, title, body) => {
      calls.issues.push({ repo, title, body })
      return {
        url: `https://github.com/${repo}/issues/${calls.issues.length + 40}`,
        number: calls.issues.length + 40,
      }
    },
    resolvePluginRepo: async (_db, _userId, pluginId) =>
      pluginId === "weather-pro" ? "shpaw415/open-bot-plugin-weather-pro" : "",
    ...overrides,
  }
  return { deps, calls }
}

function marketplaceDown() {
  return {
    postMarketplaceIssue: async () => {
      throw new Error(
        "the plugin marketplace is not configured on this instance",
      )
    },
  } satisfies Partial<ImprovementIssueDeps>
}

function post(body: Record<string, unknown>) {
  return new Request("http://control/api/improvements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const BASE = {
  kind: "bug",
  surface: "nav",
  title: "ob-nav exits blocked with no url",
  detail: "Expected a url. Actual: blocked.",
}

describe("improvement issue routing", () => {
  test("open-bot report relays through the marketplace to the open-bot repo", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps()
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown> & { id: string }
    expect(body).toMatchObject({
      duplicate: false,
      plugin: null,
      issue: {
        via: "github",
        repo: "shpaw415/open-bot",
        url: "https://github.com/shpaw415/open-bot/issues/1",
        number: 1,
      },
    })
    expect(calls.market).toHaveLength(1)
    expect(calls.market[0]).toMatchObject({
      pluginId: null,
      kind: "bug",
      title: BASE.title,
      reportId: body.id,
    })
    expect(calls.market[0]?.fingerprint).toBeTruthy()
    // The marketplace pushed it; no direct GitHub call from this instance.
    expect(calls.issues).toHaveLength(0)
    const row = opened.listImprovements("open")[0]
    expect(row?.routedTo).toBe("github")
    expect(row?.issueUrl).toBe("https://github.com/shpaw415/open-bot/issues/1")
    expect(row?.externalId).toBe("1")
  })

  test("plugin report relays through the marketplace to the plugin repo", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps()
    const res = await handleImprovementPost(
      post({ ...BASE, surface: "other", plugin: "weather-pro" }),
      opened,
      user(),
      deps,
    )
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      plugin: "weather-pro",
      issue: {
        via: "github",
        repo: "shpaw415/open-bot-plugin-weather-pro",
      },
    })
    expect(calls.market[0]?.pluginId).toBe("weather-pro")
    expect(calls.issues).toHaveLength(0)
  })

  test("a marketplace issue not yet pushed counts as routed via marketplace", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps({
      postMarketplaceIssue: async (_db, payload) => {
        calls.market.push(payload)
        return {
          id: "mi-9",
          repo: "shpaw415/open-bot",
          githubUrl: null,
          githubNumber: null,
          url: "https://market.example/api/issues/mi-9",
        }
      },
    })
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      issue: {
        via: "marketplace",
        url: "https://market.example/api/issues/mi-9",
        id: "mi-9",
      },
    })
    // The marketplace owns the push retry: no direct double-filing.
    expect(calls.issues).toHaveLength(0)
    const row = opened.listImprovements("open")[0]
    expect(row?.routedTo).toBe("marketplace")
    expect(row?.externalId).toBe("mi-9")
  })

  test("a duplicate reuses the stored issue and relays nothing new", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps()
    await handleImprovementPost(post(BASE), opened, user(), deps)
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      duplicate: true,
      hits: 2,
      issue: {
        via: "github",
        url: "https://github.com/shpaw415/open-bot/issues/1",
        number: 1,
      },
    })
    expect(calls.market).toHaveLength(1)
    expect(calls.issues).toHaveLength(0)
  })

  test("marketplace down falls back to a direct GitHub issue", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps(marketplaceDown())
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      issue: {
        via: "github",
        repo: "shpaw415/open-bot",
        url: "https://github.com/shpaw415/open-bot/issues/41",
        number: 41,
      },
    })
    expect(calls.issues).toHaveLength(1)
    expect(calls.issues[0]?.body).toContain("Expected a url")
  })

  test("plugin unlisted on the marketplace falls back to its installed repo", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps({
      postMarketplaceIssue: async () => {
        throw new Error("plugin not found")
      },
    })
    const res = await handleImprovementPost(
      post({ ...BASE, surface: "other", plugin: "weather-pro" }),
      opened,
      user(),
      deps,
    )
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      issue: { via: "github", repo: "shpaw415/open-bot-plugin-weather-pro" },
    })
    expect(calls.issues[0]?.repo).toBe("shpaw415/open-bot-plugin-weather-pro")
  })

  test("marketplace and GitHub both down files locally with a warning naming both", async () => {
    const opened = db()
    const { deps } = fakeDeps({
      ...marketplaceDown(),
      createIssue: async () => {
        throw new Error("github exploded")
      },
    })
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id?: string
      issue?: unknown
      warning?: string
    }
    expect(body.id).toBeTruthy()
    expect(body.issue).toBeUndefined()
    expect(body.warning).toContain("marketplace is not configured")
    expect(body.warning).toContain("github exploded")
    const row = opened.listImprovements("open")[0]
    expect(row?.routedTo).toBeNull()
    expect(row?.issueUrl).toBeNull()
  })

  test("no marketplace and no GitHub token files locally with a warning", async () => {
    const opened = db()
    const { deps } = fakeDeps({
      ...marketplaceDown(),
      githubConfigured: false,
    })
    const res = await handleImprovementPost(
      post({ ...BASE, surface: "other", plugin: "unlisted-plugin" }),
      opened,
      user(),
      deps,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toContain("GitHub is not configured")
    expect(opened.listImprovements("open")).toHaveLength(1)
  })

  test("external rate limit files locally and calls nothing", async () => {
    const opened = db()
    const { deps, calls } = fakeDeps({ allowExternal: () => false })
    const res = await handleImprovementPost(post(BASE), opened, user(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toContain("rate limit")
    expect(calls.market).toHaveLength(0)
    expect(calls.issues).toHaveLength(0)
    expect(opened.listImprovements("open")).toHaveLength(1)
  })
})
