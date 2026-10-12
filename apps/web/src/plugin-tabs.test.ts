import { describe, expect, test } from "bun:test"
import { pluginTabs } from "./plugin-tabs"
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
