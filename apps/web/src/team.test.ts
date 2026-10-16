import { expect, test } from "bun:test"
import type { QuotaState, TeamProviderOverlay } from "./api"
import {
  formatTokenCount,
  overlayDraft,
  overlayPatch,
  parseQuotaCapInput,
  quotaMeterView,
  TEAM_OVERLAY_SECTIONS,
  teamKeysPayload,
} from "./team"

test("quota meter hides without a limit", () => {
  expect(quotaMeterView(null)).toEqual({
    visible: false,
    severity: "info",
    text: "",
  })
  const unlimited: QuotaState = {
    limitTokens: null,
    used: 50,
    over: false,
    behavior: "block",
  }
  expect(quotaMeterView(unlimited).visible).toBe(false)
})

test("quota meter formats the weekly count", () => {
  const view = quotaMeterView({
    limitTokens: 100_000,
    used: 2500,
    over: false,
    behavior: "warn",
  })
  expect(view.visible).toBe(true)
  expect(view.severity).toBe("info")
  expect(view.text).toBe("2.5k / 100.0k tokens this week")
})

test("quota meter warns when over in warn mode", () => {
  const view = quotaMeterView({
    limitTokens: 1000,
    used: 1200,
    over: true,
    behavior: "warn",
  })
  expect(view.severity).toBe("warning")
  expect(view.text).toContain("over the weekly cap")
})

test("quota meter errors when over in block mode", () => {
  const view = quotaMeterView({
    limitTokens: 1000,
    used: 1200,
    over: true,
    behavior: "block",
  })
  expect(view.severity).toBe("error")
  expect(view.text).toContain("Sending is paused")
})

test("quota meter counts at-cap as over", () => {
  const view = quotaMeterView({
    limitTokens: 1000,
    used: 1000,
    over: true,
    behavior: "warn",
  })
  expect(view.severity).toBe("warning")
})

test("formats token counts", () => {
  expect(formatTokenCount(0)).toBe("0")
  expect(formatTokenCount(999)).toBe("999")
  expect(formatTokenCount(2500)).toBe("2.5k")
  expect(formatTokenCount(3_000_000)).toBe("3.0M")
})

test("parses quota cap input", () => {
  expect(parseQuotaCapInput("")).toEqual({ ok: true, value: null })
  expect(parseQuotaCapInput("  ")).toEqual({ ok: true, value: null })
  expect(parseQuotaCapInput("0")).toEqual({ ok: true, value: 0 })
  expect(parseQuotaCapInput(" 1234 ")).toEqual({ ok: true, value: 1234 })
  expect(parseQuotaCapInput("12.9")).toEqual({ ok: true, value: 12 })
  expect(parseQuotaCapInput("abc")).toEqual({ ok: false })
  expect(parseQuotaCapInput("-5")).toEqual({ ok: false })
})

test("team keys payload omits blank secrets and sends other blanks", () => {
  const fields = [
    { id: "apiKey" },
    { id: "accountId" },
    { id: "gatewayToken" },
    { id: "baseUrl" },
  ]
  expect(teamKeysPayload("openai", fields, { apiKey: "sk-1" })).toEqual({
    slug: "openai",
    accountId: "",
    baseUrl: "",
    apiKey: "sk-1",
  })
  expect(
    teamKeysPayload("openai", fields, { accountId: "acc", baseUrl: "u" }),
  ).toEqual({
    slug: "openai",
    accountId: "acc",
    baseUrl: "u",
  })
})

test("overlay sections cover the contract fields exactly", () => {
  const contract: Record<string, string[]> = {
    chat: ["provider", "model"],
    image: ["provider", "accountId", "apiKey", "model"],
    video: ["provider", "accountId", "apiKey", "model"],
    model3d: ["provider", "accountId", "apiKey", "model"],
    system1: [
      "provider",
      "endpoint",
      "apiKey",
      "gatewayToken",
      "model",
      "accountId",
      "gatewayId",
      "slug",
    ],
    voice: [
      "sttProvider",
      "sttAccountId",
      "sttApiKey",
      "sttModel",
      "ttsProvider",
      "ttsAccountId",
      "ttsApiKey",
      "ttsModel",
    ],
    watchdog: ["provider", "accountId", "apiKey", "model", "baseUrl"],
  }
  expect(Object.keys(contract).sort()).toEqual(
    TEAM_OVERLAY_SECTIONS.map((section) => section.section).sort(),
  )
  for (const section of TEAM_OVERLAY_SECTIONS) {
    expect(section.fields.map((field) => field.field)).toEqual(
      contract[section.section],
    )
  }
})

test("overlay draft fills blanks from the stored config", () => {
  const providers: TeamProviderOverlay = {
    chat: { provider: "openai", model: "gpt" },
    image: { provider: null, accountId: "acc", apiKey: null, model: null },
  }
  const draft = overlayDraft(providers)
  expect(draft.chat).toEqual({ provider: "openai", model: "gpt" })
  expect(draft.image).toEqual({
    provider: "",
    accountId: "acc",
    apiKey: "",
    model: "",
  })
  expect(draft.watchdog).toEqual({
    provider: "",
    accountId: "",
    apiKey: "",
    model: "",
    baseUrl: "",
  })
})

test("overlay patch clears blanks, omits blank secrets", () => {
  const patch = overlayPatch({
    chat: { provider: "", model: "gpt" },
    image: {
      provider: "cloudflare",
      accountId: "",
      apiKey: "",
      model: "flux",
    },
  })
  expect(patch.chat).toEqual({ provider: null, model: "gpt" })
  expect(patch.image).toEqual({
    provider: "cloudflare",
    accountId: null,
    model: "flux",
  } as TeamProviderOverlay["image"])
})

test("overlay patch round-trips through the draft", () => {
  const patch = overlayPatch(
    overlayDraft({
      voice: {
        sttProvider: "cloudflare",
        sttAccountId: null,
        sttApiKey: "k",
        sttModel: null,
        ttsProvider: null,
        ttsAccountId: null,
        ttsApiKey: null,
        ttsModel: "melotts",
      },
    }),
  )
  expect(patch.voice).toEqual({
    sttProvider: "cloudflare",
    sttAccountId: null,
    sttApiKey: "k",
    sttModel: null,
    ttsProvider: null,
    ttsAccountId: null,
    ttsApiKey: null,
    ttsModel: "melotts",
  })
})
