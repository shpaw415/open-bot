import { expect, test } from "bun:test"
import {
  favoritesStorageKey,
  readFavorites,
  sortModels,
  toggleFavorite,
  writeFavorites,
} from "./model-favorites"

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

const models = [
  { providerID: "a", modelID: "zeta", name: "Zeta" },
  { providerID: "b", modelID: "alpha", name: "Alpha" },
  { providerID: "a", modelID: "mid", name: "Mid" },
]

test("sorts favorites ahead of the alpha list", () => {
  const sorted = sortModels(models, ["b/alpha"])
  expect(sorted.map((item) => `${item.providerID}/${item.modelID}`)).toEqual([
    "b/alpha",
    "a/mid",
    "a/zeta",
  ])
})

test("keeps alpha order when nothing is starred", () => {
  const sorted = sortModels(models, [])
  expect(sorted.map((item) => item.modelID)).toEqual(["mid", "zeta", "alpha"])
})

test("toggles a favorite id without touching empty values", () => {
  expect(toggleFavorite(["a/mid"], "b/alpha")).toEqual(["a/mid", "b/alpha"])
  expect(toggleFavorite(["a/mid", "b/alpha"], "a/mid")).toEqual(["b/alpha"])
  expect(toggleFavorite(["a/mid"], "")).toEqual(["a/mid"])
})

test("reads and writes favorites per user", () => {
  const storage = memoryStorage()
  storage.setItem(
    favoritesStorageKey("user-1"),
    JSON.stringify(["a/mid", "a/mid", "nope", 1]),
  )
  expect(readFavorites(storage, "user-1")).toEqual(["a/mid"])
  writeFavorites(storage, "user-1", ["b/alpha"])
  expect(readFavorites(storage, "user-1")).toEqual(["b/alpha"])
  expect(readFavorites(storage, "user-2")).toEqual([])
  expect(favoritesStorageKey("user-1")).toBe("ob-model-favorites:user-1")
})

test("ignores corrupt favorite storage", () => {
  const storage = memoryStorage()
  storage.setItem(favoritesStorageKey("user-1"), "{")
  expect(readFavorites(storage, "user-1")).toEqual([])
  storage.setItem(favoritesStorageKey("user-1"), JSON.stringify({ a: 1 }))
  expect(readFavorites(storage, "user-1")).toEqual([])
})
