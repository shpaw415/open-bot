import { describe, expect, test } from "bun:test"
import {
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
  pageMessages,
  parseMessagePageQuery,
} from "./messages-page"

function rows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    info: { id: `m${i}`, role: i % 3 === 0 ? "user" : "assistant" },
    parts: [{ type: "text", text: `t${i}` }],
  }))
}

function ids(page: { messages: unknown[] } | null): string[] {
  return (page?.messages ?? []).map(
    (row) => (row as { info: { id: string } }).info.id,
  )
}

describe("parseMessagePageQuery", () => {
  test("no paging params means the legacy full list", () => {
    expect(parseMessagePageQuery(new URLSearchParams(""))).toBeNull()
    expect(parseMessagePageQuery(new URLSearchParams("x=1"))).toBeNull()
  })

  test("limit clamps to the cap and floors", () => {
    expect(parseMessagePageQuery(new URLSearchParams("limit=50"))).toEqual({
      limit: 50,
      before: null,
    })
    expect(
      parseMessagePageQuery(new URLSearchParams("limit=99999"))?.limit,
    ).toBe(MESSAGE_PAGE_MAX_LIMIT)
    expect(parseMessagePageQuery(new URLSearchParams("limit=2.9"))?.limit).toBe(
      2,
    )
  })

  test("invalid limits fall back to the default", () => {
    for (const raw of ["limit=", "limit=abc", "limit=0", "limit=-3"]) {
      expect(parseMessagePageQuery(new URLSearchParams(raw))?.limit).toBe(
        MESSAGE_PAGE_DEFAULT_LIMIT,
      )
    }
  })

  test("before alone pages with the default limit; blank before is no cursor", () => {
    expect(parseMessagePageQuery(new URLSearchParams("before=m3"))).toEqual({
      limit: MESSAGE_PAGE_DEFAULT_LIMIT,
      before: "m3",
    })
    expect(
      parseMessagePageQuery(new URLSearchParams("before=%20&limit=5")),
    ).toEqual({ limit: 5, before: null })
  })
})

describe("pageMessages", () => {
  test("tail page returns the newest messages with an older cursor", () => {
    const page = pageMessages(rows(10), { limit: 3, before: null })
    expect(ids(page)).toEqual(["m7", "m8", "m9"])
    expect(page?.total).toBe(10)
    expect(page?.hasMore).toBe(true)
    expect(page?.nextBefore).toBe("m7")
    // user rows are m0, m3, m6 — all before the slice
    expect(page?.startUserCount).toBe(3)
  })

  test("before pages walk to the start without gaps or repeats", () => {
    const list = rows(10)
    const walked: string[] = []
    let before: string | null = null
    for (let hop = 0; hop < 6; hop++) {
      const page = pageMessages(list, { limit: 4, before })
      expect(page).not.toBeNull()
      if (!page) break
      walked.unshift(...ids(page))
      if (!page.hasMore) break
      before = page.nextBefore
    }
    expect(walked).toEqual(rows(10).map((row) => row.info.id))
  })

  test("a page covering the whole list reports no older page", () => {
    const page = pageMessages(rows(4), { limit: 100, before: null })
    expect(ids(page)).toEqual(["m0", "m1", "m2", "m3"])
    expect(page?.hasMore).toBe(false)
    expect(page?.nextBefore).toBeNull()
    expect(page?.startUserCount).toBe(0)
  })

  test("before the first message is an empty final page", () => {
    const page = pageMessages(rows(4), { limit: 3, before: "m0" })
    expect(page?.messages).toEqual([])
    expect(page?.hasMore).toBe(false)
    expect(page?.total).toBe(4)
  })

  test("an unknown before cursor is null, not a silent tail page", () => {
    expect(pageMessages(rows(4), { limit: 3, before: "gone" })).toBeNull()
  })

  test("an id-less oldest message cannot be a cursor", () => {
    const list = [
      { info: { id: "m0", role: "user" }, parts: [] },
      { parts: [{ type: "text", text: "no info" }] },
      { info: { id: "m2", role: "assistant" }, parts: [] },
    ]
    const page = pageMessages(list, { limit: 2, before: null })
    expect(page?.messages).toHaveLength(2)
    expect(page?.hasMore).toBe(false)
    expect(page?.nextBefore).toBeNull()
    expect(page?.startUserCount).toBe(1)
  })

  test("empty list pages to an empty first page", () => {
    const page = pageMessages([], { limit: 5, before: null })
    expect(page).toEqual({
      messages: [],
      total: 0,
      hasMore: false,
      nextBefore: null,
      startUserCount: 0,
    })
  })
})
