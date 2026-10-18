import type { PluginTab } from "./plugin-tabs"

/**
 * Client-side routes. The app uses history.pushState with this parser —
 * no router dependency; every branch here has a test in routes.test.ts.
 */
export type WorkspaceTab = "chat" | "desktop" | "projects" | "media"

export type ConfigTab =
  | "providers"
  | "keys"
  | "chat"
  | "memory"
  | "nav"
  | "media"
  | "voice"
  | "personas"
  | "skills"
  | "backup"
  | "plugins"
  | "mcp"
  | "endpoints"
  | "hardware"
  | "reports"
  | "security"

/** Accepted on the URL but redirected to its canonical destination. */
export type LegacyConfigTab = "cron"

export type AnyConfigTab = ConfigTab | LegacyConfigTab

export type Route =
  | { view: "workspace"; tab: WorkspaceTab }
  | { view: "apps" }
  | { view: "plugin"; tab: PluginTab }
  | { view: "automations" }
  | { view: "config"; tab: ConfigTab | "" }
  | { view: "admin" }

export type ParsedRoute = {
  route: Route
  /**
   * Canonical URL when the given path is a legacy alias or an unknown
   * variant; the shell replace-states to it so the address bar and the
   * active destination always agree. Undefined when the path is canonical.
   */
  redirect?: string
}

export const WORKSPACE_TABS: WorkspaceTab[] = [
  "chat",
  "desktop",
  "projects",
  "media",
]

export const CONFIG_TABS: ConfigTab[] = [
  "providers",
  "keys",
  "chat",
  "memory",
  "nav",
  "media",
  "voice",
  "personas",
  "skills",
  "plugins",
  "mcp",
  "endpoints",
  "backup",
  "hardware",
  "reports",
  "security",
]

export const CONFIG_TAB_LABELS: Record<AnyConfigTab, string> = {
  providers: "Providers",
  keys: "Keys",
  chat: "Chat & thinking",
  memory: "Memory",
  nav: "System1",
  media: "Media generation",
  voice: "Voice",
  personas: "Personas",
  skills: "Skills",
  plugins: "Plugins",
  mcp: "MCP",
  endpoints: "Public endpoints",
  backup: "Backup",
  hardware: "Hardware",
  reports: "Reports",
  security: "Watchdog",
  cron: "Automations",
}

export type ConfigGroup = {
  key: string
  label: string
  tabs: (ConfigTab | LegacyConfigTab)[]
}

/** Settings grouped by usage; `cron` routes to the Automations view. */
export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: "ai",
    label: "AI",
    tabs: ["providers", "keys", "chat", "memory", "nav", "media", "voice"],
  },
  { key: "behavior", label: "Behavior", tabs: ["personas", "skills"] },
  {
    key: "integrations",
    label: "Integrations",
    tabs: ["plugins", "mcp", "endpoints"],
  },
  {
    key: "ops",
    label: "Operations",
    tabs: ["cron", "backup", "hardware", "reports", "security"],
  },
]

export function isConfigTab(value: string): value is AnyConfigTab {
  return (CONFIG_TABS as string[]).includes(value) || value === "cron"
}

function workspaceTab(value: string): WorkspaceTab | null {
  return (WORKSPACE_TABS as string[]).includes(value)
    ? (value as WorkspaceTab)
    : null
}

/**
 * Parse a location.pathname into a route. plugin tabs are matched first so
 * a plugin id that shadows a built-in segment still wins its own page.
 */
export function parseRoute(pathname: string, tabs: PluginTab[]): ParsedRoute {
  const path = pathname.replace(/\/+$/, "") || "/"
  const segments = path.slice(1).split("/")

  if (path === "/") return { route: { view: "workspace", tab: "chat" } }

  // Plugin tab pages: /<pluginId>/<tabId>
  if (segments.length >= 1 && tabs.length > 0) {
    const found = tabs.find(
      (tab) =>
        tab.key === decodeURIComponent(segments.join(":")) ||
        (segments.length === 2 &&
          tab.pluginId === segments[0] &&
          tab.tabId === segments[1]),
    )
    if (found) return { route: { view: "plugin", tab: found } }
  }

  if (segments[0] === "apps" || segments[0] === "dashboards")
    return {
      route: { view: "apps" },
      redirect: segments[0] === "dashboards" ? "/apps" : undefined,
    }

  if (segments[0] === "automations") return { route: { view: "automations" } }

  if (segments[0] === "admin") return { route: { view: "admin" } }

  // Legacy flat settings paths.
  if (segments[0] === "providers" && segments.length === 1)
    return {
      route: { view: "config", tab: "providers" },
      redirect: "/config/providers",
    }
  if (segments[0] === "plugins" && segments.length === 1)
    return {
      route: { view: "config", tab: "plugins" },
      redirect: "/config/plugins",
    }

  if (segments[0] === "config") {
    const rest = segments.slice(1).join("/")
    if (rest === "") return { route: { view: "config", tab: "" } }
    // Deep junk under a known section normalizes to that section; a fully
    // unknown value falls back cleanly to the group list.
    const head = segments[1] ?? ""
    if (isConfigTab(head)) {
      if (head === "cron")
        return { route: { view: "automations" }, redirect: "/automations" }
      return {
        route: { view: "config", tab: head },
        redirect: segments.length > 2 ? `/config/${head}` : undefined,
      }
    }
    return {
      route: { view: "config", tab: "" },
      redirect: "/config",
    }
  }

  const tab = workspaceTab(segments[0])
  if (tab && segments.length === 1) return { route: { view: "workspace", tab } }

  // Anything else lands on the chat.
  return {
    route: { view: "workspace", tab: "chat" },
    redirect: path === "/" ? undefined : "/",
  }
}

/** URL for a workspace tab ("chat" lives at "/"). */
export function workspacePath(tab: WorkspaceTab): string {
  return tab === "chat" ? "/" : `/${tab}`
}

export function configPath(tab: ConfigTab | ""): string {
  return tab ? `/config/${tab}` : "/config"
}

/** Canonical URL of a plugin dashboard tab: /<pluginId>:<tabId>. */
export function pluginPath(tab: PluginTab): string {
  return `/${tab.key}`
}
