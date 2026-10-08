import { expect, test } from "bun:test"
import {
  videoAuthReady,
  videoModelCatalog,
  videoModelLooksLikeImage,
  videoModelMatchesProvider,
  videoProviderById,
  videoProviders,
} from "./video-providers"

test("video model catalog covers every provider and matches its defaults", () => {
  for (const provider of videoProviders) {
    const models = videoModelCatalog[provider.id]
    expect(Array.isArray(models)).toBe(true)
    expect(models.length).toBeGreaterThan(0)
    expect(models).toContain(provider.defaultModel)
    for (const model of models) {
      expect(videoModelLooksLikeImage(model)).toBe(false)
      expect(videoModelMatchesProvider(provider.id, model)).toBe(true)
    }
  }
})

test("detects image models and provider mismatches", () => {
  expect(videoModelLooksLikeImage("grok-imagine-image-2.0")).toBe(true)
  expect(videoModelLooksLikeImage("dall-e-3")).toBe(true)
  expect(videoModelLooksLikeImage("flux-1.1-pro")).toBe(true)
  expect(videoModelLooksLikeImage("grok-imagine-video-1.5")).toBe(false)
  expect(
    videoModelMatchesProvider("xai-gateway", "grok-imagine-image-2.0"),
  ).toBe(false)
  expect(videoModelMatchesProvider("xai", "sora-2")).toBe(false)
  expect(videoModelMatchesProvider("openai", "sora-2")).toBe(true)
  expect(videoModelMatchesProvider("unknown-provider", "anything")).toBe(true)
})

test("catalog lists every video provider and validates auth readiness", () => {
  expect(videoProviders.map((item) => item.id)).toEqual([
    "xai",
    "xai-gateway",
    "openai",
    "google",
    "replicate",
    "fal",
  ])
  expect(videoProviderById("missing")).toBeUndefined()
  expect(
    videoAuthReady({
      provider: "xai",
      accountId: "",
      apiKey: "tok",
      model: "grok-imagine-video-1.5",
    }),
  ).toBe(true)
  expect(
    videoAuthReady({
      provider: "xai-gateway",
      accountId: "acct",
      apiKey: "tok",
      model: "grok-imagine-video-1.5",
    }),
  ).toBe(true)
  expect(
    videoAuthReady({
      provider: "xai-gateway",
      accountId: "",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
  expect(
    videoAuthReady({
      provider: "openai",
      accountId: "",
      apiKey: "tok",
      model: "sora-2",
    }),
  ).toBe(true)
  expect(
    videoAuthReady({
      provider: "google",
      accountId: "",
      apiKey: "tok",
      model: "veo-3.0-fast-generate-001",
    }),
  ).toBe(true)
  expect(
    videoAuthReady({
      provider: "replicate",
      accountId: "",
      apiKey: "tok",
      model: "google/veo-3-fast",
    }),
  ).toBe(true)
  expect(
    videoAuthReady({
      provider: "fal",
      accountId: "",
      apiKey: "",
      model: "fal-ai/veo3",
    }),
  ).toBe(false)
  expect(
    videoAuthReady({
      provider: "other",
      accountId: "",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
})
