import { describe, expect, test } from "bun:test"
import {
  favoriteTabs,
  parseFavorites,
  parseRecents,
  pushRecent,
  recentTabs,
  toggleFavorite,
} from "./apps-grid"
import type { PluginTab } from "./plugin-tabs"

function tab(key: string, pluginId = "stock", pluginName = "Stock"): PluginTab {
  return {
    key,
    pluginId,
    pluginName,
    tabId: key.split(":")[1] ?? key,
    title: key,
    kind: "page",
  }
}

describe("parseFavorites", () => {
  test("null, invalid JSON and non-arrays read as no favorites", () => {
    expect(parseFavorites(null)).toEqual([])
    expect(parseFavorites("not json")).toEqual([])
    expect(parseFavorites('{"a":1}')).toEqual([])
  })

  test("keeps unique non-empty strings in stored order", () => {
    expect(parseFavorites('["b:2", 3, "a:1", "b:2", ""]')).toEqual([
      "b:2",
      "a:1",
    ])
  })
})

describe("toggleFavorite", () => {
  test("appends a new favorite and removes an existing one", () => {
    expect(toggleFavorite(["a:1"], "b:2")).toEqual(["a:1", "b:2"])
    expect(toggleFavorite(["a:1", "b:2"], "a:1")).toEqual(["b:2"])
  })
})

describe("favoriteTabs", () => {
  test("orders by the favorites list and drops uninstalled keys", () => {
    const tabs = [tab("stock:grid"), tab("stock:leads")]
    expect(
      favoriteTabs(tabs, ["gone:x", "stock:leads", "stock:grid"]).map(
        (entry) => entry.key,
      ),
    ).toEqual(["stock:leads", "stock:grid"])
  })
})

describe("recents", () => {
  test("parseRecents sorts newest first and dedupes by key", () => {
    expect(
      parseRecents(
        JSON.stringify([
          { key: "stock:grid", at: 10 },
          { key: "stock:leads", at: 30 },
          { key: "stock:grid", at: 20 },
          { key: 3, at: 40 },
          { key: "bad", at: Number.NaN },
        ]),
      ),
    ).toEqual([
      { key: "stock:leads", at: 30 },
      { key: "stock:grid", at: 20 },
    ])
  })

  test("pushRecent moves an existing key to the front", () => {
    const recents = pushRecent([{ key: "stock:grid", at: 1 }], "stock:leads", 2)
    expect(pushRecent(recents, "stock:grid", 3)).toEqual([
      { key: "stock:grid", at: 3 },
      { key: "stock:leads", at: 2 },
    ])
  })

  test("recentTabs follows recent order, drops stale keys and caps", () => {
    const tabs = [tab("stock:grid"), tab("stock:leads"), tab("stock:pnl")]
    const recents = [
      { key: "gone:x", at: 4 },
      { key: "stock:pnl", at: 3 },
      { key: "stock:grid", at: 2 },
      { key: "stock:leads", at: 1 },
    ]
    expect(recentTabs(tabs, recents, 2).map((entry) => entry.key)).toEqual([
      "stock:pnl",
      "stock:grid",
    ])
  })
})
