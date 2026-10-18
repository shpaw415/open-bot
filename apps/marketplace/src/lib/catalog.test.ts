import { describe, expect, test } from "bun:test"
import {
  catalogApiParams,
  defaultCatalogState,
  PAGE_SIZE,
  parseCatalogState,
  writeCatalogState,
} from "./catalog"

describe("parseCatalogState", () => {
  test("reads all params", () => {
    const state = parseCatalogState(
      "?q=cron&category=devtools&price=paid&sort=new&page=3",
    )
    expect(state).toEqual({
      q: "cron",
      category: "devtools",
      price: "paid",
      sort: "new",
      page: 3,
    })
  })

  test("falls back to defaults on unknown or missing values", () => {
    expect(parseCatalogState("")).toEqual(defaultCatalogState)
    expect(parseCatalogState("?price=free beer&sort=weird&page=-2&q=")).toEqual(
      {
        q: "",
        category: "",
        price: "all",
        sort: "popular",
        page: 1,
      },
    )
    expect(parseCatalogState("?page=1")).toEqual(defaultCatalogState)
  })
})

describe("writeCatalogState", () => {
  test("preserves unrelated params", () => {
    const current = new URLSearchParams("loginError=oauth&ref=x")
    const next = writeCatalogState(current, {
      ...defaultCatalogState,
      q: "abc",
    })
    expect(next?.get("loginError")).toBe("oauth")
    expect(next?.get("ref")).toBe("x")
    expect(next?.get("q")).toBe("abc")
  })

  test("drops defaults so urls stay clean", () => {
    const next = writeCatalogState(
      new URLSearchParams("q=abc&price=paid"),
      defaultCatalogState,
    )
    expect(next?.toString()).toBe("")
  })

  test("returns null when nothing changed", () => {
    const current = new URLSearchParams("q=abc")
    expect(
      writeCatalogState(current, { ...defaultCatalogState, q: "abc" }),
    ).toBeNull()
  })
})

describe("catalogApiParams", () => {
  test("maps state onto api params with paging", () => {
    const params = catalogApiParams({
      q: "  cron  ",
      category: "devtools",
      price: "paid",
      sort: "new",
      page: 2,
    })
    expect(params.get("q")).toBe("cron")
    expect(params.get("category")).toBe("devtools")
    expect(params.get("price")).toBe("paid")
    expect(params.get("sort")).toBe("new")
    expect(params.get("limit")).toBe(String(PAGE_SIZE))
    expect(params.get("offset")).toBe(String(PAGE_SIZE))
  })

  test("page 1 sends no offset", () => {
    const params = catalogApiParams(defaultCatalogState)
    expect(params.has("offset")).toBe(false)
  })
})
