export type AppEntry = {
  id: string
  name: string
}

export const APP_SUGGESTION_LIMIT = 8

export function filterApps(apps: AppEntry[], query: string): AppEntry[] {
  const q = query.trim().toLowerCase()
  const matches = q
    ? apps.filter(
        (app) =>
          app.name.toLowerCase().includes(q) ||
          app.id.toLowerCase().includes(q),
      )
    : apps
  return matches.slice(0, APP_SUGGESTION_LIMIT)
}
