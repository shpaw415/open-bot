import { afterEach, describe, expect, mock, test } from "bun:test"
import type { Db, Desktop } from "@open-bot/db"

mock.module("./docker", () => ({
  endpoint: async () => "http://opencode:4096",
}))

const { applyThinkingEffort, clearModelVariants, supportsEffort } =
  await import("./effort")

const desktop = (effort: string | null): Desktop =>
  ({
    userId: "user-1",
    llmToken: "t",
    opencodePassword: "pw",
    vikingKey: "v",
    selectedProvider: "prov",
    selectedModel: "default-model",
    thinkingEffort: effort,
    lastActiveAt: 1,
  }) as Desktop

const dbWith = (effort: string | null) =>
  ({
    desktop: (id: string) => (id === "user-1" ? desktop(effort) : null),
  }) as Db

const PROVIDER_BODY = {
  connected: ["prov"],
  all: [
    {
      id: "prov",
      models: {
        "reasoning-model": {
          name: "Reasoning",
          variants: { low: {}, medium: {}, high: {} },
        },
        "plain-model": { name: "Plain", variants: {} },
        "default-model": { name: "Default", variants: { low: {} } },
      },
    },
  ],
}

const originalFetch = globalThis.fetch
let providerCalls = 0
let providerOk = true

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === "http://opencode:4096/provider") {
      providerCalls += 1
      if (!providerOk) return new Response("boom", { status: 500 })
      return Response.json(PROVIDER_BODY)
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  providerCalls = 0
  providerOk = true
  clearModelVariants("user-1")
})

describe("supportsEffort", () => {
  test("matches variants for the exact model key", () => {
    const map = new Map([
      ["prov/model", ["low", "high"]],
      ["other/model", []],
    ])
    expect(supportsEffort(map, "prov", "model", "high")).toBe(true)
    expect(supportsEffort(map, "prov", "model", "medium")).toBe(false)
    expect(supportsEffort(map, "prov", "missing", "low")).toBe(false)
  })
})

describe("applyThinkingEffort", () => {
  test("stamps the saved effort when the body model supports it", async () => {
    installFetch()
    const body: Record<string, unknown> = {
      parts: [],
      model: { providerID: "prov", modelID: "reasoning-model" },
    }
    await applyThinkingEffort(dbWith("high"), "user-1", body)
    expect(body.variant).toBe("high")
    expect(providerCalls).toBe(1)
  })

  test("falls back to the desktop default model", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyThinkingEffort(dbWith("low"), "user-1", body)
    expect(body.variant).toBe("low")
  })

  test("skips an effort the model does not support", async () => {
    installFetch()
    const body: Record<string, unknown> = {
      parts: [],
      model: { providerID: "prov", modelID: "plain-model" },
    }
    await applyThinkingEffort(dbWith("high"), "user-1", body)
    expect(body.variant).toBeUndefined()
  })

  test("skips when no effort is saved", async () => {
    installFetch()
    const body: Record<string, unknown> = {
      parts: [],
      model: { providerID: "prov", modelID: "reasoning-model" },
    }
    await applyThinkingEffort(dbWith(null), "user-1", body)
    expect(body.variant).toBeUndefined()
    expect(providerCalls).toBe(0)
  })

  test("skips when the desktop is missing", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyThinkingEffort(dbWith("high"), "someone-else", body)
    expect(body.variant).toBeUndefined()
    expect(providerCalls).toBe(0)
  })

  test("fails open when the provider list is unavailable", async () => {
    installFetch()
    providerOk = false
    const body: Record<string, unknown> = { parts: [] }
    await applyThinkingEffort(dbWith("high"), "user-1", body)
    expect(body.variant).toBeUndefined()
  })

  test("caches the provider list and clears on demand", async () => {
    installFetch()
    const first: Record<string, unknown> = { parts: [] }
    const second: Record<string, unknown> = { parts: [] }
    await applyThinkingEffort(dbWith("low"), "user-1", first)
    await applyThinkingEffort(dbWith("low"), "user-1", second)
    expect(providerCalls).toBe(1)
    clearModelVariants("user-1")
    const third: Record<string, unknown> = { parts: [] }
    await applyThinkingEffort(dbWith("low"), "user-1", third)
    expect(providerCalls).toBe(2)
    expect(third.variant).toBe("low")
  })
})
