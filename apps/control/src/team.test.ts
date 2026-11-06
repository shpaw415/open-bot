import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Db, openDatabase } from "@open-bot/db"
import {
  effectiveUserKey,
  getTeamConfig,
  objectHasAnyField,
  redactTeamConfig,
  resolveQuota,
  saveTeamConfig,
  type TeamConfig,
  teamMode,
  teamWriteLocked,
  userWeeklyUsage,
  weeklyWindowStart,
} from "./team"

// Patches arriving over the wire are untrusted JSON — the typed overlay
// cannot express invalid provider ids, so rejection tests go through this.
const rawPatch = (patch: unknown) => patch as Partial<TeamConfig>

function freshDb() {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
  )
  db.createUser({
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
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
  return db
}

const KEY = {
  apiKey: "k",
  accountId: "acc",
  gatewayId: "gw",
  gatewayToken: "gt",
  gatewaySlug: "gs",
  baseUrl: "https://x",
}

function record(
  db: Db,
  userId: string,
  createdAt: number,
  totalTokens: number,
) {
  db.recordUsage({
    userId,
    createdAt,
    kind: "chat",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens,
  })
}

test("defaults on a fresh database", () => {
  const db = freshDb()
  expect(getTeamConfig(db)).toEqual({
    mode: "personal",
    lockModelPicker: false,
    lockWatchdog: false,
    quotaDefaultTokens: null,
    quotaBehavior: "block",
    providers: {},
  })
  expect(teamMode(db)).toBe("personal")
})

test("garbage and partial stored config parse tolerantly", () => {
  const db = freshDb()
  db.setSetting("team_config", "{not json")
  expect(teamMode(db)).toBe("personal")
  db.setSetting("team_config", "[1,2,3]")
  expect(teamMode(db)).toBe("personal")
  db.setSetting(
    "team_config",
    JSON.stringify({
      mode: "team",
      providers: {
        chat: { provider: "cf", bogus: 1, extra: "x" },
        nope: "str",
      },
    }),
  )
  const config = getTeamConfig(db)
  expect(config.mode).toBe("team")
  expect(config.lockModelPicker).toBe(false)
  expect(config.lockWatchdog).toBe(false)
  expect(config.quotaDefaultTokens).toBeNull()
  expect(config.quotaBehavior).toBe("block")
  expect(config.providers.chat?.provider).toBe("cf")
  expect(config.providers.chat && "bogus" in config.providers.chat).toBe(false)
  expect(config.providers.chat && "extra" in config.providers.chat).toBe(false)
  expect(config.providers.video).toBeUndefined()
})

test("save merges onto the current config and persists", () => {
  const db = freshDb()
  const first = saveTeamConfig(db, { mode: "team", quotaBehavior: "warn" })
  expect(first.mode).toBe("team")
  expect(first.quotaBehavior).toBe("warn")
  expect(first.lockModelPicker).toBe(false)
  const second = saveTeamConfig(db, {
    quotaDefaultTokens: 1000,
    providers: { chat: { provider: "openai", model: "gpt" } },
  })
  expect(second.mode).toBe("team")
  expect(second.quotaBehavior).toBe("warn")
  expect(second.quotaDefaultTokens).toBe(1000)
  expect(second.providers.chat).toEqual({ provider: "openai", model: "gpt" })
  expect(getTeamConfig(db)).toEqual(second)
  const stored = db.getSetting("team_config")
  expect(stored).not.toBeNull()
  expect(JSON.parse(stored as string)).toEqual(second)
})

test("overlay saves merge per field: omitted keeps, blank and null clear", () => {
  const db = freshDb()
  saveTeamConfig(db, {
    providers: {
      image: {
        provider: "cloudflare-workers-ai",
        accountId: "acc",
        apiKey: "sk-1",
        model: "m",
      },
    },
  })
  const kept = saveTeamConfig(db, {
    providers: { image: { accountId: "acc-2" } },
  })
  expect(kept.providers.image).toEqual({
    provider: "cloudflare-workers-ai",
    accountId: "acc-2",
    apiKey: "sk-1",
    model: "m",
  })
  // Clearing the model while a provider is set refills its catalog default
  // (same rule as the per-user provider forms).
  const cleared = saveTeamConfig(db, {
    providers: { image: { apiKey: null, model: null } },
  })
  expect(cleared.providers.image).toEqual({
    provider: "cloudflare-workers-ai",
    accountId: "acc-2",
    apiKey: null,
    model: "@cf/black-forest-labs/flux-2-klein-9b",
  })
  const blank = saveTeamConfig(
    db,
    rawPatch({ providers: { image: { provider: "" } } }),
  )
  expect(blank.providers.image).toEqual({
    provider: null,
    accountId: "acc-2",
    apiKey: null,
    model: "@cf/black-forest-labs/flux-2-klein-9b",
  })
  const pruned = saveTeamConfig(db, {
    providers: { image: { accountId: null, model: null } },
  })
  expect(pruned.providers.image).toBeUndefined()
  expect(getTeamConfig(db)).toEqual(pruned)
})

test("redactTeamConfig nulls secrets and reports per-section markers", () => {
  const db = freshDb()
  saveTeamConfig(db, {
    providers: {
      chat: { provider: "openai", model: "gpt" },
      image: {
        provider: "cloudflare-workers-ai",
        accountId: "acc",
        apiKey: "sk-1",
        model: "m1",
      },
      system1: {
        provider: "cloudflare-jev",
        endpoint: null,
        apiKey: "sk-2",
        gatewayToken: "gt-1",
        model: "m",
        accountId: "acc",
        gatewayId: "gw",
        slug: "s",
      },
      voice: {
        sttProvider: "openai-stt",
        sttAccountId: null,
        sttApiKey: "sk-3",
        sttModel: null,
        ttsProvider: null,
        ttsAccountId: null,
        ttsApiKey: null,
        ttsModel: null,
      },
    },
  })
  const stored = getTeamConfig(db)
  const { config, secrets } = redactTeamConfig(stored)
  expect(config.providers.image).toEqual({
    provider: "cloudflare-workers-ai",
    accountId: "acc",
    apiKey: null,
    model: "m1",
  })
  expect(config.providers.system1?.gatewayToken).toBeNull()
  expect(config.providers.voice?.sttApiKey).toBeNull()
  expect(secrets.chat).toEqual({ hasKey: false })
  expect(secrets.image).toEqual({
    hasKey: true,
    fields: { apiKey: true },
  })
  expect(secrets.system1).toEqual({
    hasKey: true,
    hasGatewayToken: true,
    fields: { apiKey: true, gatewayToken: true },
  })
  expect(secrets.voice).toEqual({
    hasKey: true,
    fields: { sttApiKey: true, ttsApiKey: false },
  })
  expect(JSON.stringify(config)).not.toContain("sk-1")
  expect(JSON.stringify(config)).not.toContain("gt-1")
  expect(getTeamConfig(db)).toEqual(stored)
})

test("saveTeamConfig validates catalog overlay sections", () => {
  const db = freshDb()
  // Unknown provider ids are rejected per section, nothing is stored.
  expect(() =>
    saveTeamConfig(
      db,
      rawPatch({
        providers: { image: { provider: "cloudflare", model: "m" } },
      }),
    ),
  ).toThrow(/unsupported image provider/)
  expect(() =>
    saveTeamConfig(
      db,
      rawPatch({
        providers: { watchdog: { provider: "nope", model: "m" } },
      }),
    ),
  ).toThrow(/unsupported watchdog provider/)
  expect(getTeamConfig(db).providers.image).toBeUndefined()

  // Blank models take the provider default; custom media models pass.
  saveTeamConfig(db, {
    providers: {
      video: { provider: "openai", apiKey: "sk-video-long", model: null },
      model3d: {
        provider: "replicate",
        apiKey: "sk-3d-long",
        model: "someone/new-3d-model",
      },
      system1: { provider: "laya", endpoint: "http://laya:8010", model: null },
      watchdog: {
        provider: "custom",
        baseUrl: "https://gw.example/v1",
        model: "my-model",
      },
    },
  })
  const providers = getTeamConfig(db).providers
  expect(providers.video?.model).toBe("sora-2")
  expect(providers.model3d?.model).toBe("someone/new-3d-model")
  // Laya has no default model — blank stays blank (server chooses).
  expect(providers.system1?.model).toBeNull()
  expect(providers.watchdog?.model).toBe("my-model")
})

test("saveTeamConfig canonicalizes and validates the voice overlay", () => {
  const db = freshDb()
  // Legacy Workers AI ids are stored canonical, blank models take the
  // provider default, and the retired whisper model remaps to turbo.
  saveTeamConfig(
    db,
    rawPatch({
      providers: {
        voice: {
          sttProvider: "deepgram-stt",
          sttAccountId: "a".repeat(32),
          sttApiKey: "k".repeat(40),
          sttModel: null,
          ttsProvider: "workers-ai-tts",
          ttsAccountId: null,
          ttsApiKey: null,
          ttsModel: "@cf/deepgram/aura-1",
        },
      },
    }),
  )
  let voice = getTeamConfig(db).providers.voice
  expect(voice?.sttProvider).toBe("cloudflare-stt")
  expect(voice?.sttModel).toBe("@cf/openai/whisper-large-v3-turbo")
  expect(voice?.ttsProvider).toBe("cloudflare-tts")
  expect(voice?.ttsModel).toBe("@cf/deepgram/aura-1")

  saveTeamConfig(db, {
    providers: { voice: { sttModel: "@cf/openai/whisper" } },
  })
  voice = getTeamConfig(db).providers.voice
  expect(voice?.sttModel).toBe("@cf/openai/whisper-large-v3-turbo")

  // A provider on the wrong side, an unknown model, and a model for the
  // model-less xAI TTS are all rejected without touching the stored config.
  expect(() =>
    saveTeamConfig(
      db,
      rawPatch({ providers: { voice: { sttProvider: "xai-tts" } } }),
    ),
  ).toThrow(/unsupported speech provider/)
  expect(() =>
    saveTeamConfig(db, {
      providers: { voice: { sttProvider: "openai-stt", sttModel: "nova-3" } },
    }),
  ).toThrow(/unsupported model/)
  expect(() =>
    saveTeamConfig(db, {
      providers: {
        voice: { ttsProvider: "xai-tts", ttsModel: "gpt-4o-mini-tts" },
      },
    }),
  ).toThrow(/does not take a model/)
  expect(getTeamConfig(db).providers.voice?.sttProvider).toBe("cloudflare-stt")
})

test("teamWriteLocked only binds non-admins in team mode", () => {
  const db = freshDb()
  expect(teamWriteLocked(db, "user")).toBe(false)
  saveTeamConfig(db, { mode: "team" })
  expect(teamWriteLocked(db, "user")).toBe(true)
  expect(teamWriteLocked(db, "admin")).toBe(false)
})

test("objectHasAnyField detects present fields only", () => {
  expect(
    objectHasAnyField({ provider: "", model: undefined }, ["provider"]),
  ).toBe(true)
  expect(objectHasAnyField({ voice: "x" }, ["provider", "accountId"])).toBe(
    false,
  )
  expect(objectHasAnyField(null, ["provider"])).toBe(false)
  expect(objectHasAnyField("str", ["provider"])).toBe(false)
  expect(objectHasAnyField(["provider"], ["provider"])).toBe(false)
})

test("invalid saves throw and leave the config untouched", () => {
  const db = freshDb()
  saveTeamConfig(db, { mode: "team", quotaDefaultTokens: 500 })
  const bad = (value: unknown) => value as Partial<TeamConfig>
  expect(() => saveTeamConfig(db, bad({ mode: "shared" }))).toThrow()
  expect(() => saveTeamConfig(db, bad({ quotaBehavior: "soft" }))).toThrow()
  expect(() => saveTeamConfig(db, bad({ lockModelPicker: "yes" }))).toThrow()
  expect(() => saveTeamConfig(db, bad({ lockWatchdog: 1 }))).toThrow()
  expect(() => saveTeamConfig(db, bad({ quotaDefaultTokens: -5 }))).toThrow()
  expect(() =>
    saveTeamConfig(db, bad({ quotaDefaultTokens: "lots" })),
  ).toThrow()
  expect(() => saveTeamConfig(db, bad({ providers: "nope" }))).toThrow()
  expect(() =>
    saveTeamConfig(db, bad({ providers: { chat: { provider: 3 } } })),
  ).toThrow()
  expect(() =>
    saveTeamConfig(db, bad({ providers: { unknown: {} } })),
  ).toThrow()
  expect(() =>
    saveTeamConfig(db, bad({ providers: { chat: { nope: null } } })),
  ).toThrow()
  const config = getTeamConfig(db)
  expect(config.mode).toBe("team")
  expect(config.quotaDefaultTokens).toBe(500)
  expect(config.providers).toEqual({})
})

test("effectiveUserKey resolves per mode", () => {
  const db = freshDb()
  db.setUserKey("a", "openai", KEY)
  const personal = effectiveUserKey(db, "a", "openai")
  expect(personal).toEqual({
    slug: "openai",
    ...KEY,
    updatedAt: expect.any(Number),
  })
  expect(personal && "userId" in personal).toBe(false)

  saveTeamConfig(db, { mode: "team" })
  expect(effectiveUserKey(db, "a", "openai")).toBeNull()

  db.setTeamKey("openai", KEY)
  const team = effectiveUserKey(db, "a", "openai")
  expect(team).toEqual({
    slug: "openai",
    ...KEY,
    updatedAt: expect.any(Number),
  })
  expect(effectiveUserKey(db, "a", "xai")).toBeNull()
})

test("weeklyWindowStart is UTC Monday 00:00", () => {
  expect(weeklyWindowStart(Date.UTC(2026, 9, 14, 15, 30))).toBe(
    Date.UTC(2026, 9, 12),
  )
  expect(weeklyWindowStart(Date.UTC(2026, 9, 12))).toBe(Date.UTC(2026, 9, 12))
  expect(weeklyWindowStart(Date.UTC(2026, 9, 12, 0, 0, 0, 1))).toBe(
    Date.UTC(2026, 9, 12),
  )
  expect(weeklyWindowStart(Date.UTC(2026, 9, 18, 23, 59))).toBe(
    Date.UTC(2026, 9, 12),
  )
  expect(weeklyWindowStart(Date.UTC(2026, 9, 19))).toBe(Date.UTC(2026, 9, 19))
  expect(weeklyWindowStart(Date.UTC(2026, 9, 19, 0, 0, 0, 1))).toBe(
    Date.UTC(2026, 9, 19),
  )
})

test("resolveQuota with no config and no override is unlimited", () => {
  const db = freshDb()
  const now = Date.UTC(2026, 9, 14, 12)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: null,
    used: 0,
    over: false,
    behavior: "block",
  })
})

test("resolveQuota applies the host default and counts at-cap as over", () => {
  const db = freshDb()
  const now = Date.UTC(2026, 9, 14, 12)
  const start = weeklyWindowStart(now)
  saveTeamConfig(db, { quotaDefaultTokens: 100 })
  record(db, "a", start - 1, 500)
  record(db, "a", start + 1000, 40)
  expect(userWeeklyUsage(db, "a", now)).toBe(40)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: 100,
    used: 40,
    over: false,
    behavior: "block",
  })
  record(db, "a", start + 2000, 60)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: 100,
    used: 100,
    over: true,
    behavior: "block",
  })
})

test("resolveQuota treats a zero host default as unlimited", () => {
  const db = freshDb()
  const now = Date.UTC(2026, 9, 14, 12)
  saveTeamConfig(db, { quotaDefaultTokens: 0, quotaBehavior: "block" })
  record(db, "a", now - 1000, 500)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: null,
    used: 500,
    over: false,
    behavior: "block",
  })
})

test("resolveQuota override wins: zero unlimits, a value caps", () => {
  const db = freshDb()
  const now = Date.UTC(2026, 9, 15, 9)
  const start = weeklyWindowStart(now)
  saveTeamConfig(db, { quotaDefaultTokens: 100, quotaBehavior: "warn" })
  db.setUserQuota("a", 0)
  record(db, "a", start + 1000, 400)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: null,
    used: 400,
    over: false,
    behavior: "warn",
  })
  db.setUserQuota("a", 50)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: 50,
    used: 400,
    over: true,
    behavior: "warn",
  })
  db.setUserQuota("a", null)
  expect(resolveQuota(db, "a", now)).toEqual({
    limitTokens: 100,
    used: 400,
    over: true,
    behavior: "warn",
  })
})
