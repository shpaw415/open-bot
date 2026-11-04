// State behind the desktop Apps launcher grid: favorite apps and recently
// opened ones, kept per browser in localStorage (same device-local grain as
// the split-screen pairing). Stale keys — an app uninstalled or disabled
// since — are dropped at read time, never rendered.
import type { PluginTab } from "./plugin-tabs"

export const APPS_FAVORITES_KEY = "ob-apps-favorites"
export const APPS_RECENTS_KEY = "ob-apps-recents"

/** Tiles shown in the launcher's Récents section. */
export const APPS_RECENT_LIMIT = 6
const RECENT_STORE_CAP = 12
const FAVORITE_CAP = 100

export type AppRecent = { key: string; at: number }

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const keys: string[] = []
    for (const entry of parsed) {
      if (typeof entry !== "string" || entry.length === 0) continue
      if (seen.has(entry)) continue
      seen.add(entry)
      keys.push(entry)
      if (keys.length >= FAVORITE_CAP) break
    }
    return keys
  } catch {
    return []
  }
}

export function toggleFavorite(favorites: string[], key: string): string[] {
  return favorites.includes(key)
    ? favorites.filter((entry) => entry !== key)
    : [...favorites, key]
}

/** Favorite tabs in the order they were starred; stale keys drop out. */
export function favoriteTabs(
  tabs: PluginTab[],
  favorites: string[],
): PluginTab[] {
  const byKey = new Map(tabs.map((tab) => [tab.key, tab]))
  return favorites.flatMap((key) => {
    const tab = byKey.get(key)
    return tab ? [tab] : []
  })
}

export function parseRecents(raw: string | null): AppRecent[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const newest = new Map<string, number>()
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue
      const { key, at } = entry as { key?: unknown; at?: unknown }
      if (typeof key !== "string" || key.length === 0) continue
      if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) continue
      if (at > (newest.get(key) ?? 0)) newest.set(key, at)
    }
    return [...newest.entries()]
      .map(([key, at]) => ({ key, at }))
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT_STORE_CAP)
  } catch {
    return []
  }
}

export function pushRecent(
  recents: AppRecent[],
  key: string,
  at: number,
): AppRecent[] {
  return [{ key, at }, ...recents.filter((entry) => entry.key !== key)].slice(
    0,
    RECENT_STORE_CAP,
  )
}

/** Recently opened tabs, newest first; stale keys drop out. */
export function recentTabs(
  tabs: PluginTab[],
  recents: AppRecent[],
  limit = APPS_RECENT_LIMIT,
): PluginTab[] {
  const byKey = new Map(tabs.map((tab) => [tab.key, tab]))
  return recents
    .flatMap((entry) => {
      const tab = byKey.get(entry.key)
      return tab ? [tab] : []
    })
    .slice(0, limit)
}

export function readFavorites(): string[] {
  try {
    return parseFavorites(localStorage.getItem(APPS_FAVORITES_KEY))
  } catch {
    return []
  }
}

export function writeFavorites(favorites: string[]): void {
  try {
    localStorage.setItem(APPS_FAVORITES_KEY, JSON.stringify(favorites))
  } catch {
    // session-only
  }
}

export function readRecents(): AppRecent[] {
  try {
    return parseRecents(localStorage.getItem(APPS_RECENTS_KEY))
  } catch {
    return []
  }
}

export function writeRecents(recents: AppRecent[]): void {
  try {
    localStorage.setItem(APPS_RECENTS_KEY, JSON.stringify(recents))
  } catch {
    // session-only
  }
}
