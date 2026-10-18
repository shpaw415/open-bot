import {
  CONFIG_TAB_LABELS,
  CONFIG_TABS,
  configPath,
  workspacePath,
} from "./routes"

/**
 * Global search over data the app already has:
 * - static navigation destinations (role-aware),
 * - enabled plugin app tabs (from the shell's shared plugin list),
 * - conversations of this account (GET /api/opencode/session — titles only),
 * - projects of this account (GET /api/projects).
 *
 * There is no server-side message-content search; the UI says so honestly.
 */

export type SearchGroupId = "nav" | "apps" | "threads" | "projects"

export type SearchEntry = {
  id: string
  group: SearchGroupId
  title: string
  hint?: string
  /** In-app destination for the shell's go(). */
  path?: string
  /** Conversations open through the thread pipeline, not a path. */
  sessionId?: string
  /** Projects open through the project pipeline (id, not just the view). */
  projectId?: string
}

export const SEARCH_GROUP_LABELS: Record<SearchGroupId, string> = {
  nav: "Navigation",
  apps: "Apps",
  threads: "Threads",
  projects: "Projects",
}

const GROUP_ORDER: SearchGroupId[] = ["nav", "apps", "threads", "projects"]

export function searchNavEntries(role: "admin" | "user"): SearchEntry[] {
  const entries: SearchEntry[] = [
    {
      id: "nav:chat",
      group: "nav",
      title: "Chat",
      path: workspacePath("chat"),
    },
    {
      id: "nav:desktop",
      group: "nav",
      title: "Desktop",
      path: workspacePath("desktop"),
    },
    {
      id: "nav:projects",
      group: "nav",
      title: "Projects",
      path: workspacePath("projects"),
    },
    {
      id: "nav:media",
      group: "nav",
      title: "Media",
      path: workspacePath("media"),
    },
    { id: "nav:apps", group: "nav", title: "Apps", path: "/apps" },
    {
      id: "nav:automations",
      group: "nav",
      title: "Automations",
      path: "/automations",
    },
    {
      id: "nav:config",
      group: "nav",
      title: "Settings",
      hint: "All sections",
      path: configPath(""),
    },
  ]
  for (const tab of CONFIG_TABS) {
    entries.push({
      id: `nav:config:${tab}`,
      group: "nav",
      title: CONFIG_TAB_LABELS[tab],
      hint: "Settings",
      path: configPath(tab),
    })
  }
  if (role === "admin")
    entries.push({
      id: "nav:admin",
      group: "nav",
      title: "Admin",
      path: "/admin",
    })
  return entries
}

export function searchAppEntries(
  tabs: { key: string; title: string; pluginName: string }[],
): SearchEntry[] {
  return tabs.map((tab) => ({
    id: `app:${tab.key}`,
    group: "apps",
    title: tab.title,
    hint: tab.pluginName,
    path: `/${tab.key}`,
  }))
}

/** Titles/personas of the account's conversations (already filtered upstream). */
export function searchThreadEntries(
  sessions: { id: string; title?: string; updatedAt?: number }[],
): SearchEntry[] {
  return sessions.map((session) => ({
    id: `thread:${session.id}`,
    group: "threads",
    title: session.title?.trim() || "New thread",
    sessionId: session.id,
  }))
}

export function searchProjectEntries(
  projects: { id: string; name: string }[],
): SearchEntry[] {
  return projects.map((project) => ({
    id: `project:${project.id}`,
    group: "projects",
    title: project.name,
    hint: "Project",
    path: workspacePath("projects"),
    projectId: project.id,
  }))
}

/**
 * Match score: lower wins. null = no match.
 * 0 prefix · 1 word-start · 2 substring/keyword.
 */
export function scoreSearchEntry(
  query: string,
  entry: SearchEntry,
): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const title = entry.title.toLowerCase()
  if (title.startsWith(q)) return 0
  if (title.split(/[\s/:-]+/).some((word) => word.startsWith(q))) return 1
  if (title.includes(q)) return 2
  if (entry.hint?.toLowerCase().includes(q)) return 2
  return null
}

export type SearchGroup = {
  id: SearchGroupId
  label: string
  items: SearchEntry[]
}

/** Filter + rank, then group in stable SEARCH_GROUP order. */
export function runSearch(
  query: string,
  entries: SearchEntry[],
  limit = 24,
): SearchGroup[] {
  const scored: { entry: SearchEntry; score: number }[] = []
  for (const entry of entries) {
    const score = scoreSearchEntry(query, entry)
    if (score != null) scored.push({ entry, score })
  }
  scored.sort((a, b) => a.score - b.score)
  const groups = new Map<SearchGroupId, SearchEntry[]>()
  for (const { entry } of scored) {
    const list = groups.get(entry.group)
    if (list) list.push(entry)
    else groups.set(entry.group, [entry])
  }
  const out: SearchGroup[] = []
  let remaining = limit
  for (const id of GROUP_ORDER) {
    const items = groups.get(id)
    if (!items?.length) continue
    const sliced = items.slice(0, remaining)
    out.push({ id, label: SEARCH_GROUP_LABELS[id], items: sliced })
    remaining -= sliced.length
    if (remaining <= 0) break
  }
  return out
}

/** Empty-query landing state: destinations only, no noisy data dumps. */
export function initialSearchResults(entries: SearchEntry[]): SearchGroup[] {
  const nav = entries.filter((entry) => entry.group === "nav")
  return nav.length ? [{ id: "nav", label: "Navigation", items: nav }] : []
}

export function flattenSearchGroups(groups: SearchGroup[]): SearchEntry[] {
  return groups.flatMap((group) => group.items)
}

/** Clamped cursor move for ↑/↓ (no wrap: predictable with screen readers). */
export function moveSearchSelection(
  index: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1
  const next = index + delta
  if (next < 0) return 0
  if (next >= length) return length - 1
  return next
}
