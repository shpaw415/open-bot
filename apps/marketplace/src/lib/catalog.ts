// Catalogue view-state shared between the URL and the fetch layer.
// Pure functions so both the page and tests can rely on identical behavior.

export type PriceFilter = "all" | "free" | "paid"
export type SortKey = "popular" | "name" | "price" | "new"

export const SORT_KEYS: SortKey[] = ["popular", "name", "price", "new"]

export const sortLabels: Record<SortKey, string> = {
  popular: "Most installed",
  name: "Name (A–Z)",
  price: "Price (low first)",
  new: "Newly added",
}

export type CatalogState = {
  q: string
  category: string
  price: PriceFilter
  sort: SortKey
  page: number // 1-based
}

export const PAGE_SIZE = 30

export const defaultCatalogState: CatalogState = {
  q: "",
  category: "",
  price: "all",
  sort: "popular",
  page: 1,
}

function firstParam(params: URLSearchParams, key: string): string {
  const value = params.get(key)
  return value === null ? "" : value
}

// Reads the catalogue state out of a query string. Unknown values fall back to
// defaults; unrelated params are preserved by `writeCatalogState`.
export function parseCatalogState(search: string): CatalogState {
  const params = new URLSearchParams(search)
  const priceRaw = firstParam(params, "price").toLowerCase()
  const sortRaw = firstParam(params, "sort").toLowerCase()
  const pageRaw = Number.parseInt(firstParam(params, "page"), 10)
  return {
    q: firstParam(params, "q"),
    category: firstParam(params, "category").toLowerCase(),
    price:
      priceRaw === "free" || priceRaw === "paid"
        ? (priceRaw as PriceFilter)
        : "all",
    sort: (SORT_KEYS as string[]).includes(sortRaw)
      ? (sortRaw as SortKey)
      : "popular",
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1,
  }
}

// Writes the state back onto existing params, preserving unrelated keys and
// dropping defaults so URLs stay short. Returns null when nothing changed.
export function writeCatalogState(
  current: URLSearchParams,
  state: CatalogState,
): URLSearchParams | null {
  const next = new URLSearchParams(current)
  const assign = (key: string, value: string, isDefault: boolean) => {
    if (isDefault || value === "") next.delete(key)
    else next.set(key, value)
  }
  assign("q", state.q, state.q.trim() === "")
  assign("category", state.category, state.category === "")
  assign("price", state.price, state.price === "all")
  assign("sort", state.sort, state.sort === "popular")
  assign("page", String(state.page), state.page <= 1)
  const before = current.toString()
  const after = next.toString()
  return after === before ? null : next
}

// Fetch query for the API. Categories are matched case-insensitively by the
// server (the DB stores lowercase slugs).
export function catalogApiParams(state: CatalogState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q.trim()) params.set("q", state.q.trim())
  if (state.category) params.set("category", state.category)
  if (state.price !== "all") params.set("price", state.price)
  if (state.sort !== "popular") params.set("sort", state.sort)
  params.set("limit", String(PAGE_SIZE))
  if (state.page > 1) params.set("offset", String((state.page - 1) * PAGE_SIZE))
  return params
}
