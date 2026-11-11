import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type CronJob,
  DEFAULT_AGENT_STEP_CAP,
  openDatabase,
  type User,
  validAgentStepCap,
  validCpuCores,
  validDiskGb,
  validMemoryMb,
} from "./index"

describe("desktop limit validators", () => {
  test("cpu caps accept 0.5 cores and up", () => {
    expect(validCpuCores(0.5)).toBe(true)
    expect(validCpuCores(2)).toBe(true)
    expect(validCpuCores(1.5)).toBe(true)
    expect(validCpuCores(128)).toBe(true)
    expect(validCpuCores(0.25)).toBe(false)
    expect(validCpuCores(0)).toBe(false)
    expect(validCpuCores(-2)).toBe(false)
    expect(validCpuCores(Number.NaN)).toBe(false)
    expect(validCpuCores(Number.POSITIVE_INFINITY)).toBe(false)
    expect(validCpuCores(null)).toBe(false)
    expect(validCpuCores("2")).toBe(false)
  })

  test("memory caps accept 512 MB through 64 GB", () => {
    expect(validMemoryMb(512)).toBe(true)
    expect(validMemoryMb(4096)).toBe(true)
    expect(validMemoryMb(65_536)).toBe(true)
    expect(validMemoryMb(511)).toBe(false)
    expect(validMemoryMb(65_537)).toBe(false)
    expect(validMemoryMb(0)).toBe(false)
    expect(validMemoryMb(-4096)).toBe(false)
    expect(validMemoryMb(4.5)).toBe(false)
    expect(validMemoryMb(null)).toBe(false)
    expect(validMemoryMb("4096")).toBe(false)
  })

  test("agent step caps default to 512 and accept 1..100000", () => {
    expect(DEFAULT_AGENT_STEP_CAP).toBe(512)
    expect(validAgentStepCap(1)).toBe(true)
    expect(validAgentStepCap(512)).toBe(true)
    expect(validAgentStepCap(100_000)).toBe(true)
    expect(validAgentStepCap(0)).toBe(false)
    expect(validAgentStepCap(100_001)).toBe(false)
    expect(validAgentStepCap(512.5)).toBe(false)
    expect(validAgentStepCap(null)).toBe(false)
    expect(validAgentStepCap("512")).toBe(false)
  })

  test("disk caps accept whole GB from 0", () => {
    expect(validDiskGb(0)).toBe(true)
    expect(validDiskGb(50)).toBe(true)
    expect(validDiskGb(100_000)).toBe(true)
    expect(validDiskGb(-1)).toBe(false)
    expect(validDiskGb(10.5)).toBe(false)
    expect(validDiskGb(100_001)).toBe(false)
    expect(validDiskGb(null)).toBe(false)
    expect(validDiskGb("50")).toBe(false)
  })
})

describe("agent step cap storage", () => {
  test("defaults to null and round-trips a user value", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite")
    const db = openDatabase(path)
    db.createUser({
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "admin",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.ensureDesktop({
      userId: "a",
      llmToken: "tok",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    expect(db.desktop("a")?.agentStepCap).toBeNull()
    db.updateDesktopAgentStepCap("a", 1024)
    expect(db.desktop("a")?.agentStepCap).toBe(1024)
    db.updateDesktopAgentStepCap("a", null)
    expect(db.desktop("a")?.agentStepCap).toBeNull()
  })
})

function user(
  partial: Partial<User> & Pick<User, "id" | "email" | "role">,
): User {
  return {
    passwordHash: "hash",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
    marketplaceApiKey: null,
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
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    db.setUserVikingProvider("a", {
      baseURL: "https://own.test/v1",
      apiKey: "k",
      embedProvider: "custom-openai-compatible",
      embedAccountId: "",
      embedModel: "embed",
      embedDimension: 8,
      vlmModel: "vlm",
      vlmSource: "custom",
      vlmProvider: "",
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
      personaId: "plugin-creator",
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
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-1",
      embedModel: "embed-up",
      embedDimension: 1024,
      vlmModel: "vlm-up",
      vlmSource: "custom",
      vlmProvider: "",
    })
    expect(db.getVikingProvider()).toEqual({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-1",
      embedModel: "embed-up",
      embedDimension: 1024,
      vlmModel: "vlm-up",
      vlmSource: "custom",
      vlmProvider: "",
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
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    db.ensureDesktop({
      userId: "b",
      llmToken: "t",
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    db.setVikingProvider({
      baseURL: "https://default.test/v1",
      apiKey: "default-key",
      embedProvider: "openai",
      embedAccountId: "",
      embedModel: "embed-default",
      embedDimension: 1536,
      vlmModel: "vlm-default",
      vlmSource: "custom",
      vlmProvider: "",
    })
    expect(db.getVikingProvider("a")).toEqual({
      baseURL: "https://default.test/v1",
      apiKey: "default-key",
      embedProvider: "openai",
      embedAccountId: "",
      embedModel: "embed-default",
      embedDimension: 1536,
      vlmModel: "vlm-default",
      vlmSource: "custom",
      vlmProvider: "",
    })
    db.setUserVikingProvider("a", {
      baseURL: "",
      apiKey: "own-key",
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-own",
      embedModel: "embed-own",
      embedDimension: 768,
      vlmModel: "gpt-5-codex",
      vlmSource: "opencode",
      vlmProvider: "openai",
    })
    expect(db.getVikingProvider("a")).toEqual({
      baseURL: "",
      apiKey: "own-key",
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-own",
      embedModel: "embed-own",
      embedDimension: 768,
      vlmModel: "gpt-5-codex",
      vlmSource: "opencode",
      vlmProvider: "openai",
    })
    expect(db.getVikingProvider("b")?.baseURL).toBe("https://default.test/v1")
  })

  test("stores and clears the thinking effort", () => {
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
      thinkingEffort: null,
      lastActiveAt: 1,
    })
    expect(db.desktop("a")?.thinkingEffort).toBeNull()
    db.setThinkingEffort("a", "high")
    expect(db.desktop("a")?.thinkingEffort).toBe("high")
    db.setThinkingEffort("a", " medium ")
    expect(db.desktop("a")?.thinkingEffort).toBe("medium")
    db.setThinkingEffort("a", "")
    expect(db.desktop("a")?.thinkingEffort).toBeNull()
    db.setThinkingEffort("a", "xhigh")
    expect(db.desktop("a")?.thinkingEffort).toBe("xhigh")
    db.setThinkingEffort("a", null)
    expect(db.desktop("a")?.thinkingEffort).toBeNull()
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
      thinkingEffort: null,
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
      thinkingEffort: null,
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
      thinkingEffort: null,
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
      thinkingEffort: null,
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
      personaId: "plugin-creator",
    })
    expect(assigned?.providerId).toBe("grok")
    expect(assigned?.personaId).toBe("plugin-creator")
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
    const auto = db.updateCronJob("j1", "a", {
      runKind: "auto",
      script: "check.sh",
    })
    expect(auto?.runKind).toBe("auto")
    expect(auto?.script).toBe("check.sh")

    expect(db.deleteCronJob("j1", "b")).toBe(false)
    expect(db.deleteCronJob("j1", "a")).toBe(true)
    expect(db.cronJobs("a")).toHaveLength(1)
  })

  test("updates replace the whole schedule in place", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createCronJob(cron({ id: "s1", userId: "a", everySeconds: 180 }))
    const toCron = db.updateCronJob("s1", "a", {
      kind: "cron",
      cronExpr: "0 * * * *",
      everySeconds: null,
      atMs: null,
      deleteAfterRun: false,
    })
    expect(toCron?.kind).toBe("cron")
    expect(toCron?.cronExpr).toBe("0 * * * *")
    expect(toCron?.everySeconds).toBeNull()
    expect(toCron?.atMs).toBeNull()
    expect(toCron?.deleteAfterRun).toBe(false)
    const toAt = db.updateCronJob("s1", "a", {
      kind: "at",
      atMs: 1_800_000_000_000,
      cronExpr: null,
      everySeconds: null,
      deleteAfterRun: true,
    })
    expect(toAt?.kind).toBe("at")
    expect(toAt?.atMs).toBe(1_800_000_000_000)
    expect(toAt?.cronExpr).toBeNull()
    expect(toAt?.deleteAfterRun).toBe(true)
    const toEvery = db.updateCronJob("s1", "a", {
      kind: "every",
      everySeconds: 3600,
      atMs: null,
      deleteAfterRun: false,
    })
    expect(toEvery?.kind).toBe("every")
    expect(toEvery?.everySeconds).toBe(3600)
    expect(toEvery?.atMs).toBeNull()
    expect(toEvery?.deleteAfterRun).toBe(false)
    // Unrelated updates keep the schedule.
    const untouched = db.updateCronJob("s1", "a", { name: "keep" })
    expect(untouched?.kind).toBe("every")
    expect(untouched?.everySeconds).toBe(3600)
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
      thinkingEffort: null,
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
      skills: null,
      skillsExtra: null,
      skillsNone: false,
      mcp: null,
      mcpExtra: null,
      mcpNone: false,
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
      skills: null,
      skillsExtra: null,
      skillsNone: false,
      mcp: null,
      mcpExtra: null,
      mcpNone: false,
      createdAt: 1,
    })
    db.setThreadPersona("a", "ses", "p1")
    expect(db.threadPersona("a", "ses")?.personaId).toBe("p1")
    db.setThreadPersona("a", "ses", "plugin-creator")
    expect(db.threadPersona("a", "ses")?.personaId).toBe("plugin-creator")
    db.setThreadPersona("a", "ses", "p1")
    expect(
      db.updatePersona("p1", "a", { name: "Cook", instruction: "shorter" })
        ?.name,
    ).toBe("Cook")
    expect(db.deletePersona("p1", "a")).toBe(true)
    expect(db.personaById("p1", "a")).toBeNull()
    expect(db.threadPersona("a", "ses")).toBeNull()
  })

  test("thread model picks roundtrip, update in place, and clear", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    expect(db.threadModel("a", "ses")).toBeNull()
    db.setThreadModel({
      userId: "a",
      sessionId: "ses",
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    expect(db.threadModel("a", "ses")).toEqual({
      userId: "a",
      sessionId: "ses",
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    db.setThreadModel({
      userId: "a",
      sessionId: "ses",
      providerId: null,
      modelId: null,
      effort: "low",
    })
    expect(db.threadModel("a", "ses")?.effort).toBe("low")
    expect(db.threadModel("a", "ses")?.providerId).toBeNull()
    db.setThreadModel({
      userId: "a",
      sessionId: "ses-2",
      providerId: "prov",
      modelId: "plain",
      effort: null,
    })
    expect(db.threadModels("a")).toHaveLength(2)
    expect(db.threadModels("b")).toHaveLength(0)
    db.clearThreadModel("a", "ses")
    expect(db.threadModel("a", "ses")).toBeNull()
    expect(db.threadModels("a")).toHaveLength(1)
    db.deleteUser("a")
    expect(db.threadModels("a")).toHaveLength(0)
  })

  test("sandbox profiles and threads roundtrip; token lookup and wipes work", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.saveSandboxProfile({
      id: "sp1",
      userId: "a",
      name: "locked",
      profile: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    db.saveSandboxProfile({
      id: "sp1",
      userId: "a",
      name: "locked",
      profile: '{"network":"off"}',
      createdAt: 1,
      updatedAt: 2,
    })
    expect(db.sandboxProfiles("a")).toHaveLength(1)
    expect(db.sandboxProfileByName("a", "locked")?.profile).toBe(
      '{"network":"off"}',
    )
    expect(db.sandboxProfileByName("a", "nope")).toBeNull()
    db.createSandboxThread({
      id: "sb1",
      userId: "a",
      sessionId: null,
      profileId: "sp1",
      profile: "{}",
      container: "ob-sbx-a-sb1",
      network: "ob-sbx-sb1",
      tokenHash: "hash1",
      state: "starting",
      createdAt: 1,
      expiresAt: 100,
      lastActiveAt: 1,
    })
    expect(db.sandboxByTokenHash("hash1")?.id).toBe("sb1")
    expect(db.sandboxByTokenHash("other")).toBeNull()
    db.updateSandboxThread("sb1", { sessionId: "ses-x", state: "running" })
    expect(db.sandboxBySession("ses-x")?.id).toBe("sb1")
    expect(db.liveSandboxes("a")).toHaveLength(1)
    expect(db.liveSandboxes("b")).toHaveLength(0)
    db.updateSandboxThread("sb1", { state: "destroyed" })
    expect(db.liveSandboxes("a")).toHaveLength(0)
    db.deleteUser("a")
    expect(db.sandboxProfiles("a")).toHaveLength(0)
    expect(db.sandboxByTokenHash("hash1")).toBeNull()
  })

  test("skill allowlists roundtrip and an update keeps extras", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createPersona({
      id: "p1",
      userId: "a",
      name: "Chef",
      instruction: "cook simply",
      skills: ["research", "media"],
      skillsExtra: ["preview"],
      skillsNone: false,
      mcp: null,
      mcpExtra: null,
      mcpNone: false,
      createdAt: 1,
    })
    expect(db.personaById("p1", "a")?.skills).toEqual(["research", "media"])
    expect(db.personaById("p1", "a")?.skillsExtra).toEqual(["preview"])
    // present-set update: replacing skills keeps the untouched extras
    db.updatePersona("p1", "a", { skills: ["research"] })
    const updated = db.personaById("p1", "a")
    expect(updated?.skills).toEqual(["research"])
    expect(updated?.skillsExtra).toEqual(["preview"])
    // null clears a list back to unrestricted
    db.updatePersona("p1", "a", { skillsExtra: null })
    expect(db.personaById("p1", "a")?.skillsExtra).toBeNull()
    db.updatePersona("p1", "a", { skills: null })
    expect(db.personaById("p1", "a")?.skills).toBeNull()
  })

  test("mcp allowlists roundtrip like skills", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createPersona({
      id: "p1",
      userId: "a",
      name: "Trader",
      instruction: "cook",
      skills: null,
      skillsExtra: null,
      skillsNone: false,
      mcp: ["Stock.Data"],
      mcpExtra: ["files"],
      mcpNone: false,
      createdAt: 1,
    })
    expect(db.personaById("p1", "a")?.mcp).toEqual(["Stock.Data"])
    expect(db.personaById("p1", "a")?.mcpExtra).toEqual(["files"])
    db.updatePersona("p1", "a", { mcp: ["stock"] })
    expect(db.personaById("p1", "a")?.mcp).toEqual(["stock"])
    expect(db.personaById("p1", "a")?.mcpExtra).toEqual(["files"])
    db.updatePersona("p1", "a", { mcp: null, mcpExtra: null })
    expect(db.personaById("p1", "a")?.mcp).toBeNull()
    expect(db.personaById("p1", "a")?.mcpExtra).toBeNull()
    // an explicitly empty list is the block-all state and survives storage
    db.updatePersona("p1", "a", { mcp: [] })
    expect(db.personaById("p1", "a")?.mcp).toEqual([])
  })

  test("built-in persona extras upsert per user and wipe with the user", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.setBuiltinPersonaScope("a", "plugin-creator", {
      skillsExtra: ["research"],
      mcpExtra: ["files"],
    })
    expect(db.builtinPersonaScopes("a")).toEqual([
      {
        userId: "a",
        personaId: "plugin-creator",
        skillsExtra: ["research"],
        skillsNone: false,
        mcpExtra: ["files"],
        mcpNone: false,
      },
    ])
    // other users and built-ins are untouched
    expect(db.builtinPersonaScopes("b")).toEqual([])
    // present-set / omitted-keep on the upsert
    db.setBuiltinPersonaScope("a", "plugin-creator", { skillsExtra: ["media"] })
    const scope = db.builtinPersonaScopes("a")[0]
    expect(scope?.skillsExtra).toEqual(["media"])
    expect(scope?.mcpExtra).toEqual(["files"])
    // null clears one list
    db.setBuiltinPersonaScope("a", "plugin-creator", { mcpExtra: null })
    expect(db.builtinPersonaScopes("a")[0]?.mcpExtra).toBeNull()
    // deleting the user removes the rows
    db.deleteUser("a")
    expect(db.builtinPersonaScopes("a")).toEqual([])
  })

  test("reopening remaps removed built-ins to the assistant", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite")
    const db = openDatabase(path)
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.setThreadPersona("a", "ses-old", "designer")
    db.setThreadPersona("a", "ses-keep", "plugin-creator")
    db.setBuiltinPersonaScope("a", "political-expert", {
      skillsExtra: ["research"],
    })
    db.createCronJob({
      id: "j1",
      userId: "a",
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
      personaId: "software-designer",
      runKind: "prompt",
      script: null,
    })
    db.close()

    const reopened = openDatabase(path)
    // thread bindings point at the assistant (cron jobs store that as null)
    expect(reopened.threadPersona("a", "ses-old")?.personaId).toBe("assistant")
    expect(reopened.threadPersona("a", "ses-keep")?.personaId).toBe(
      "plugin-creator",
    )
    expect(reopened.cronJobs("a")[0]?.personaId).toBeNull()
    // scope rows for removed built-ins are dropped
    expect(reopened.builtinPersonaScopes("a")).toEqual([])
    reopened.close()
  })
})

describe("thread dirs", () => {
  test("creates, renames, assigns, and deletes folders per user", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.createThreadDir({
      id: "d1",
      userId: "a",
      name: "Billing",
      createdAt: 1,
    })
    expect(db.threadDirs("a")).toHaveLength(1)
    expect(db.threadDirs("b")).toHaveLength(0)
    expect(db.threadDirById("d1", "a")?.name).toBe("Billing")
    expect(db.threadDirById("d1", "b")).toBeNull()
    expect(db.threadDirByName("a", "billing")?.id).toBe("d1")
    expect(db.threadDirByName("a", "nope")).toBeNull()
    db.setThreadDir("a", "ses", "d1")
    expect(
      db.threadDirAssignments("a").map((row) => [row.sessionId, row.dirId]),
    ).toEqual([["ses", "d1"]])
    db.setThreadDir("a", "ses", "d1")
    expect(db.threadDirAssignments("a")).toHaveLength(1)
    expect(db.renameThreadDir("d1", "a", "Invoices")?.name).toBe("Invoices")
    expect(db.renameThreadDir("d1", "b", "X")).toBeNull()
    db.setThreadDir("a", "ses", null)
    expect(db.threadDirAssignments("a")).toHaveLength(0)
    db.setThreadDir("a", "ses", "d1")
    expect(db.deleteThreadDir("d1", "a")).toBe(true)
    expect(db.deleteThreadDir("d1", "a")).toBe(false)
    expect(db.threadDirById("d1", "a")).toBeNull()
    expect(db.threadDirAssignments("a")).toHaveLength(0)
  })

  test("clears the assignment when a thread is deleted", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createThreadDir({
      id: "d1",
      userId: "a",
      name: "Work",
      createdAt: 1,
    })
    db.setThreadDir("a", "ses", "d1")
    db.clearThreadDir("a", "ses")
    expect(db.threadDirAssignments("a")).toHaveLength(0)
  })

  test("reset wipes the folders and assignments", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createThreadDir({
      id: "d1",
      userId: "a",
      name: "Work",
      createdAt: 1,
    })
    db.setThreadDir("a", "ses", "d1")
    db.resetDesktopState("a")
    expect(db.threadDirs("a")).toHaveLength(0)
    expect(db.threadDirAssignments("a")).toHaveLength(0)
  })
})

describe("recent thread titles", () => {
  test("newest first, per user, capped by the limit", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.setThreadTitle({
      userId: "a",
      sessionId: "s1",
      title: "Ancienne",
      author: "ob",
      createdAt: 100,
    })
    db.setThreadTitle({
      userId: "a",
      sessionId: "s2",
      title: "Récente",
      author: "user",
      createdAt: 200,
    })
    db.setThreadTitle({
      userId: "b",
      sessionId: "s3",
      title: "Autre compte",
      author: "ob",
      createdAt: 300,
    })
    const out = db.recentThreadTitles("a", 1)
    expect(out.map((row) => row.sessionId)).toEqual(["s2"])
    expect(db.recentThreadTitles("b", 8).map((row) => row.title)).toEqual([
      "Autre compte",
    ])
  })

  test("a title update moves the row by its new timestamp", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.setThreadTitle({
      userId: "a",
      sessionId: "s1",
      title: "Brouillon",
      author: "ob",
      createdAt: 100,
    })
    db.setThreadTitle({
      userId: "a",
      sessionId: "s1",
      title: "Nom final",
      author: "user",
      createdAt: 500,
    })
    const out = db.recentThreadTitles("a", 8)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Nom final")
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
    expect(updated?.source).toBe("marketplace")
    expect(updated?.localPath).toBeNull()

    const local = db.updateInstalledPlugin("a", "weather-pro", {
      version: "1.1.0",
      manifest: "{}",
      readme: "# hi",
      source: "local",
      localPath: "/plugin/root",
    })
    expect(local?.source).toBe("local")
    expect(local?.localPath).toBe("/plugin/root")
    expect(db.installedPlugin("a", "weather-pro")?.source).toBe("local")

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

  test("webhook secrets are per install and optional", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser(user({ id: "a", email: "a@localhost", role: "user" }))
    db.createUser(user({ id: "b", email: "b@localhost", role: "user" }))
    db.createInstalledPlugin(
      installed({ id: "r1", userId: "a", pluginId: "weather-pro" }),
    )
    expect(db.installedPluginsByPluginId("weather-pro")).toHaveLength(1)
    expect(db.installedPluginsByPluginId("nope")).toHaveLength(0)
    expect(db.installedPlugin("a", "weather-pro")?.webhookToken).toBeNull()
    expect(
      db.setInstalledPluginWebhookToken("a", "weather-pro", "s3cret")
        ?.webhookToken,
    ).toBe("s3cret")
    expect(db.installedPluginsByPluginId("weather-pro")[0]?.webhookToken).toBe(
      "s3cret",
    )
    expect(
      db.setInstalledPluginWebhookToken("a", "weather-pro", null)?.webhookToken,
    ).toBeNull()
    db.createInstalledPlugin(
      installed({ id: "r2", userId: "b", pluginId: "weather-pro" }),
    )
    expect(db.installedPluginsByPluginId("weather-pro")).toHaveLength(2)
    expect(db.setInstalledPluginWebhookToken("a", "nope", "x")).toBeNull()
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

describe("thread message queue", () => {
  test("orders by enqueue, promotes to head, edits, deletes, clears", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    const at = 1_700_000_000_000
    db.enqueueThreadMessage({
      id: "q1",
      userId: "u1",
      sessionId: "s1",
      text: "first",
      files: "[]",
      createdAt: at,
    })
    db.enqueueThreadMessage({
      id: "q2",
      userId: "u1",
      sessionId: "s1",
      text: "second",
      files: "[]",
      createdAt: at,
    })
    db.enqueueThreadMessage({
      id: "q3",
      userId: "u1",
      sessionId: "s2",
      text: "other thread",
      files: "[]",
      createdAt: at,
    })
    expect(db.threadQueue("u1", "s1").map((row) => row.id)).toEqual([
      "q1",
      "q2",
    ])
    expect(db.threadQueueSessions("u1").sort()).toEqual(["s1", "s2"])
    db.enqueueThreadMessage({
      id: "q4",
      userId: "u2",
      sessionId: "s2",
      text: "other user",
      files: "[]",
      createdAt: at,
    })
    expect(
      db
        .threadQueuePairs()
        .map((row) => `${row.userId}/${row.sessionId}`)
        .sort(),
    ).toEqual(["u1/s1", "u1/s2", "u2/s2"])
    db.promoteThreadQueueItem("u1", "q2")
    expect(db.threadQueue("u1", "s1").map((row) => row.id)).toEqual([
      "q2",
      "q1",
    ])
    const edited = db.updateThreadQueueItem("u1", "q1", {
      text: "first, edited",
      files: "[]",
    })
    expect(edited?.text).toBe("first, edited")
    expect(db.threadQueueItem("u2", "q1")).toBeNull()
    db.deleteThreadQueueItem("u1", "q2")
    expect(db.threadQueue("u1", "s1").map((row) => row.id)).toEqual(["q1"])
    db.clearThreadQueue("u1", "s1")
    expect(db.threadQueue("u1", "s1")).toEqual([])
    expect(db.threadQueue("u1", "s2").map((row) => row.id)).toEqual(["q3"])
    db.createUser(user({ id: "u1", email: "u1@localhost", role: "user" }))
    db.deleteUser("u1")
    expect(db.threadQueue("u1", "s2")).toEqual([])
  })
})

describe("project rename", () => {
  test("rename keeps the id, path, and owner scoping (#95)", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite")
    const db = openDatabase(path)
    db.createUser({
      id: "a",
      email: "a@localhost",
      passwordHash: "hash",
      role: "admin",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.createProject({
      id: "p1",
      userId: "a",
      name: "Old name",
      path: "/home/agent/workspace/old",
      createdAt: 1,
    })
    expect(db.renameProject("p1", "a", "New name")).toBe(true)
    expect(db.projectById("p1", "a")).toMatchObject({
      id: "p1",
      name: "New name",
      path: "/home/agent/workspace/old",
    })
    expect(db.renameProject("p1", "other", "Nope")).toBe(false)
    expect(db.renameProject("missing", "a", "Nope")).toBe(false)
  })
})
