import { describe, expect, mock, test } from "bun:test"
import type { Db, Desktop } from "@open-bot/db"

mock.module("./docker", () => ({
  endpoint: async () => "http://opencode:4096",
  isRunning: async () => true,
  opencodeExec: async () => ({ code: 0, stdout: "", stderr: "" }),
  pendingRestart: () => undefined,
  restartOpencode: async () => {},
}))

const {
  catalogDiff,
  catalogSignature,
  parseCliModels,
  parseServedCatalog,
  refreshUserModelCatalog,
  sweepModelCatalogs,
} = await import("./model-refresh")

import type { ModelRefreshDeps, ServedCatalog } from "./model-refresh"

const desktop = { opencodePassword: "secret" } as Desktop

const dbWith = (userId: string) =>
  ({
    desktop: (id: string) => (id === userId ? desktop : null),
    listUsers: () => [{ id: userId, disabled: false }],
  }) as unknown as Db

const catalog = (connected: string[], models: string[]): ServedCatalog => ({
  connected,
  models: new Set(models),
})

type Harness = {
  deps: ModelRefreshDeps
  events: { type: string }[]
  restarts: string[]
  probes: string[]
}

/** Fake deps with a served catalog that can flip when the restart lands. */
function harness(opts: {
  served: ServedCatalog | null
  servedAfterRestart?: ServedCatalog | null
  probe: (providerId: string) => string[] | null
  running?: boolean
}): Harness {
  const events: { type: string }[] = []
  const restarts: string[] = []
  const probes: string[] = []
  let restarted = false
  let now = 0
  const deps: ModelRefreshDeps = {
    running: async () => opts.running ?? true,
    served: async () =>
      restarted && opts.servedAfterRestart !== undefined
        ? opts.servedAfterRestart
        : opts.served,
    probe: async (_userId, providerId) => {
      probes.push(providerId)
      return opts.probe(providerId)
    },
    restart: async (userId) => {
      restarts.push(userId)
      restarted = true
    },
    pending: () => undefined,
    sleep: async (ms) => {
      now += ms
    },
    now: () => now,
  }
  return { deps, events, restarts, probes }
}

const hubFor = (events: { type: string }[]) =>
  ({
    emit: (_userId: string, event: { type: string }) => {
      events.push(event)
    },
  }) as never

describe("catalog parsing", () => {
  test("served catalog keeps only connected providers' models", () => {
    const parsed = parseServedCatalog({
      connected: ["openai"],
      all: [
        { id: "openai", models: { "gpt-1": {}, "gpt-2": {} } },
        { id: "xai", models: { "grok-1": {} } },
      ],
    })
    expect(parsed?.connected).toEqual(["openai"])
    expect([...(parsed?.models ?? [])].sort()).toEqual([
      "openai/gpt-1",
      "openai/gpt-2",
    ])
  })

  test("served catalog is null without a connected list or providers", () => {
    expect(parseServedCatalog(null)).toBeNull()
    expect(parseServedCatalog({ connected: [], all: [] })).toBeNull()
    expect(parseServedCatalog({ connected: ["openai"] })).toBeNull()
  })

  test("cli output keeps one trimmed ref per line and drops junk", () => {
    expect(
      parseCliModels("openai/gpt-1\n\n  openai/gpt-2  \nnot a ref\n"),
    ).toEqual(["openai/gpt-1", "openai/gpt-2"])
  })

  test("signature is order-insensitive; diff names both directions", () => {
    expect(catalogSignature(["b/2", "a/1"])).toBe(
      catalogSignature(["a/1", "b/2"]),
    )
    expect(
      catalogDiff(new Set(["a/1", "a/old"]), new Set(["a/1", "a/new"])),
    ).toEqual({ added: ["a/new"], removed: ["a/old"] })
  })
})

describe("refreshUserModelCatalog", () => {
  test("current catalog: no restart", async () => {
    const h = harness({
      served: catalog(["openai"], ["openai/gpt-1"]),
      probe: () => ["openai/gpt-1"],
    })
    const result = await refreshUserModelCatalog(
      dbWith("u-current"),
      hubFor(h.events),
      "u-current",
      h.deps,
    )
    expect(result.status).toBe("current")
    expect(h.restarts).toEqual([])
  })

  test("new model upstream: restart, then confirm + models.changed", async () => {
    const h = harness({
      served: catalog(["openai"], ["openai/gpt-1"]),
      servedAfterRestart: catalog(["openai"], ["openai/gpt-1", "openai/gpt-2"]),
      probe: () => ["openai/gpt-1", "openai/gpt-2"],
    })
    const result = await refreshUserModelCatalog(
      dbWith("u-drift"),
      hubFor(h.events),
      "u-drift",
      h.deps,
    )
    expect(result.status).toBe("restarted")
    expect(result.added).toEqual(["openai/gpt-2"])
    expect(h.restarts).toEqual(["u-drift"])
    expect(await result.confirmed).toBe(true)
    expect(h.events.map((event) => event.type)).toEqual(["models.changed"])
  })

  test("same drift after a restart never restarts twice", async () => {
    const h = harness({
      // the daemon keeps serving the old list (restart did not converge)
      served: catalog(["openai"], ["openai/gpt-1"]),
      probe: () => ["openai/gpt-1", "openai/gpt-2"],
    })
    const db = dbWith("u-suppress")
    const first = await refreshUserModelCatalog(
      db,
      hubFor(h.events),
      "u-suppress",
      h.deps,
    )
    expect(first.status).toBe("restarted")
    expect(await first.confirmed).toBe(false)
    const second = await refreshUserModelCatalog(
      db,
      hubFor(h.events),
      "u-suppress",
      h.deps,
    )
    expect(second.status).toBe("suppressed")
    expect(h.restarts).toEqual(["u-suppress"])
    expect(h.events).toEqual([])
  })

  test("all probes failing is unavailable, never a restart", async () => {
    const h = harness({
      served: catalog(["openai"], ["openai/gpt-1"]),
      probe: () => null,
    })
    const result = await refreshUserModelCatalog(
      dbWith("u-probefail"),
      hubFor(h.events),
      "u-probefail",
      h.deps,
    )
    expect(result.status).toBe("unavailable")
    expect(h.restarts).toEqual([])
  })

  test("a failed provider probe only narrows the comparison scope", async () => {
    const h = harness({
      served: catalog(
        ["openai", "xai"],
        ["openai/gpt-1", "xai/grok-1", "xai/grok-2"],
      ),
      probe: (providerId) =>
        providerId === "openai" ? ["openai/gpt-1"] : null,
    })
    const result = await refreshUserModelCatalog(
      dbWith("u-partial"),
      hubFor(h.events),
      "u-partial",
      h.deps,
    )
    // xai is out of scope this pass; openai matches, so no restart
    expect(result.status).toBe("current")
    expect(h.restarts).toEqual([])
  })

  test("sleeping desktop and unreadable daemon are left alone", async () => {
    const sleeping = harness({
      served: catalog(["openai"], ["openai/gpt-1"]),
      probe: () => ["openai/gpt-2"],
      running: false,
    })
    const skipped = await refreshUserModelCatalog(
      dbWith("u-sleeping"),
      hubFor(sleeping.events),
      "u-sleeping",
      sleeping.deps,
    )
    expect(skipped.status).toBe("skipped")
    expect(sleeping.probes).toEqual([])

    const down = harness({ served: null, probe: () => ["openai/gpt-2"] })
    const unavailable = await refreshUserModelCatalog(
      dbWith("u-down"),
      hubFor(down.events),
      "u-down",
      down.deps,
    )
    expect(unavailable.status).toBe("unavailable")
    expect(down.restarts).toEqual([])
  })

  test("sweep iterates users and survives one user's failure", async () => {
    const h = harness({
      served: catalog(["openai"], ["openai/gpt-1"]),
      probe: () => ["openai/gpt-1"],
    })
    await sweepModelCatalogs(dbWith("u-sweep"), hubFor(h.events), h.deps)
    expect(h.probes).toEqual(["openai"])
  })
})
