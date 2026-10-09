import { expect, test } from "bun:test"
import {
  imageAuthReady,
  imageProviderById,
  imageProviders,
} from "./image-providers"

test("catalog starts with Cloudflare Workers AI and can grow", () => {
  expect(imageProviders.map((item) => item.id)).toEqual([
    "cloudflare-workers-ai",
    "xai",
    "xai-gateway",
    "openai",
    "google",
    "stability",
    "replicate",
  ])
  expect(imageProviderById("missing")).toBeUndefined()
  expect(
    imageAuthReady({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      apiKey: "tok",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    }),
  ).toBe(true)
  expect(
    imageAuthReady({
      provider: "xai",
      accountId: "",
      apiKey: "tok",
      model: "grok-imagine-image",
    }),
  ).toBe(true)
  expect(
    imageAuthReady({
      provider: "xai-gateway",
      accountId: "acct",
      apiKey: "tok",
      model: "grok-imagine-image",
    }),
  ).toBe(true)
  expect(
    imageAuthReady({
      provider: "xai-gateway",
      accountId: "",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
  expect(
    imageAuthReady({
      provider: "other",
      accountId: "acct",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
  expect(
    imageAuthReady({
      provider: "cloudflare-workers-ai",
      accountId: "",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
})
