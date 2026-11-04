import { describe, expect, test } from "bun:test"
import {
  imageProviderById,
  imageProviderPublic,
  parseImageConfig,
} from "./image-providers"
import { model3dProviderById, parseModel3dConfig } from "./model3d-providers"
import {
  catalogField,
  catalogPublic,
  modelAllowed,
  parseFlatConfig,
} from "./provider-catalog"
import { system1ProviderById, system1ProviderPublic } from "./system1"
import { parseVideoConfig, videoProviderById } from "./video-providers"
import { watchdogProviderById, watchdogProviderPublic } from "./watchdog"

describe("provider catalogs", () => {
  test("only account-backed providers declare an accountId field", () => {
    const keys = (spec: { fields: readonly { key: string }[] } | undefined) => {
      if (!spec) throw new Error("expected provider spec to exist")
      return spec.fields.map((field) => field.key)
    }
    expect(keys(imageProviderById("cloudflare-workers-ai"))).toEqual([
      "accountId",
      "apiKey",
    ])
    expect(keys(imageProviderById("openai"))).toEqual(["apiKey"])
    expect(keys(videoProviderById("xai-gateway"))).toEqual([
      "accountId",
      "apiKey",
    ])
    expect(keys(videoProviderById("fal"))).toEqual(["apiKey"])
    expect(keys(model3dProviderById("meshy"))).toEqual(["apiKey"])
    expect(keys(watchdogProviderById("workers-ai"))).toEqual([
      "accountId",
      "apiKey",
    ])
    // Only the custom watchdog endpoint takes a base URL.
    expect(keys(watchdogProviderById("custom"))).toEqual(["apiKey", "baseUrl"])
    expect(keys(system1ProviderById("cloudflare-jev"))).toEqual([
      "accountId",
      "gatewayId",
      "slug",
      "endpoint",
      "apiKey",
      "gatewayToken",
    ])
    expect(keys(system1ProviderById("laya"))).toEqual(["endpoint", "apiKey"])
  })

  test("every provider offers its default model and a vault slug resolution", () => {
    for (const spec of [
      ...imageProviderPublic(),
      ...watchdogProviderPublic(),
      ...system1ProviderPublic(),
    ]) {
      if (spec.models.length > 0) {
        expect(spec.models.map((model) => model.id)).toContain(
          spec.defaultModel,
        )
      }
    }
    expect(imageProviderById("cloudflare-workers-ai")?.vaultSlug).toBe(
      "cloudflare",
    )
    expect(videoProviderById("fal")?.vaultSlug).toBe("fal")
    expect(system1ProviderById("selfhosted-clef")?.vaultSlug).toBe("")
  })

  test("parse functions build discriminated configs or null", () => {
    expect(
      parseImageConfig({
        provider: "cloudflare-workers-ai",
        accountId: "",
        apiKey: "tok",
        model: "",
      }),
    ).toBeNull()
    expect(
      parseImageConfig({
        provider: "cloudflare-workers-ai",
        accountId: "acc",
        apiKey: "tok",
        model: "",
      }),
    ).toEqual({
      provider: "cloudflare-workers-ai",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    })
    // Custom models stay legal for media providers (explicit escape hatch).
    expect(
      parseImageConfig({
        provider: "replicate",
        accountId: "",
        apiKey: "tok",
        model: "someone/brand-new-model",
      }),
    ).toEqual({
      provider: "replicate",
      apiKey: "tok",
      model: "someone/brand-new-model",
    })
    expect(
      parseVideoConfig({
        provider: "xai-gateway",
        accountId: "acc",
        apiKey: "tok",
        model: "grok-imagine-video",
      }),
    ).toEqual({
      provider: "xai-gateway",
      apiKey: "tok",
      accountId: "acc",
      model: "grok-imagine-video",
    })
    expect(
      parseModel3dConfig({
        provider: "tripo",
        accountId: "",
        apiKey: "",
        model: "latest",
      }),
    ).toBeNull()
    expect(
      parseFlatConfig([], {
        provider: "x",
        accountId: "",
        apiKey: "k",
        model: "m",
      }),
    ).toBeNull()
  })

  test("catalog helpers gate closed model lists and pass custom ones", () => {
    const image = imageProviderById("openai")
    if (!image) throw new Error("expected openai image spec")
    expect(modelAllowed(image, "gpt-image-1")).toBe(true)
    expect(modelAllowed(image, "anything-new")).toBe(true)
    expect(modelAllowed({ ...image, allowCustomModel: false }, "nope")).toBe(
      false,
    )
    expect(catalogField(image, "accountId")).toBeUndefined()
    expect(catalogPublic([image])[0]).not.toHaveProperty("secret")
    expect(catalogPublic([image])[0]?.fields[0]?.key).toBe("apiKey")
  })
})
