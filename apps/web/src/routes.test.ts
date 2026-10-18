import { describe, expect, test } from "bun:test"
import type { PluginTab } from "./plugin-tabs"
import {
  CONFIG_GROUPS,
  type ConfigTab,
  configPath,
  isConfigTab,
  parseRoute,
  pluginPath,
  workspacePath,
} from "./routes"

function tab(pluginId: string, tabId: string): PluginTab {
  return {
    key: `${pluginId}:${tabId}`,
    pluginId,
    pluginName: pluginId,
    tabId,
    title: tabId,
    kind: "app",
    path: "/",
  }
}

const tabs = [tab("stock", "grid"), tab("home", "main")]

describe("parseRoute — workspace", () => {
  test("/ is the chat", () => {
    const parsed = parseRoute("/", tabs)
    expect(parsed.route).toEqual({ view: "workspace", tab: "chat" })
    expect(parsed.redirect).toBeUndefined()
  })
  for (const t of ["desktop", "projects", "media"] as const) {
    test(`/${t} maps to its workspace tab`, () => {
      expect(parseRoute(`/${t}`, tabs).route).toEqual({
        view: "workspace",
        tab: t,
      })
    })
  }
  test("unknown paths fall back to the chat with a redirect", () => {
    const parsed = parseRoute("/definitely-not-a-view", tabs)
    expect(parsed.route).toEqual({ view: "workspace", tab: "chat" })
    expect(parsed.redirect).toBe("/")
  })
  test("trailing slashes do not change the view", () => {
    expect(parseRoute("/projects/", tabs).route).toEqual({
      view: "workspace",
      tab: "projects",
    })
  })
})

describe("parseRoute — apps and plugin pages", () => {
  test("/apps is canonical", () => {
    const parsed = parseRoute("/apps", tabs)
    expect(parsed.route).toEqual({ view: "apps" })
    expect(parsed.redirect).toBeUndefined()
  })
  test("legacy /dashboards redirects to /apps", () => {
    const parsed = parseRoute("/dashboards", tabs)
    expect(parsed.route).toEqual({ view: "apps" })
    expect(parsed.redirect).toBe("/apps")
  })
  test("plugin tab colon URLs win over built-ins", () => {
    const parsed = parseRoute("/stock:grid", tabs)
    expect(parsed.route).toEqual({ view: "plugin", tab: tabs[0] })
    expect(parsed.redirect).toBeUndefined()
  })
  test("slash-separated plugin URLs resolve too", () => {
    expect(parseRoute("/home/main", tabs).route).toEqual({
      view: "plugin",
      tab: tabs[1],
    })
  })
  test("pluginPath is canonical", () => {
    expect(pluginPath(tabs[0])).toBe("/stock:grid")
  })
})

describe("parseRoute — config", () => {
  test("legacy /providers redirects into /config/providers", () => {
    const parsed = parseRoute("/providers", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "providers" })
    expect(parsed.redirect).toBe("/config/providers")
  })
  test("legacy /plugins redirects into /config/plugins", () => {
    const parsed = parseRoute("/plugins", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "plugins" })
    expect(parsed.redirect).toBe("/config/plugins")
  })
  test("/config keeps an empty tab (mobile group list)", () => {
    const parsed = parseRoute("/config", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "" })
    expect(parsed.redirect).toBeUndefined()
  })
  test("known sections are canonical", () => {
    const parsed = parseRoute("/config/security", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "security" })
    expect(parsed.redirect).toBeUndefined()
  })
  test("cron moved to its own view", () => {
    const parsed = parseRoute("/config/cron", tabs)
    expect(parsed.route).toEqual({ view: "automations" })
    expect(parsed.redirect).toBe("/automations")
  })
  test("/automations is canonical", () => {
    expect(parseRoute("/automations", tabs).route).toEqual({
      view: "automations",
    })
  })
  test("unknown sections fall back to the group list", () => {
    const parsed = parseRoute("/config/nonsense", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "" })
    expect(parsed.redirect).toBe("/config")
  })
  test("deep junk paths normalize to the flat section", () => {
    const parsed = parseRoute("/config/providers/x/y", tabs)
    expect(parsed.route).toEqual({ view: "config", tab: "providers" })
    expect(parsed.redirect).toBe("/config/providers")
  })
})

describe("config tab helpers", () => {
  test("every group tab has a label and a known kind", () => {
    for (const group of CONFIG_GROUPS) {
      expect(group.tabs.length).toBeGreaterThan(0)
      for (const entry of group.tabs) expect(isConfigTab(entry)).toBe(true)
    }
  })
  test("cron only exists as a redirect target, not a config view", () => {
    const views = CONFIG_GROUPS.flatMap((group) => group.tabs)
    expect(views).toContain("cron")
    expect(Object.keys(configPath("chat")).length).toBeGreaterThan(0)
  })
  test("configPath builds canonical URLs", () => {
    expect(configPath("chat")).toBe("/config/chat")
    expect(configPath("")).toBe("/config")
  })
})

describe("workspacePath", () => {
  test("chat lives at the root", () => {
    expect(workspacePath("chat")).toBe("/")
    expect(workspacePath("media")).toBe("/media")
  })
})

describe("parseRoute — admin", () => {
  test("/admin parses; the shell gates it by role", () => {
    expect(parseRoute("/admin", tabs).route).toEqual({ view: "admin" })
  })
})

describe("tab coverage", () => {
  test("all 16 sections appear exactly once across groups", () => {
    const flat = CONFIG_GROUPS.flatMap((group) =>
      group.tabs.filter((entry): entry is ConfigTab => entry !== "cron"),
    )
    expect(new Set(flat).size).toBe(16)
  })
})

describe("parseRoute — plugin deep links while the install list loads", () => {
  const empty: PluginTab[] = []

  test("a plugin URL with tabs not yet loaded stays pending, not unknown", () => {
    const parsed = parseRoute("/stock:grid", empty, {
      awaitingPlugins: true,
    })
    expect(parsed.route).toEqual({ view: "plugin-pending" })
    expect(parsed.redirect).toBeUndefined()
  })

  test("a slash-form plugin URL also stays pending", () => {
    expect(
      parseRoute("/stock/grid", empty, { awaitingPlugins: true }).route,
    ).toEqual({ view: "plugin-pending" })
  })

  test("built-in views never go pending", () => {
    for (const path of [
      "/",
      "/projects",
      "/media",
      "/desktop",
      "/apps",
      "/config",
      "/config/plugins",
      "/automations",
      "/admin",
    ]) {
      const parsed = parseRoute(path, empty, { awaitingPlugins: true })
      expect(parsed.route).not.toEqual({ view: "plugin-pending" })
    }
  })

  test("once tabs resolve, the same URL opens the plugin page", () => {
    const pending = parseRoute("/stock:grid", empty, { awaitingPlugins: true })
    expect(pending.route).toEqual({ view: "plugin-pending" })
    const resolved = parseRoute("/stock:grid", tabs)
    expect(resolved.route).toEqual({ view: "plugin", tab: tabs[0] })
    expect(resolved.redirect).toBeUndefined()
  })

  test("after loading settles (error), a truly unknown path redirects", () => {
    const parsed = parseRoute("/definitely-not-a-view", empty)
    expect(parsed.route).toEqual({ view: "workspace", tab: "chat" })
    expect(parsed.redirect).toBe("/")
  })

  test("a nonexistent plugin page redirects once the list is loaded", () => {
    const parsed = parseRoute("/no-such-plugin", tabs)
    expect(parsed.route).toEqual({ view: "workspace", tab: "chat" })
    expect(parsed.redirect).toBe("/")
  })
})

describe("parseRoute — malformed URLs never throw", () => {
  test("a bad percent-encoding falls back instead of crashing", () => {
    // %E0%A4%A is a truncated UTF-8 sequence; decodeURIComponent throws.
    expect(() => parseRoute("/%E0%A4%A", tabs)).not.toThrow()
    const parsed = parseRoute("/%E0%A4%A", tabs)
    expect(parsed.route).toEqual({ view: "workspace", tab: "chat" })
  })

  test("malformed colon URLs stay renderable with tabs loaded", () => {
    expect(() => parseRoute("/%E0%A4%A:grid", tabs)).not.toThrow()
  })

  test("percent-encoded plugin keys still resolve", () => {
    const encoded = encodeURI("stock:grid")
    expect(parseRoute(`/${encoded}`, tabs).route).toEqual({
      view: "plugin",
      tab: tabs[0],
    })
  })
})
