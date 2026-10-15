import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  extractReferences,
  pluginMentionBindings,
  refreshMentionClashes,
  resolveReferenceLine,
} from "./references"

// The page-server fetch is the network seam: swap it for a controllable
// fake so tests never touch docker or a real plugin server.
let payload: unknown = { items: [] }
let fetches = 0
let failFetch = false
mock.module("./plugin-pages", () => ({
  pluginPageJson: async () => {
    fetches += 1
    if (failFetch) throw new Error("page server down")
    return payload
  },
}))

function memoryDb() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function installPluginRow(
  db: ReturnType<typeof memoryDb>,
  overrides: Record<string, unknown>,
) {
  db.createInstalledPlugin({
    id: `ip-${Math.random().toString(36).slice(2, 8)}`,
    userId: "u",
    pluginId: "stock-dashboard",
    version: "1.0.0",
    manifest: JSON.stringify({
      id: "stock-dashboard",
      name: "Stock Dashboard",
      description: "Live stock cards",
      dashboard: {
        pages: { entry: "server.ts" },
        mentions: [{ section: "stocks", label: "Stocks" }],
      },
    }),
    readme: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  })
}

describe("plugin mention bindings", () => {
  test("collects sections from enabled plugins with page servers", () => {
    const db = memoryDb()
    installPluginRow(db, {})
    const bindings = pluginMentionBindings(db, "u")
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.section).toBe("stocks")
    expect(bindings[0]?.label).toBe("Stocks")
    expect(bindings[0]?.path).toBe("/mentions")
    expect(bindings[0]?.row.pluginId).toBe("stock-dashboard")
  })

  test("skips disabled plugins and plugins without page servers", () => {
    const db = memoryDb()
    installPluginRow(db, {
      pluginId: "a",
      enabled: false,
      manifest: JSON.stringify({
        dashboard: {
          pages: { entry: "server.ts" },
          mentions: [{ section: "stocks" }],
        },
      }),
    })
    installPluginRow(db, {
      pluginId: "b",
      manifest: JSON.stringify({ dashboard: { mentions: [{ section: "x" }] } }),
    })
    expect(pluginMentionBindings(db, "u")).toEqual([])
  })

  test("first enabled plugin wins a section and reserved slugs are ignored", () => {
    const db = memoryDb()
    installPluginRow(db, {
      pluginId: "first",
      manifest: JSON.stringify({
        dashboard: {
          pages: { entry: "server.ts" },
          mentions: [{ section: "stocks", label: "First" }],
        },
      }),
    })
    installPluginRow(db, {
      pluginId: "second",
      manifest: JSON.stringify({
        dashboard: {
          pages: { entry: "server.ts" },
          mentions: [
            { section: "stocks", label: "Second" },
            { section: "plugins" },
            { section: "bonds", path: "/mentions/bonds" },
          ],
        },
      }),
    })
    const bindings = pluginMentionBindings(db, "u")
    expect(bindings.map((binding) => binding.section)).toEqual([
      "stocks",
      "bonds",
    ])
    expect(bindings[0]?.label).toBe("First")
    expect(bindings[1]?.label).toBe("bonds")
    expect(bindings[1]?.path).toBe("/mentions/bonds")
  })
})

describe("mention clash warnings", () => {
  test("records the loser and clears it when the owner is gone", () => {
    const db = memoryDb()
    installPluginRow(db, {
      id: "ip-owner",
      pluginId: "owner",
      createdAt: 1,
      manifest: JSON.stringify({
        dashboard: {
          pages: { entry: "server.ts" },
          mentions: [{ section: "stocks" }],
        },
      }),
    })
    installPluginRow(db, {
      id: "ip-loser",
      pluginId: "loser",
      createdAt: 2,
      manifest: JSON.stringify({
        dashboard: {
          pages: { entry: "server.ts" },
          mentions: [{ section: "stocks" }, { section: "bonds" }],
        },
      }),
    })
    refreshMentionClashes(db, "u")
    expect(db.installedPlugin("u", "loser")?.applied.mentionClashes).toEqual([
      { section: "stocks", owner: "owner" },
    ])
    expect(
      db.installedPlugin("u", "owner")?.applied.mentionClashes,
    ).toBeUndefined()
    db.setInstalledPluginEnabled("u", "owner", false)
    refreshMentionClashes(db, "u")
    expect(
      db.installedPlugin("u", "loser")?.applied.mentionClashes,
    ).toBeUndefined()
    expect(
      pluginMentionBindings(db, "u").map((binding) => binding.section),
    ).toEqual(["stocks", "bonds"])
  })
})

describe("plugin mention resolution", () => {
  test("resolves @section/name from the page-server payload", async () => {
    const db = memoryDb()
    installPluginRow(db, { pluginId: "resolve-ok" })
    payload = {
      items: [
        { name: "AAPL", description: "Apple Inc.", aliases: ["apple"] },
        { name: "MSFT", description: "Microsoft" },
      ],
    }
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "compare @stocks/apple and @stocks/MSFT",
    )
    expect(line).toContain(
      'Stocks "AAPL" (id AAPL): Apple Inc. — served live by the resolve-ok plugin',
    )
    expect(line).toContain("MSFT")
    expect(line).toContain("Message references:")
  })

  test("unknown and missing entries report like built-in sections", async () => {
    const db = memoryDb()
    installPluginRow(db, { pluginId: "resolve-miss" })
    payload = { items: [{ name: "AAPL" }] }
    const missing = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@stocks/nosuch",
    )
    expect(missing).toContain('no Stocks named "nosuch"')
    const db2 = memoryDb()
    installPluginRow(db2, { pluginId: "resolve-ambig" })
    payload = {
      items: [{ name: "Apple Inc" }, { name: "Apricot" }],
    }
    const ambiguous = await resolveReferenceLine(
      db2,
      { id: "u" } as never,
      "@stocks/ap",
    )
    expect(ambiguous).toContain("ambiguous; several Stocks match")
  })

  test("a down page server degrades to the unavailable line", async () => {
    const db = memoryDb()
    installPluginRow(db, { pluginId: "resolve-down" })
    failFetch = true
    try {
      const line = await resolveReferenceLine(
        db,
        { id: "u" } as never,
        "@stocks/AAPL",
      )
      expect(line).toContain("the Stocks list is unavailable right now")
    } finally {
      failFetch = false
    }
  })

  test("payloads are capped and malformed entries dropped", async () => {
    const db = memoryDb()
    installPluginRow(db, { pluginId: "cap-check" })
    payload = {
      items: [
        { name: "" },
        { name: 42 },
        { name: "x".repeat(300), aliases: ["capname"] },
        {
          name: "AAPL",
          description: "d".repeat(500),
          aliases: ["a", "b", "c", "d", "e", "f"],
          hint: "h".repeat(500),
        },
        ...Array.from({ length: 150 }, (_, index) => ({
          name: `S${index}`,
        })),
      ],
    }
    const aapl = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@stocks/capname and @stocks/AAPL",
    )
    // name truncated to 80 chars, description compacted to 199+…, hint to 200
    expect(aapl).toContain(`"${"x".repeat(80)}"`)
    expect(aapl).toContain("d".repeat(199))
    expect(aapl).not.toContain("d".repeat(200))
    expect(aapl).toContain(`${"h".repeat(200)}`)
    expect(aapl).not.toContain(`${"h".repeat(201)}`)
    // item list capped at 100 (S0..S99 kept, S100+ dropped) and aliases at 5
    const dropped = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@stocks/S149",
    )
    expect(dropped).toContain('no Stocks named "S149"')
    const aliasDropped = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@stocks/f",
    )
    expect(aliasDropped).toContain('no Stocks named "f"')
  })

  test("answers are cached briefly per plugin and path", async () => {
    const db = memoryDb()
    installPluginRow(db, { pluginId: "cache-check" })
    payload = { items: [{ name: "AAPL" }] }
    fetches = 0
    for (let index = 0; index < 3; index++) {
      await resolveReferenceLine(db, { id: "u" } as never, "@stocks/AAPL")
    }
    expect(fetches).toBe(1)
  })

  test("unknown plugin sections stay ignored", async () => {
    const db = memoryDb()
    expect(
      await resolveReferenceLine(db, { id: "u" } as never, "@nope/thing"),
    ).toBe("")
    expect(
      await resolveReferenceLine(db, { id: "u" } as never, "@unclaimed/AAPL"),
    ).toBe("")
  })
})

describe("extract references with plugin sections", () => {
  test("extra sections admit tokens the static map lacks", () => {
    expect(extractReferences("@stocks/AAPL", new Set(["stocks"]))).toEqual([
      { section: "stocks", query: "AAPL" },
    ])
    expect(extractReferences("@stocks/AAPL")).toEqual([])
  })
})
