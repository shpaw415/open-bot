import { expect, test } from "bun:test"
import {
  model3dAuthReady,
  model3dProviderById,
  model3dProviders,
} from "./model3d-providers"

test("catalog lists every 3d model provider and validates auth readiness", () => {
  expect(model3dProviders.map((item) => item.id)).toEqual([
    "meshy",
    "tripo",
    "replicate",
    "fal",
  ])
  expect(model3dProviderById("missing")).toBeUndefined()
  expect(
    model3dAuthReady({
      provider: "meshy",
      accountId: "",
      apiKey: "tok",
      model: "meshy-5",
    }),
  ).toBe(true)
  expect(
    model3dAuthReady({
      provider: "tripo",
      accountId: "",
      apiKey: "tok",
      model: "latest",
    }),
  ).toBe(true)
  expect(
    model3dAuthReady({
      provider: "replicate",
      accountId: "",
      apiKey: "tok",
      model: "firtoz/trellis",
    }),
  ).toBe(true)
  expect(
    model3dAuthReady({
      provider: "fal",
      accountId: "",
      apiKey: "tok",
      model: "fal-ai/tripo/v2.5/text-to-3d",
    }),
  ).toBe(true)
  expect(
    model3dAuthReady({
      provider: "fal",
      accountId: "",
      apiKey: "",
      model: "fal-ai/tripo/v2.5/text-to-3d",
    }),
  ).toBe(false)
  expect(
    model3dAuthReady({
      provider: "other",
      accountId: "",
      apiKey: "tok",
      model: "m",
    }),
  ).toBe(false)
})
