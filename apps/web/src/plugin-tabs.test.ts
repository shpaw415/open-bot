import { describe, expect, test } from "bun:test"
import {
  appTabFrameProps,
  appTabSandbox,
  filterTabs,
  pluginTabs,
} from "./plugin-tabs"
import type { InstalledPluginInfo } from "./plugin-ui"

function plugin(
  pluginId: string,
  name: string,
  tabs: InstalledPluginInfo["manifest"]["dashboard"],
): InstalledPluginInfo {
  return {
    id: pluginId,
    pluginId,
    version: "1.0.0",
    name,
    description: "",
    author: "",
    repo: "",
    enabled: true,
    permissions: [],
    manifest: { dashboard: tabs },
    readme: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe("pluginTabs", () => {
  test("maps app and live page tabs with plugin names", () => {
    const off = plugin("off", "Off", {
      tabs: [{ id: "y", title: "Y", kind: "app" }],
    })
    off.enabled = false
    const tabs = pluginTabs([
      plugin("stock-pro", "Stock Pro", {
        pages: { entry: "server.js" },
        tabs: [
          { id: "stock", title: "Stock", kind: "app", path: "/manage" },
          {
            id: "summary",
            title: "Summary",
            kind: "page",
            dataUrl: "/api/summary",
            pollSeconds: 15,
            cards: [],
          },
        ],
      }),
      plugin("idle", "Idle", {
        tabs: [{ id: "x", title: "X", kind: "page", cards: [] }],
      }),
      off,
    ])
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toMatchObject({
      key: "stock-pro:stock",
      pluginId: "stock-pro",
      pluginName: "Stock Pro",
      kind: "app",
      path: "/manage",
    })
    expect(tabs[1]).toMatchObject({
      key: "stock-pro:summary",
      kind: "page",
      dataUrl: "/api/summary",
      pollSeconds: 15,
    })
    expect(tabs.some((tab) => tab.pluginId === "off")).toBe(false)
  })
})

describe("filterTabs", () => {
  const tabs = pluginTabs([
    plugin("stock-pro", "Stock Pro", {
      pages: { entry: "server.js" },
      tabs: [
        { id: "stock", title: "Stock", kind: "app", path: "/manage" },
        { id: "summary", title: "Summary", kind: "page", cards: [] },
      ],
    }),
    plugin("media", "Media Vault", {
      tabs: [{ id: "vault", title: "Vault", kind: "page", cards: [] }],
    }),
  ])

  test("empty or blank query returns all tabs", () => {
    expect(filterTabs(tabs, "")).toHaveLength(3)
    expect(filterTabs(tabs, "")).toBe(tabs)
    expect(filterTabs(tabs, "   ")).toHaveLength(3)
    expect(filterTabs(tabs, "   ")).toBe(tabs)
  })

  test("query is trimmed before matching", () => {
    expect(filterTabs(tabs, "  summa  ")).toHaveLength(1)
  })

  test("matches tab titles case-insensitively", () => {
    expect(filterTabs(tabs, "summa").map((tab) => tab.key)).toEqual([
      "stock-pro:summary",
    ])
    expect(filterTabs(tabs, "SUMMARY")).toHaveLength(1)
  })

  test("matches plugin names too", () => {
    expect(filterTabs(tabs, "media").map((tab) => tab.key)).toEqual([
      "media:vault",
    ])
    expect(filterTabs(tabs, "STOCK PRO")).toHaveLength(2)
  })

  test("no match returns an empty list", () => {
    expect(filterTabs(tabs, "zzz")).toEqual([])
  })

  test("same-host app frames do not keep the dashboard origin", () => {
    expect(appTabSandbox(false)).not.toContain("allow-same-origin")
    expect(appTabSandbox(true)).toContain("allow-same-origin")
  })

  test("app frames delegate device permissions regardless of embed mode", () => {
    for (const isolated of [false, true]) {
      const props = appTabFrameProps(isolated)
      expect(props.allow).toContain("microphone 'src'")
      expect(props.allow).toContain("camera 'src'")
      expect(props.allow).toContain("autoplay 'src'")
      expect(props.allow).not.toContain("*")
    }
    expect(appTabFrameProps(false).sandbox).toBe(appTabSandbox(false))
  })
})
