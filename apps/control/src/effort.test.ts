import { afterEach, describe, expect, mock, test } from "bun:test"
import type { Db, Desktop } from "@open-bot/db"

mock.module("./docker", () => ({
  endpoint: async () => "http://opencode:4096",
}))

const {
  applyModelChoice,
  applyThinkingEffort,
  applyThreadModelChoice,
  clearModelVariants,
  resolveThreadModel,
  supportsEffort,
  validateModelChoice,
} = await import("./effort")

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

type ThreadRow = {
  sessionId: string
  providerId: string | null
  modelId: string | null
  effort: string | null
}

const dbWithThread = (effort: string | null, row: ThreadRow | null) =>
  ({
    desktop: (id: string) => (id === "user-1" ? desktop(effort) : null),
    threadModel: (userId: string, sessionId: string) =>
      userId === "user-1" && row && row.sessionId === sessionId
        ? { userId, ...row }
        : null,
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

  test("an explicit model pick re-targets the saved effort check", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    // Saved effort "high" does not exist on the desktop default model
    // (variants: low) but does on the picked reasoning model.
    await applyModelChoice(dbWith("high"), "user-1", body, {
      providerID: "prov",
      modelID: "reasoning-model",
      effort: null,
    })
    expect(body.model).toEqual({
      providerID: "prov",
      modelID: "reasoning-model",
    })
    expect(body.variant).toBe("high")
  })

  test("an explicit effort wins over the saved one", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyModelChoice(dbWith("low"), "user-1", body, {
      providerID: "prov",
      modelID: "reasoning-model",
      effort: "medium",
    })
    expect(body.variant).toBe("medium")
  })

  test("no pick behaves exactly like the saved-effort stamp", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyModelChoice(dbWith("low"), "user-1", body, null)
    expect(body.model).toBeUndefined()
    expect(body.variant).toBe("low")
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

describe("validateModelChoice", () => {
  test("accepts a connected model with one of its effort levels", async () => {
    installFetch()
    expect(
      await validateModelChoice(dbWith(null), "user-1", {
        providerID: "prov",
        modelID: "reasoning-model",
        effort: "high",
      }),
    ).toBeNull()
  })

  test("refuses an unknown model and points at the models list", async () => {
    installFetch()
    const error = await validateModelChoice(dbWith(null), "user-1", {
      providerID: "prov",
      modelID: "nope",
      effort: null,
    })
    expect(error).toMatch(/unknown model "prov\/nope"/)
    expect(error).toMatch(/ob-thread models/)
  })

  test("refuses an effort level the picked model does not offer", async () => {
    installFetch()
    const error = await validateModelChoice(dbWith(null), "user-1", {
      providerID: "prov",
      modelID: "reasoning-model",
      effort: "xhigh",
    })
    expect(error).toMatch(
      /effort "xhigh" is not available on prov\/reasoning-model/,
    )
    expect(error).toMatch(/low, medium, high/)
  })

  test("refuses any effort on a model without levels", async () => {
    installFetch()
    const error = await validateModelChoice(dbWith(null), "user-1", {
      providerID: "prov",
      modelID: "plain-model",
      effort: "high",
    })
    expect(error).toMatch(/no reasoning effort levels/)
  })

  test("an effort-only pick is checked against the desktop default model", async () => {
    installFetch()
    expect(
      await validateModelChoice(dbWith(null), "user-1", {
        providerID: null,
        modelID: null,
        effort: "low",
      }),
    ).toBeNull()
    expect(
      await validateModelChoice(dbWith(null), "user-1", {
        providerID: null,
        modelID: null,
        effort: "high",
      }),
    ).toMatch(/prov\/default-model/)
  })

  test("fails open when the provider list is unavailable", async () => {
    installFetch()
    providerOk = false
    expect(
      await validateModelChoice(dbWith(null), "user-1", {
        providerID: "prov",
        modelID: "nope",
        effort: "xhigh",
      }),
    ).toBeNull()
  })

  test("no pick needs no provider round trip", async () => {
    installFetch()
    expect(await validateModelChoice(dbWith(null), "user-1", null)).toBeNull()
    expect(providerCalls).toBe(0)
  })
})

describe("resolveThreadModel", () => {
  const fallback = {
    providerID: "prov",
    modelID: "default-model",
    thinkingEffort: "low",
  }

  test("no row resolves to the desktop fallback", () => {
    expect(resolveThreadModel(null, fallback)).toEqual({
      providerID: "prov",
      modelID: "default-model",
      thinkingEffort: "low",
      thread: null,
    })
  })

  test("each half falls back independently", () => {
    const modelOnly = resolveThreadModel(
      { providerId: "prov", modelId: "reasoning-model", effort: null },
      fallback,
    )
    expect(modelOnly.modelID).toBe("reasoning-model")
    expect(modelOnly.thinkingEffort).toBe("low")
    const effortOnly = resolveThreadModel(
      { providerId: null, modelId: null, effort: "high" },
      fallback,
    )
    expect(effortOnly.modelID).toBe("default-model")
    expect(effortOnly.thinkingEffort).toBe("high")
  })

  test("a half-written model pair counts as no model pick", () => {
    const resolved = resolveThreadModel(
      { providerId: "prov", modelId: null, effort: null },
      fallback,
    )
    expect(resolved.modelID).toBe("default-model")
    expect(resolved.thread?.providerID).toBeNull()
  })
})

describe("applyThreadModelChoice", () => {
  const row: ThreadRow = {
    sessionId: "ses_a",
    providerId: "prov",
    modelId: "reasoning-model",
    effort: "high",
  }

  test("stamps the thread's stored model + effort when the body has none", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyThreadModelChoice(
      dbWithThread("low", row),
      "user-1",
      "ses_a",
      body,
    )
    expect(body.model).toEqual({
      providerID: "prov",
      modelID: "reasoning-model",
    })
    // The thread effort wins over the desktop's saved "low".
    expect(body.variant).toBe("high")
  })

  test("another thread never inherits the pick (the reported bug)", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyThreadModelChoice(
      dbWithThread("low", row),
      "user-1",
      "ses_b",
      body,
    )
    expect(body.model).toBeUndefined()
    // Only the desktop-default effort stamp remains.
    expect(body.variant).toBe("low")
  })

  test("an explicit body model wins over the stored pick", async () => {
    installFetch()
    const body: Record<string, unknown> = {
      parts: [],
      model: { providerID: "prov", modelID: "plain-model" },
    }
    await applyThreadModelChoice(
      dbWithThread(null, row),
      "user-1",
      "ses_a",
      body,
    )
    expect(body.model).toEqual({ providerID: "prov", modelID: "plain-model" })
    // The stored "high" effort was validated for reasoning-model, not for
    // plain-model (no levels) — it must not ride onto the other model.
    expect(body.variant).toBeUndefined()
  })

  test("no stored pick behaves like the desktop effort stamp", async () => {
    installFetch()
    const body: Record<string, unknown> = { parts: [] }
    await applyThreadModelChoice(
      dbWithThread("low", null),
      "user-1",
      "ses_a",
      body,
    )
    expect(body.model).toBeUndefined()
    expect(body.variant).toBe("low")
  })

  test("an effort-only pick overrides the desktop effort on the default model", async () => {
    installFetch()
    const body: Record<string, unknown> = {
      parts: [],
      model: { providerID: "prov", modelID: "reasoning-model" },
    }
    await applyThreadModelChoice(
      dbWithThread("low", { ...row, providerId: null, modelId: null }),
      "user-1",
      "ses_a",
      body,
    )
    expect(body.variant).toBe("high")
  })
})
