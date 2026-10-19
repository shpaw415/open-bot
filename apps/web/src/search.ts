import {
  CONFIG_TAB_LABELS,
  CONFIG_TABS,
  configPath,
  HELP_PATH,
  HOME_PATH,
  workspacePath,
} from "./routes"

/**
 * Global search over data the app already has:
 * - static navigation destinations (role-aware),
 * - enabled plugin app tabs (from the shell's shared plugin list),
 * - conversations of this account (titles only),
 * - projects of this account (GET /api/projects).
 *
 * There is no server-side message-content search; the UI says so honestly.
 * Matching ignores accents and carries FR/EN aliases for destinations —
 * « paramètres » and "settings" find the same place.
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
  /** Extra FR/EN words that match this entry with the same scoring. */
  keywords?: string[]
}

export const SEARCH_GROUP_LABELS: Record<SearchGroupId, string> = {
  nav: "Navigation",
  apps: "Applications",
  threads: "Conversations",
  projects: "Projets",
}

const GROUP_ORDER: SearchGroupId[] = ["nav", "apps", "threads", "projects"]

export function searchNavEntries(role: "admin" | "user"): SearchEntry[] {
  const entries: SearchEntry[] = [
    {
      id: "nav:home",
      group: "nav",
      title: "Accueil",
      path: HOME_PATH,
      keywords: ["home", "dashboard", "demarrage", "start"],
    },
    {
      id: "nav:chat",
      group: "nav",
      title: "Conversations",
      path: workspacePath("chat"),
      keywords: ["chat", "threads", "discussions", "messages"],
    },
    {
      id: "nav:desktop",
      group: "nav",
      title: "Bureau",
      path: workspacePath("desktop"),
      keywords: ["desktop", "environment", "environnement", "vnc", "ecran"],
    },
    {
      id: "nav:projects",
      group: "nav",
      title: "Projets",
      path: workspacePath("projects"),
      keywords: ["projects", "fichiers", "files", "editeur", "ide"],
    },
    {
      id: "nav:media",
      group: "nav",
      title: "Médias",
      path: workspacePath("media"),
      keywords: ["media", "images", "videos", "3d", "coffre"],
    },
    {
      id: "nav:apps",
      group: "nav",
      title: "Applications",
      path: "/apps",
      keywords: ["apps", "plugins", "extensions", "tableau de bord"],
    },
    {
      id: "nav:automations",
      group: "nav",
      title: "Automatisations",
      path: "/automations",
      keywords: ["automations", "cron", "taches", "planifie", "rappel"],
    },
    {
      id: "nav:help",
      group: "nav",
      title: "Aide",
      path: HELP_PATH,
      keywords: ["help", "assistance", "comment", "demarrer"],
    },
    {
      id: "nav:config",
      group: "nav",
      title: "Paramètres",
      hint: "Toutes les sections",
      path: configPath(""),
      keywords: ["settings", "reglages", "configuration", "preferences"],
    },
  ]
  for (const tab of CONFIG_TABS) {
    entries.push({
      id: `nav:config:${tab}`,
      group: "nav",
      title: CONFIG_TAB_LABELS[tab],
      hint: "Paramètres",
      path: configPath(tab),
      keywords: CONFIG_TAB_KEYWORDS[tab],
    })
  }
  if (role === "admin")
    entries.push({
      id: "nav:admin",
      group: "nav",
      title: "Administration",
      path: "/admin",
      keywords: ["admin"],
    })
  return entries
}

/** fr-CA (accent-free) words that should reach each settings section. */
const CONFIG_TAB_KEYWORDS: Record<string, string[]> = {
  providers: ["services ia", "fournisseurs", "modeles", "providers"],
  keys: ["cles", "api", "secrets", "coffre", "vault"],
  chat: ["modele", "reflexion", "effort", "model", "thinking"],
  memory: ["memoire", "viking", "embeddings"],
  nav: ["system1", "navigation", "system 1", "decision"],
  media: ["image", "video", "3d", "generation"],
  voice: ["voix", "dictée", "lecture", "stt", "tts", "speech"],
  personas: ["personnalites", "assistants", "personas", "personnalites"],
  skills: ["competences", "skills"],
  plugins: ["applications", "extensions", "marketplace", "boutique"],
  mcp: ["mcp", "serveurs", "connexions avancees"],
  endpoints: ["webhooks", "publics", "endpoints", "url"],
  backup: ["sauvegarde", "restauration", "backup"],
  hardware: ["disque", "memoire vive", "cpu", "materiel"],
  reports: ["rapports", "bogues", "frictions", "bugs"],
  security: ["protection", "watchdog", "surveillance", "securite"],
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
    title: session.title?.trim() || "Nouvelle conversation",
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
    hint: "Projet",
    path: workspacePath("projects"),
    projectId: project.id,
  }))
}

/** Lowercase + accent-free so « mémo » matches "memo" and vice versa. */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
}

/**
 * Match score: lower wins. null = no match.
 * 0 prefix · 1 word-start · 2 substring/keyword — over title, then hint
 * and keywords (aliases score like the substring tier to avoid burying
 * the real title match).
 */
export function scoreSearchEntry(
  query: string,
  entry: SearchEntry,
): number | null {
  const q = normalizeSearchText(query.trim())
  if (!q) return null
  const title = normalizeSearchText(entry.title)
  if (title.startsWith(q)) return 0
  if (title.split(/[\s/:-]+/).some((word) => word.startsWith(q))) return 1
  if (title.includes(q)) return 2
  const hint = entry.hint ? normalizeSearchText(entry.hint) : ""
  if (hint.includes(q)) return 2
  for (const keyword of entry.keywords ?? []) {
    const normalized = normalizeSearchText(keyword)
    if (normalized === q || normalized.startsWith(q)) return 1
    if (normalized.includes(q)) return 2
  }
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
