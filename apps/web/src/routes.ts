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
  | { view: "home" }
  | { view: "help" }
  | { view: "workspace"; tab: WorkspaceTab }
  | { view: "apps" }
  | { view: "plugin"; tab: PluginTab }
  /**
   * A URL that may name a plugin page while the install list is still
   * loading. Pending is not unknown: the shell holds the URL (no redirect)
   * until the tabs arrive and the route can be decided for real.
   */
  | { view: "plugin-pending" }
  | { view: "automations" }
  | { view: "config"; tab: ConfigTab | "" }
  | { view: "admin" }
  /**
   * A loaded, real answer that this address names nothing. Never a silent
   * redirect: the page explains and offers Home / Apps / Back.
   */
  | { view: "not-found"; path: string }

export type ParsedRoute = {
  route: Route
  /**
   * Canonical URL when the given path is a legacy alias; the shell
   * replace-states to it so the address bar and the active destination
   * always agree. Undefined when the path is canonical.
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
  providers: "Services IA",
  keys: "Clés d'accès",
  chat: "Modèle et réflexion",
  memory: "Mémoire",
  nav: "Assistant de navigation",
  media: "Génération de médias",
  voice: "Voix",
  personas: "Assistants personnalisés",
  skills: "Compétences",
  plugins: "Extensions",
  mcp: "Connexions avancées (MCP)",
  endpoints: "Points d'accès publics",
  backup: "Sauvegarde",
  hardware: "Matériel",
  reports: "Rapports",
  security: "Protection de l'agent",
  cron: "Automatisations",
}

export type ConfigGroup = {
  key: string
  label: string
  tabs: (ConfigTab | LegacyConfigTab)[]
}

/** Settings grouped by goal; `cron` routes to the Automations view. */
export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: "assistant",
    label: "Assistant",
    tabs: ["chat", "personas", "memory", "skills"],
  },
  {
    key: "connexions",
    label: "Connexions",
    tabs: ["providers", "keys", "plugins", "mcp", "endpoints"],
  },
  { key: "preferences", label: "Préférences", tabs: ["media", "voice", "nav"] },
  {
    key: "avance",
    label: "Avancé",
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

/** decodeURIComponent that never throws; malformed escapes come back raw. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * True when the path is not a built-in view and could still resolve to a
 * plugin page once the install list loads: a single custom segment or a
 * two-segment plugin/tab pair.
 */
function looksLikePluginPath(segments: string[]): boolean {
  if (segments.length === 1) return !isReservedSegment(segments[0])
  return segments.length === 2 && Boolean(segments[0]) && Boolean(segments[1])
}

function isReservedSegment(segment: string): boolean {
  return (
    segment === "apps" ||
    segment === "dashboards" ||
    segment === "automations" ||
    segment === "admin" ||
    segment === "config" ||
    segment === "providers" ||
    segment === "plugins" ||
    segment === "dashboard" ||
    segment === "help" ||
    workspaceTab(segment) !== null
  )
}

/**
 * Parse a location.pathname into a route. plugin tabs are matched first so
 * a plugin id that shadows a built-in segment still wins its own page.
 *
 * `awaitingPlugins` marks the window where the session/manifests have not
 * resolved yet: a plugin-looking path parses as `plugin-pending` instead of
 * falling through to the not-found page, so a direct link or a reload on
 * /<pluginId>:<tabId> keeps its URL while the data loads.
 */
export function parseRoute(
  pathname: string,
  tabs: PluginTab[],
  options?: { awaitingPlugins?: boolean },
): ParsedRoute {
  const path = pathname.replace(/\/+$/, "") || "/"
  const segments = path.slice(1).split("/")
  const decodedSegments = segments.map(safeDecode)

  // Home is the app's default destination; /dashboard is a friendly alias.
  if (path === "/") return { route: { view: "home" } }
  if (path === "/dashboard") return { route: { view: "home" }, redirect: "/" }

  // Plugin tab pages: /<pluginId>:<tabId> or /<pluginId>/<tabId>
  if (segments.length >= 1 && tabs.length > 0) {
    const joined = safeDecode(segments.join(":"))
    const found = tabs.find(
      (tab) =>
        tab.key === joined ||
        (segments.length === 2 &&
          tab.pluginId === decodedSegments[0] &&
          tab.tabId === decodedSegments[1]),
    )
    if (found) return { route: { view: "plugin", tab: found } }
  }

  if (segments[0] === "apps" || segments[0] === "dashboards")
    return {
      route: { view: "apps" },
      redirect: segments[0] === "dashboards" ? "/apps" : undefined,
    }

  if (segments[0] === "automations") return { route: { view: "automations" } }

  if (segments[0] === "help") return { route: { view: "help" } }

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
    const head = decodedSegments[1] ?? ""
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

  const tab = workspaceTab(decodedSegments[0])
  if (tab && segments.length === 1) return { route: { view: "workspace", tab } }

  // A plugin-shaped URL with the install list still in flight: hold the URL.
  // The caller re-parses once loading settles (success, empty, or error) and
  // this same path then resolves to its plugin page or lands on not-found.
  if (options?.awaitingPlugins && looksLikePluginPath(segments))
    return { route: { view: "plugin-pending" } }

  // Anything else is a real answer: this address names nothing. The shell
  // renders the not-found page for the attempted path — no silent redirect.
  return { route: { view: "not-found", path } }
}

/** URL for a workspace tab; Conversations live at /chat (Home owns /). */
export function workspacePath(tab: WorkspaceTab): string {
  return `/${tab}`
}

export const HOME_PATH = "/"
export const CHAT_PATH = workspacePath("chat")
export const HELP_PATH = "/help"

export function configPath(tab: ConfigTab | ""): string {
  return tab ? `/config/${tab}` : "/config"
}

/** Canonical URL of a plugin dashboard tab: /<pluginId>:<tabId>. */
export function pluginPath(tab: PluginTab): string {
  return `/${tab.key}`
}
