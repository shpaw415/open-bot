export type ChatModel = {
  providerID: string
  modelID: string
  name?: string
}

export const FAVORITES_EVENT = "ob-model-favorites"

export function modelKey(model: {
  providerID: string
  modelID: string
}): string {
  return `${model.providerID}/${model.modelID}`
}

export function modelTitle(model: ChatModel): string {
  return model.name ? `${model.name} (${model.providerID})` : modelKey(model)
}

export function favoritesStorageKey(userId: string): string {
  return `ob-model-favorites:${userId}`
}

export function readFavorites(storage: Storage, userId: string): string[] {
  let raw: string | null
  try {
    raw = storage.getItem(favoritesStorageKey(userId))
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of parsed) {
    if (typeof item !== "string" || !item.includes("/") || seen.has(item))
      continue
    seen.add(item)
    ids.push(item)
  }
  return ids
}

export function writeFavorites(
  storage: Storage,
  userId: string,
  ids: readonly string[],
): void {
  storage.setItem(favoritesStorageKey(userId), JSON.stringify(ids))
}

export function toggleFavorite(ids: readonly string[], id: string): string[] {
  if (!id.includes("/")) return [...ids]
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

export function sortModels<T extends { providerID: string; modelID: string }>(
  models: readonly T[],
  favorites: readonly string[],
): T[] {
  const favorite = new Set(favorites)
  return [...models].sort((a, b) => {
    const ak = modelKey(a)
    const bk = modelKey(b)
    const af = favorite.has(ak) ? 0 : 1
    const bf = favorite.has(bk) ? 0 : 1
    if (af !== bf) return af - bf
    return ak.localeCompare(bk)
  })
}
