import { describe, expect, test } from "bun:test"
import { buildCatalogQuery, type CatalogQuery } from "./db"

const base: CatalogQuery = { includeAll: false }

describe("buildCatalogQuery", () => {
  test("public catalogue restricts to approved stable listings", () => {
    const query = buildCatalogQuery(base)
    expect(query.where).toContain("status = 'approved'")
    expect(query.where).toContain("GLOB")
  })

  test("admin listings keep all rows", () => {
    const query = buildCatalogQuery({ includeAll: true })
    expect(query.where).not.toContain("status = 'approved'")
  })

  test("price filters are sql-side", () => {
    expect(buildCatalogQuery({ ...base, price: "free" }).where).toContain(
      "price_cents IS NULL OR price_cents <= 0",
    )
    expect(buildCatalogQuery({ ...base, price: "paid" }).where).toContain(
      "price_cents IS NOT NULL AND price_cents > 0",
    )
    expect(buildCatalogQuery({ ...base, price: "all" }).where).not.toContain(
      "price_cents",
    )
  })

  test("category match is case-insensitive", () => {
    const query = buildCatalogQuery({ ...base, category: "DevTools" })
    expect(query.where).toContain("LOWER(category) = ?")
    expect(query.params).toContain("devtools")
  })

  test("sorts cover the whole catalogue before limit", () => {
    for (const sort of ["popular", "name", "price", "new"] as const) {
      const query = buildCatalogQuery({ ...base, sort })
      expect(query.order.length).toBeGreaterThan(0)
      expect(query.limit).toBeGreaterThan(0)
    }
    expect(buildCatalogQuery({ ...base, sort: "new" }).order).toBe(
      "created_at DESC, name COLLATE NOCASE ASC",
    )
    expect(buildCatalogQuery({ ...base, sort: "price" }).order).toBe(
      "COALESCE(price_cents, 0) ASC, name COLLATE NOCASE ASC",
    )
  })

  test("limit is clamped and offset non-negative", () => {
    expect(buildCatalogQuery({ ...base, limit: 5000 }).limit).toBe(100)
    expect(buildCatalogQuery({ ...base, limit: 0 }).limit).toBe(1)
    expect(buildCatalogQuery({ ...base, offset: -50 }).offset).toBe(0)
    expect(buildCatalogQuery({ ...base, offset: 90 }).offset).toBe(90)
  })

  test("facet where ignores the category filter but keeps q and price", () => {
    const query = buildCatalogQuery({
      ...base,
      q: "cron",
      category: "devtools",
      price: "paid",
    })
    expect(query.facetWhere).not.toContain("category")
    expect(query.facetWhere).toContain("LIKE")
    expect(query.facetWhere).toContain("price_cents")
    expect(query.facetParams.length).toBe(5)
    // The row query keeps all three filters.
    expect(query.where).toContain("category")
  })

  test("search trims the query", () => {
    const query = buildCatalogQuery({ ...base, q: "  blender  " })
    expect(query.params[0]).toBe("%blender%")
    // Whitespace-only q adds no search clause (the stable-version GLOB rule
    // legitimately keeps NOT LIKE in every public query).
    expect(buildCatalogQuery({ ...base, q: "   " }).where).not.toContain(
      "description LIKE",
    )
  })
})
