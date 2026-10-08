import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CronJob, openDatabase, type User } from "./index"

function user(
  partial: Partial<User> & Pick<User, "id" | "email" | "role">,
): User {
  return {
    passwordHash: "hash",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
    ...partial,
  }
}

describe("drizzle migrations", () => {
  test("opens a pre-drizzle database without recreating tables", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite")
    const sqlite = new Database(path)
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE invites (
        code TEXT PRIMARY KEY,
        email TEXT,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE desktops (
        user_id TEXT PRIMARY KEY,
        llm_token TEXT NOT NULL,
        opencode_password TEXT NOT NULL,
        viking_key TEXT NOT NULL,
        selected_provider TEXT,
        selected_model TEXT,
        last_active_at INTEGER NOT NULL
      );
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE viking_provider (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        embed_model TEXT NOT NULL,
        embed_dimension INTEGER NOT NULL,
        vlm_model TEXT NOT NULL
      );
      CREATE TABLE cron_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        kind TEXT NOT NULL,
        cron_expr TEXT,
        every_seconds INTEGER,
        at_ms INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        delete_after_run INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `)
    sqlite
      .query(
        "INSERT INTO users (id, email, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("a", "a@localhost", "hash", "admin", 1, 0)
    sqlite.close()
    const db = openDatabase(path)
    expect(db.userById("a")?.disabled).toBe(false)
    db.ensureDesktop({
      userId: "a",
      llmToken: "tok",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    db.setUserVikingProvider("a", {
      baseURL: "https://own.test/v1",
      apiKey: "k",
      embedModel: "embed",
      embedDimension: 8,
      vlmModel: "vlm",
    })
    expect(db.getVikingProvider("a")?.baseURL).toBe("https://own.test/v1")
    db.setImageProvider("a", {
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      apiKey: "secret",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    })
    expect(db.getImageProvider("a")?.accountId).toBe("acct")
  })

  test("creates tables missing from older databases", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite")
    const sqlite = new Database(path)
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        disabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE invites (
        code TEXT PRIMARY KEY,
        email TEXT,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE desktops (
        user_id TEXT PRIMARY KEY,
        llm_token TEXT NOT NULL,
        opencode_password TEXT NOT NULL,
        viking_key TEXT NOT NULL,
        selected_provider TEXT,
        selected_model TEXT,
        last_active_at INTEGER NOT NULL
      );
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE viking_provider (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        embed_model TEXT NOT NULL,
        embed_dimension INTEGER NOT NULL,
        vlm_model TEXT NOT NULL
      );
    `)
    sqlite.close()
    const db = openDatabase(path)
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createCronJob({
      id: "j1",
      userId: "a",
      name: "job",
      message: "do it",
      kind: "every",
      cronExpr: null,
      everySeconds: 60,
      atMs: null,
      enabled: true,
      deleteAfterRun: false,
      sessionId: null,
      createdAt: 1,
      lastRunAt: null,
      nextRunAt: 2,
      runCount: 0,
      lastError: null,
      providerId: "grok",
      modelId: "grok-4.5",
      personaId: "designer",
      runKind: "prompt",
      script: null,
    })
    expect(db.cronJobs("a")).toHaveLength(1)
    expect(db.cronJobById("j1", "a")?.modelId).toBe("grok-4.5")
    openDatabase(path)
  })
})

describe("usage ledger", () => {
  test("aggregates tokens by user, kind, and utc day", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "admin" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000
    db.recordUsage({
      userId: "a",
      createdAt: day + 1000,
      kind: "chat",
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    })
    db.recordUsage({
      userId: "a",
      createdAt: day + 2000,
      kind: "embed",
      promptTokens: 3,
      completionTokens: 0,
      totalTokens: 3,
    })
    db.recordUsage({
      userId: "b",
      createdAt: day - 86_400_000,
      kind: "small",
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    })
    const rows = db.usageGrouped(day)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.kind === "chat")?.totalTokens).toBe(14)
    expect(db.usageGrouped(day, "b")).toHaveLength(0)
    db.deleteUser("a")
    expect(db.userById("a")).toBeNull()
    expect(db.usageGrouped(0).every((row) => row.userId !== "a")).toBe(true)
  })

  test("migrates disabled and blocks invite revoke after use", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "admin" }))
    expect(db.listUsers()[0]?.disabled).toBe(false)
    db.setDisabled("a", true)
    expect(db.enabledAdminCount()).toBe(0)
    db.setRole("a", "user")
    db.forcePasswordReset("a")
    const next = db.userById("a")
    expect(next?.role).toBe("user")
    expect(next?.mustChangePassword).toBe(true)
    expect(next?.disabled).toBe(true)
    db.createInvite("code", null)
    expect(db.revokeInvite("code")).toBe(true)
    db.createInvite("used", null)
    expect(db.takeInvite("used")?.code).toBe("used")
    expect(db.revokeInvite("used")).toBe(false)
  })

  test("stores the OpenViking model provider", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(db.getVikingProvider()).toBeNull()
    db.setVikingProvider({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      embedModel: "embed-up",
      embedDimension: 1024,
      vlmModel: "vlm-up",
    })
    expect(db.getVikingProvider()).toEqual({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      embedModel: "embed-up",
      embedDimension: 1024,
      vlmModel: "vlm-up",
    })
  })

  test("per-user OpenViking provider overrides the admin default", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    db.ensureDesktop({
      userId: "b",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    db.setVikingProvider({
      baseURL: "https://default.test/v1",
      apiKey: "default-key",
      embedModel: "embed-default",
      embedDimension: 1536,
      vlmModel: "vlm-default",
    })
    expect(db.getVikingProvider("a")).toEqual({
      baseURL: "https://default.test/v1",
      apiKey: "default-key",
      embedModel: "embed-default",
      embedDimension: 1536,
      vlmModel: "vlm-default",
    })
    db.setUserVikingProvider("a", {
      baseURL: "https://own.test/v1",
      apiKey: "own-key",
      embedModel: "embed-own",
      embedDimension: 768,
      vlmModel: "vlm-own",
    })
    expect(db.getVikingProvider("a")).toEqual({
      baseURL: "https://own.test/v1",
      apiKey: "own-key",
      embedModel: "embed-own",
      embedDimension: 768,
      vlmModel: "vlm-own",
    })
    expect(db.getVikingProvider("b")?.baseURL).toBe("https://default.test/v1")
  })

  test("stores a per-desktop image provider and clears it", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    expect(db.getImageProvider("a")).toBeNull()
    db.setImageProvider("a", {
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      apiKey: "secret",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    })
    expect(db.getImageProvider("a")).toEqual({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      apiKey: "secret",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    })
    db.clearImageProvider("a")
    expect(db.getImageProvider("a")).toBeNull()
  })

  test("stores a per-desktop video provider and clears it", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    expect(db.getVideoProvider("a")).toBeNull()
    db.setVideoProvider("a", {
      provider: "openai",
      accountId: "",
      apiKey: "secret",
      model: "sora-2",
    })
    expect(db.getVideoProvider("a")).toEqual({
      provider: "openai",
      accountId: "",
      apiKey: "secret",
      model: "sora-2",
    })
    db.clearVideoProvider("a")
    expect(db.getVideoProvider("a")).toBeNull()
  })

  test("stores a per-desktop 3d model provider and clears it", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    expect(db.getModel3dProvider("a")).toBeNull()
    db.setModel3dProvider("a", {
      provider: "meshy",
      accountId: "",
      apiKey: "secret",
      model: "meshy-5",
    })
    expect(db.getModel3dProvider("a")).toEqual({
      provider: "meshy",
      accountId: "",
      apiKey: "secret",
      model: "meshy-5",
    })
    db.clearModel3dProvider("a")
    expect(db.getModel3dProvider("a")).toBeNull()
  })

  test("stores a per-desktop system1 provider and clears it", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    expect(db.getSystem1("a")).toBeNull()
    db.setSystem1("a", {
      provider: "laya",
      endpoint: "http://laya.example:8000/v1/systemone",
      apiKey: "",
      gatewayToken: "",
      model: "",
      accountId: "",
      gatewayId: "",
      slug: "",
    })
    expect(db.getSystem1("a")?.endpoint).toBe(
      "http://laya.example:8000/v1/systemone",
    )
    db.clearSystem1("a")
    expect(db.getSystem1("a")).toBeNull()
  })
})

describe("cron store", () => {
  function cron(
    partial: Partial<CronJob> & Pick<CronJob, "id" | "userId">,
  ): CronJob {
    return {
      name: "job",
      message: "do it",
      kind: "every",
      cronExpr: null,
      everySeconds: 3600,
      atMs: null,
      enabled: true,
      deleteAfterRun: false,
      sessionId: null,
      createdAt: 1000,
      lastRunAt: null,
      nextRunAt: 2000,
      runCount: 0,
      lastError: null,
      providerId: null,
      modelId: null,
      personaId: null,
      runKind: "prompt",
      script: null,
      ...partial,
    }
  }

  test("creates, lists, updates, and deletes jobs per user", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.createCronJob(cron({ id: "j1", userId: "a" }))
    db.createCronJob(
      cron({
        id: "j2",
        userId: "a",
        name: "daily",
        kind: "cron",
        cronExpr: "0 9 * * *",
        everySeconds: null,
      }),
    )
    expect(db.cronJobs("a")).toHaveLength(2)
    expect(db.cronJobs("b")).toHaveLength(0)
    expect(db.cronJobById("j1", "b")).toBeNull()
    const one = db.cronJobById("j1", "a")
    expect(one?.kind).toBe("every")
    expect(one?.everySeconds).toBe(3600)

    const disabled = db.updateCronJob("j1", "a", { enabled: false })
    expect(disabled?.enabled).toBe(false)
    const renamed = db.updateCronJob("j1", "a", { name: "renamed" })
    expect(renamed?.name).toBe("renamed")
    expect(renamed?.enabled).toBe(false)
    const assigned = db.updateCronJob("j1", "a", {
      providerId: "grok",
      modelId: "grok-4.5",
      personaId: "designer",
    })
    expect(assigned?.providerId).toBe("grok")
    expect(assigned?.personaId).toBe("designer")
    const cleared = db.updateCronJob("j1", "a", {
      providerId: null,
      modelId: null,
      personaId: null,
    })
    expect(cleared?.modelId).toBeNull()
    expect(cleared?.personaId).toBeNull()
    expect(cleared?.name).toBe("renamed")
    expect(cleared?.runKind).toBe("prompt")
    const scripted = db.updateCronJob("j1", "a", {
      runKind: "both",
      script: "date",
    })
    expect(scripted?.runKind).toBe("both")
    expect(scripted?.script).toBe("date")
    expect(scripted?.message).toBe("do it")

    expect(db.deleteCronJob("j1", "b")).toBe(false)
    expect(db.deleteCronJob("j1", "a")).toBe(true)
    expect(db.cronJobs("a")).toHaveLength(1)
  })

  test("returns due jobs and records runs, sessions, and next runs", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createCronJob(cron({ id: "due", userId: "a", nextRunAt: 500 }))
    db.createCronJob(cron({ id: "later", userId: "a", nextRunAt: 5000 }))
    db.createCronJob(
      cron({ id: "off", userId: "a", nextRunAt: 100, enabled: false }),
    )
    const due = db.dueCronJobs(1000)
    expect(due.map((job) => job.id)).toEqual(["due"])

    db.setCronNextRun("due", 9000)
    expect(db.dueCronJobs(1000)).toHaveLength(0)

    db.recordCronRun("due", null)
    db.recordCronRun("due", "prompt failed (500)")
    db.setCronSession("due", "ses_1")
    const after = db.cronJobById("due", "a")
    expect(after?.runCount).toBe(2)
    expect(after?.lastError).toBe("prompt failed (500)")
    expect(after?.sessionId).toBe("ses_1")
    expect(after?.lastRunAt).toBeGreaterThan(0)
  })

  test("publishes unread notices and marks them viewed", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.createCronNotice({
      id: "n1",
      userId: "a",
      jobId: "j1",
      jobName: "daily",
      runSessionId: "run",
      summary: null,
      createdAt: 1,
      viewedAt: null,
    })
    expect(db.pendingCronNotices().map((notice) => notice.id)).toEqual(["n1"])
    expect(db.unreadCronNotices("a")).toHaveLength(0)
    expect(db.settleCronNotice("n1", "found 2 items")).toBe(true)
    expect(db.pendingCronNotices()).toHaveLength(0)
    expect(db.unreadCronNotices("a")[0]?.summary).toBe("found 2 items")
    expect(db.unreadCronNotices("b")).toHaveLength(0)

    db.createCronNotice({
      id: "n2",
      userId: "a",
      jobId: "j1",
      jobName: "daily",
      runSessionId: "run2",
      summary: null,
      createdAt: 2,
      viewedAt: null,
    })
    expect(db.settleCronNotice("n2", "found 2 items")).toBe(true)
    expect(db.cronNoticeById("n2")).toBeNull()
    expect(db.unreadCronNotices("a")).toHaveLength(1)

    db.createCronNotice({
      id: "n2b",
      userId: "a",
      jobId: "j1",
      jobName: "daily",
      runSessionId: "run3",
      summary: null,
      createdAt: 2,
      viewedAt: null,
    })
    expect(db.settleCronNotice("n2b", "different result")).toBe(true)
    expect(db.cronNoticeById("n2b")?.summary).toBe("different result")
    db.viewCronNotice("n2b", "a")
    db.viewCronNotice("n1", "a")
    expect(db.unreadCronNotices("a")).toHaveLength(0)

    db.createCronNotice({
      id: "n3",
      userId: "a",
      jobId: "j1",
      jobName: "daily",
      runSessionId: null,
      summary: "done",
      createdAt: 3,
      viewedAt: null,
    })
    db.viewCronNotice("n3", "b")
    expect(db.unreadCronNotices("a")).toHaveLength(1)
    db.viewCronNotice("n3", "a")
    expect(db.unreadCronNotices("a")).toHaveLength(0)
    db.deleteUser("a")
    expect(db.cronNoticeById("n3")).toBeNull()
  })

  test("maps llm tokens to user ids and cleans up on delete", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.ensureDesktop({
      userId: "a",
      llmToken: "tok-1",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      lastActiveAt: 1,
    })
    expect(db.userIdByLlmToken("tok-1")).toBe("a")
    expect(db.userIdByLlmToken("nope")).toBeNull()
    db.createCronJob(cron({ id: "j1", userId: "a" }))
    db.createPersona({
      id: "p1",
      userId: "a",
      name: "Chef",
      instruction: "cook",
      createdAt: 1,
    })
    db.setThreadPersona("a", "ses", "p1")
    db.deleteUser("a")
    expect(db.cronJobs("a")).toHaveLength(0)
    expect(db.personas("a")).toHaveLength(0)
    expect(db.threadPersonas("a")).toHaveLength(0)
  })
})

describe("personas", () => {
  test("stores customs and clears thread assignments on delete", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createPersona({
      id: "p1",
      userId: "a",
      name: "Chef",
      instruction: "cook simply",
      createdAt: 1,
    })
    db.setThreadPersona("a", "ses", "p1")
    expect(db.threadPersona("a", "ses")?.personaId).toBe("p1")
    db.setThreadPersona("a", "ses", "designer")
    expect(db.threadPersona("a", "ses")?.personaId).toBe("designer")
    db.setThreadPersona("a", "ses", "p1")
    expect(
      db.updatePersona("p1", "a", { name: "Cook", instruction: "shorter" })
        ?.name,
    ).toBe("Cook")
    expect(db.deletePersona("p1", "a")).toBe(true)
    expect(db.personaById("p1", "a")).toBeNull()
    expect(db.threadPersona("a", "ses")).toBeNull()
  })
})

describe("plugin store", () => {
  function installed(
    partial: Partial<
      Parameters<ReturnType<typeof openDatabase>["createInstalledPlugin"]>[0]
    > &
      Pick<
        Parameters<ReturnType<typeof openDatabase>["createInstalledPlugin"]>[0],
        "id" | "userId" | "pluginId"
      >,
  ) {
    return {
      version: "1.0.0",
      manifest: "{}",
      readme: null,
      enabled: true,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
      ...partial,
    }
  }

  test("stores, toggles, and uninstalls plugins per user", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.createInstalledPlugin(
      installed({ id: "r1", userId: "a", pluginId: "weather-pro" }),
    )
    expect(db.installedPlugins("a")).toHaveLength(1)
    expect(db.installedPlugins("b")).toHaveLength(0)
    expect(db.installedPlugin("a", "weather-pro")?.version).toBe("1.0.0")
    expect(db.installedPlugin("a", "weather-pro")?.applied.skills).toEqual([])

    expect(
      db.setInstalledPluginEnabled("a", "weather-pro", false)?.enabled,
    ).toBe(false)
    db.setInstalledPluginApplied("a", "weather-pro", {
      personaIds: ["p1"],
      cronJobIds: [],
      skills: ["weather"],
      keys: ["weatherapi"],
      tools: ["weather"],
      opencode: false,
    })
    expect(db.installedPlugin("a", "weather-pro")?.applied.personaIds).toEqual([
      "p1",
    ])
    const updated = db.updateInstalledPlugin("a", "weather-pro", {
      version: "1.1.0",
      manifest: "{}",
      readme: "# hi",
    })
    expect(updated?.version).toBe("1.1.0")
    expect(updated?.readme).toBe("# hi")

    db.setPluginSetting("a", "weather-pro", "units", "metric")
    expect(db.pluginSettings("a", "weather-pro")[0]?.value).toBe("metric")
    db.setPluginSetting("a", "weather-pro", "units", "imperial")
    expect(db.pluginSettings("a", "weather-pro")[0]?.value).toBe("imperial")
    expect(db.pluginSettings("b", "weather-pro")).toHaveLength(0)

    expect(db.deleteInstalledPlugin("a", "nope")).toBe(false)
    expect(db.deleteInstalledPlugin("a", "weather-pro")).toBe(true)
    expect(db.installedPlugins("a")).toHaveLength(0)
    expect(db.pluginSettings("a", "weather-pro")).toHaveLength(0)
  })

  test("keeps app settings and cleans up plugins on user delete", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(db.getSetting("plugin_install_policy")).toBeNull()
    db.setSetting("plugin_install_policy", "auto")
    expect(db.getSetting("plugin_install_policy")).toBe("auto")
    db.setSetting("plugin_install_policy", "manual")
    expect(db.getSetting("plugin_install_policy")).toBe("manual")

    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createInstalledPlugin(
      installed({ id: "r1", userId: "a", pluginId: "weather-pro" }),
    )
    db.setPluginSetting("a", "weather-pro", "units", "metric")
    db.deleteUser("a")
    expect(db.installedPlugins("a")).toHaveLength(0)
    expect(db.pluginSettings("a", "weather-pro")).toHaveLength(0)
    expect(db.getSetting("plugin_install_policy")).toBe("manual")
  })
})
