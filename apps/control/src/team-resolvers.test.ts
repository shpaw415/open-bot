import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AiConfig } from "@open-bot/ai"
import { openDatabase } from "@open-bot/db"
import {
  resolveChatKeys,
  resolveDesktopProviders,
  resolveImageProvider,
  resolveSystem1,
} from "./key-vault"
import { handleLlm } from "./llm"
import { saveTeamConfig } from "./team"
import {
  applyVoicePatch,
  resolveVoiceConfig,
  voiceSharedFieldsPresent,
} from "./voice-providers"
import {
  applyWatchdogPatch,
  resolveWatchdogConfig,
  watchdogSharedFieldsPresent,
} from "./watchdog"

const KEY = {
  apiKey: "k",
  accountId: "acc",
  gatewayId: "gw",
  gatewayToken: "gt",
  gatewaySlug: "gs",
  baseUrl: "",
}

function freshDb() {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-teamr-")), "bot.sqlite"),
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
  db.createUser({
    id: "admin",
    email: "admin@localhost",
    passwordHash: "hash",
    role: "admin",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
  for (const userId of ["a", "admin"]) {
    db.ensureDesktop({
      userId,
      llmToken: `tok-${userId}`,
      opencodePassword: "p",
      vikingKey: "v",
      selectedProvider: null,
      selectedModel: null,
      thinkingEffort: null,
      lastActiveAt: 1,
    })
  }
  return db
}

function fakeAi(chat: () => unknown): AiConfig {
  return {
    models: {
      chat: { id: "chat-model" },
      small: { id: "small-model" },
      embed: { id: "embed-model" },
      vlm: { id: "vlm-model" },
    },
    api: {
      chat: async () => chat(),
      embed: async () => ({ vectors: [[]], usage: { promptTokens: 0 } }),
    },
  } as unknown as AiConfig
}

function llmRequest(userId: string) {
  return new Request("http://localhost/llm/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer tok-${userId}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "chat", messages: [] }),
  })
}

test("image resolver stays per-user in personal mode", () => {
  const db = freshDb()
  db.setImageProvider("a", {
    provider: "cloudflare-workers-ai",
    accountId: "",
    apiKey: "",
    model: "m",
  })
  db.setUserKey("a", "cloudflare", KEY)
  const resolved = resolveImageProvider(db, "a")
  expect(resolved?.keySource).toBe("vault")
  expect(resolved?.value.apiKey).toBe("k")
})

test("team mode overlays the image provider and reads team keys only", () => {
  const db = freshDb()
  db.setImageProvider("a", {
    provider: "cloudflare-workers-ai",
    accountId: "user-acct",
    apiKey: "",
    model: "user-model",
  })
  db.setUserKey("a", "cloudflare", { ...KEY, apiKey: "user-token" })
  saveTeamConfig(db, {
    mode: "team",
    providers: {
      image: {
        provider: "cloudflare-workers-ai",
        accountId: null,
        apiKey: "team-overlay-key",
        model: "team-model",
      },
    },
  })
  const overlay = resolveImageProvider(db, "a")
  expect(overlay?.value.apiKey).toBe("team-overlay-key")
  expect(overlay?.value.model).toBe("team-model")
  expect(overlay?.keySource).toBe("setup")
  saveTeamConfig(db, {
    providers: {
      image: {
        provider: "cloudflare-workers-ai",
        accountId: null,
        apiKey: null,
        model: null,
      },
    },
  })
  const noPersonalFallback = resolveImageProvider(db, "a")
  expect(noPersonalFallback?.value.apiKey).toBe("")
  expect(noPersonalFallback?.value.accountId).toBe("")
  expect(noPersonalFallback?.keySource).toBe(null)
  db.setTeamKey("cloudflare", { ...KEY, apiKey: "team-token" })
  const filled = resolveImageProvider(db, "a")
  expect(filled?.value.apiKey).toBe("team-token")
  expect(filled?.value.accountId).toBe("acc")
  expect(filled?.keySource).toBe("vault")
})

test("team mode synthesizes image from the overlay without a raw row", () => {
  const db = freshDb()
  saveTeamConfig(db, { mode: "team" })
  expect(resolveImageProvider(db, "a")).toBeNull()
  saveTeamConfig(db, {
    providers: {
      image: {
        provider: "openai",
        accountId: "team-acct",
        apiKey: "team-overlay-key",
        model: "team-model",
      },
    },
  })
  const synthesized = resolveImageProvider(db, "a")
  expect(synthesized?.value).toEqual({
    provider: "openai",
    accountId: "team-acct",
    apiKey: "team-overlay-key",
    model: "team-model",
  })
  expect(synthesized?.keySource).toBe("setup")
})

test("system1 overlay is authoritative and the raw row is ignored", () => {
  const db = freshDb()
  db.setSystem1("a", {
    provider: "cloudflare-jev",
    endpoint: "https://user.example/v1/systemone",
    apiKey: "user-key-long",
    gatewayToken: "",
    model: "user-model",
    accountId: "user-acct",
    gatewayId: "user-gw",
    slug: "jev",
  })
  saveTeamConfig(db, { mode: "team" })
  expect(resolveSystem1(db, "a")).toBeNull()
  saveTeamConfig(db, {
    providers: {
      system1: {
        provider: "cloudflare-jev",
        endpoint: "https://team.example/v1/systemone",
        apiKey: null,
        gatewayToken: null,
        model: "team-model",
        accountId: "team-acct",
        gatewayId: "team-gw",
        slug: "jev",
      },
    },
  })
  const synthesized = resolveSystem1(db, "a")
  expect(synthesized?.value.endpoint).toBe("https://team.example/v1/systemone")
  expect(synthesized?.value.model).toBe("team-model")
  expect(synthesized?.value.accountId).toBe("team-acct")
  expect(synthesized?.value.apiKey).toBe("")
  expect(synthesized?.keySource).toBe(null)
  db.setTeamKey("cloudflare", {
    ...KEY,
    apiKey: "team-cf-token",
  })
  const vaulted = resolveSystem1(db, "a")
  expect(vaulted?.value.apiKey).toBe("team-cf-token")
  expect(vaulted?.keySource).toBe("vault")
})

test("team mode serves chat keys from team_keys alone", () => {
  const db = freshDb()
  db.setUserKey("a", "openai", { ...KEY, apiKey: "user-openai" })
  expect(resolveChatKeys(db, "a")).toEqual([
    { slug: "openai", key: "user-openai" },
  ])
  saveTeamConfig(db, { mode: "team" })
  expect(resolveChatKeys(db, "a")).toEqual([])
  db.setTeamKey("openai", { ...KEY, apiKey: "team-openai" })
  db.setTeamKey("xai", { ...KEY, apiKey: "team-xai" })
  expect(resolveChatKeys(db, "a")).toEqual([
    { slug: "openai", key: "team-openai" },
    { slug: "xai", key: "team-xai" },
  ])
  expect(resolveDesktopProviders(db, "a").chatKeys).toEqual([
    { slug: "openai", key: "team-openai" },
    { slug: "xai", key: "team-xai" },
  ])
})

test("voice overlay wins the shared fields and keeps voice/language", () => {
  const db = freshDb()
  db.setVoiceConfig("a", {
    sttProvider: "openai-stt",
    sttAccountId: "user-acct",
    sttApiKey: "user-stt-key-long",
    sttModel: "whisper-1",
    ttsProvider: "openai-tts",
    ttsAccountId: "",
    ttsApiKey: "",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "onyx",
    language: "fr-CA",
  })
  db.setUserKey("a", "openai", { ...KEY, apiKey: "user-openai" })
  const personal = resolveVoiceConfig(db, "a")
  expect(personal.value.sttApiKey).toBe("user-stt-key-long")
  expect(personal.value.ttsApiKey).toBe("user-openai")
  saveTeamConfig(db, {
    mode: "team",
    providers: {
      voice: {
        sttProvider: "openai-stt",
        sttAccountId: "team-acct-32-chars-long-ok",
        sttApiKey: "team-stt-key-long-enough",
        sttModel: "whisper-1",
        ttsProvider: null,
        ttsAccountId: null,
        ttsApiKey: "team-tts-key-long-enough",
        ttsModel: null,
      },
    },
  })
  const team = resolveVoiceConfig(db, "a")
  expect(team.value.sttApiKey).toBe("team-stt-key-long-enough")
  expect(team.value.sttAccountId).toBe("team-acct-32-chars-long-ok")
  expect(team.value.sttProvider).toBe("openai-stt")
  // Fields the overlay leaves unset are unconfigured, never raw fallbacks.
  expect(team.value.ttsProvider).toBe("")
  expect(team.ttsSource).toBe("missing")
  expect(team.value.ttsApiKey).toBe("team-tts-key-long-enough")
  expect(team.value.ttsVoice).toBe("onyx")
  expect(team.value.language).toBe("fr-CA")
})

test("watchdog overlay wins shared fields; toggles stay per-user", () => {
  const db = freshDb()
  db.setWatchdogConfig("a", {
    enabled: true,
    stopOnHigh: false,
    provider: "workers-ai",
    accountId: "user-acct",
    apiKey: "",
    model: "",
    baseUrl: "",
  })
  db.setUserKey("a", "cloudflare", { ...KEY, apiKey: "user-cf-token" })
  expect(resolveWatchdogConfig(db, "a").value.apiKey).toBe("user-cf-token")
  saveTeamConfig(db, {
    mode: "team",
    providers: {
      watchdog: {
        provider: "workers-ai",
        accountId: "team-acct",
        apiKey: "team-wd-token-long",
        model: "@cf/team-model",
        baseUrl: null,
      },
    },
  })
  const resolved = resolveWatchdogConfig(db, "a")
  expect(resolved.value.enabled).toBe(true)
  expect(resolved.value.stopOnHigh).toBe(false)
  expect(resolved.value.apiKey).toBe("team-wd-token-long")
  expect(resolved.value.accountId).toBe("team-acct")
  expect(resolved.value.model).toBe("@cf/team-model")
  expect(resolved.keySource).toBe("setup")
  // An overlay cleared to nulls leaves the surface unconfigured: the raw
  // provider is not a fallback and the team vault cannot fill without one.
  saveTeamConfig(db, {
    providers: {
      watchdog: {
        provider: null,
        accountId: null,
        apiKey: null,
        model: null,
        baseUrl: null,
      },
    },
  })
  db.setTeamKey("cloudflare", { ...KEY, apiKey: "team-cf-vault-token" })
  const cleared = resolveWatchdogConfig(db, "a")
  expect(cleared.value.provider).toBe("")
  expect(cleared.value.apiKey).toBe("")
  expect(cleared.keySource).toBe("missing")
  // With an overlay provider back, the team vault fills the credentials.
  saveTeamConfig(db, {
    providers: {
      watchdog: {
        provider: "workers-ai",
        accountId: null,
        apiKey: null,
        model: null,
        baseUrl: null,
      },
    },
  })
  const vaulted = resolveWatchdogConfig(db, "a")
  expect(vaulted.value.provider).toBe("workers-ai")
  expect(vaulted.value.apiKey).toBe("team-cf-vault-token")
  expect(vaulted.value.accountId).toBe("acc")
  expect(vaulted.keySource).toBe("vault")
  expect(vaulted.value.enabled).toBe(true)
  expect(vaulted.value.stopOnHigh).toBe(false)
})

test("voice shared-field detector flags only provider fields", () => {
  expect(
    voiceSharedFieldsPresent({ tts: { voice: "onyx" }, language: "fr" }),
  ).toBe(false)
  expect(voiceSharedFieldsPresent({})).toBe(false)
  expect(voiceSharedFieldsPresent({ tts: "junk" })).toBe(false)
  expect(voiceSharedFieldsPresent({ stt: { provider: "" } })).toBe(true)
  expect(voiceSharedFieldsPresent({ tts: { apiKey: "k" } })).toBe(true)
  expect(voiceSharedFieldsPresent({ stt: { model: "m" } })).toBe(true)
})

test("watchdog shared-field detector flags only provider fields", () => {
  expect(watchdogSharedFieldsPresent({ enabled: true })).toBe(false)
  expect(watchdogSharedFieldsPresent({ stopOnHigh: false })).toBe(false)
  expect(watchdogSharedFieldsPresent({ provider: "" })).toBe(true)
  expect(watchdogSharedFieldsPresent({ baseUrl: "https://x" })).toBe(true)
  expect(watchdogSharedFieldsPresent({ model: undefined })).toBe(false)
})

const VOICE_SAVED = {
  sttProvider: "openai-stt",
  sttAccountId: "acct",
  sttApiKey: "saved-stt-key-long",
  sttModel: "whisper-1",
  ttsProvider: "openai-tts",
  ttsAccountId: "",
  ttsApiKey: "saved-tts-key-long",
  ttsModel: "gpt-4o-mini-tts",
  ttsVoice: "onyx",
  language: "fr-CA",
}

test("voice patch keeps sides absent from the body", () => {
  const patched = applyVoicePatch(VOICE_SAVED, {
    tts: { voice: "nova" },
    language: "en",
  })
  expect(patched.error).toBeNull()
  expect(patched.next).toEqual({
    ...VOICE_SAVED,
    ttsVoice: "nova",
    language: "en",
  })
})

test("voice patch rebuilds a present side and keeps the key per provider", () => {
  const patched = applyVoicePatch(VOICE_SAVED, {
    stt: { provider: "openai-stt", accountId: "a2", apiKey: "", model: "" },
    tts: {
      provider: "openai-tts",
      accountId: "",
      apiKey: "new-key-long!",
      model: "",
      voice: "",
    },
  })
  expect(patched.error).toBeNull()
  expect(patched.next.sttProvider).toBe("openai-stt")
  expect(patched.next.sttApiKey).toBe("saved-stt-key-long")
  expect(patched.next.sttAccountId).toBe("a2")
  expect(patched.next.sttModel).toBe("whisper-1")
  expect(patched.next.ttsApiKey).toBe("new-key-long!")
  expect(patched.next.ttsModel).toBe("gpt-4o-mini-tts")
  expect(patched.next.ttsVoice).toBe("alloy")
  expect(patched.next.language).toBe("fr-CA")
})

test("voice patch rejects unknown providers and accepts a language-only write", () => {
  expect(
    applyVoicePatch(VOICE_SAVED, { stt: { provider: "nope" } }).error,
  ).toBe("unsupported speech provider")
  expect(applyVoicePatch(VOICE_SAVED, { language: "de" }).next.language).toBe(
    "de",
  )
})

const WATCHDOG_SAVED = {
  enabled: true,
  stopOnHigh: false,
  provider: "workers-ai",
  accountId: "acc",
  apiKey: "saved-wd-key-long",
  model: "@cf/m",
  baseUrl: "",
}

test("watchdog patch keeps absent fields and clears on provider change", () => {
  const toggles = applyWatchdogPatch(WATCHDOG_SAVED, {
    enabled: false,
    stopOnHigh: true,
  })
  expect(toggles.error).toBeNull()
  expect(toggles.next).toEqual({
    ...WATCHDOG_SAVED,
    enabled: false,
    stopOnHigh: true,
  })
  const switched = applyWatchdogPatch(WATCHDOG_SAVED, {
    provider: "openai",
    apiKey: "",
    accountId: "",
    model: "",
  })
  expect(switched.next.provider).toBe("openai")
  expect(switched.next.apiKey).toBe("")
  expect(switched.next.accountId).toBe("")
  expect(switched.next.model).not.toBe("@cf/m")
  expect(switched.next.enabled).toBe(true)
})

test("watchdog patch rejects unknown providers and blank clears", () => {
  expect(applyWatchdogPatch(WATCHDOG_SAVED, { provider: "nope" }).error).toBe(
    "unsupported watchdog provider",
  )
  const cleared = applyWatchdogPatch(WATCHDOG_SAVED, {
    provider: "",
    apiKey: "",
    accountId: "",
    model: "",
    baseUrl: "",
  })
  expect(cleared.next.provider).toBe("")
  expect(cleared.next.enabled).toBe(true)
})

test("handleLlm blocks non-admins over quota in block mode", async () => {
  const db = freshDb()
  saveTeamConfig(db, { quotaDefaultTokens: 100, quotaBehavior: "block" })
  db.recordUsage({
    userId: "a",
    createdAt: Date.now(),
    kind: "chat",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 150,
  })
  const ai = fakeAi(() => ({
    json: { id: "resp", usage: { total_tokens: 5 } },
  }))
  const response = await handleLlm(
    llmRequest("a"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(response.status).toBe(429)
  const body = (await response.json()) as {
    error: string
    quota: { used: number; limitTokens: number }
  }
  expect(body.error).toBe("weekly quota reached")
  expect(body.quota.used).toBe(150)
  expect(body.quota.limitTokens).toBe(100)
})

test("handleLlm warns non-admins over quota in warn mode", async () => {
  const db = freshDb()
  saveTeamConfig(db, { quotaDefaultTokens: 100, quotaBehavior: "warn" })
  db.recordUsage({
    userId: "a",
    createdAt: Date.now(),
    kind: "chat",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 150,
  })
  const ai = fakeAi(() => ({
    json: { id: "resp", usage: { total_tokens: 5 } },
  }))
  const response = await handleLlm(
    llmRequest("a"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("x-open-bot-quota")).toBe("warn")
})

test("handleLlm exempts admins and clean users from quota", async () => {
  const db = freshDb()
  saveTeamConfig(db, { quotaDefaultTokens: 10, quotaBehavior: "block" })
  db.recordUsage({
    userId: "admin",
    createdAt: Date.now(),
    kind: "chat",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 500,
  })
  db.recordUsage({
    userId: "a",
    createdAt: Date.now(),
    kind: "chat",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 500,
  })
  const ai = fakeAi(() => ({
    json: { id: "resp", usage: { total_tokens: 1 } },
  }))
  const adminResponse = await handleLlm(
    llmRequest("admin"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(adminResponse.status).toBe(200)
  expect(adminResponse.headers.get("x-open-bot-quota")).toBeNull()
  const userResponse = await handleLlm(
    llmRequest("a"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(userResponse.status).toBe(429)
  db.setUserQuota("a", 0)
  const unlimited = await handleLlm(
    llmRequest("a"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(unlimited.status).toBe(200)
})
