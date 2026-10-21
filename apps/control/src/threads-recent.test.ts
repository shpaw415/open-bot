import { describe, expect, test } from "bun:test"
import { recentRowFromSession, visibleRecentThreads } from "./threads"

describe("visibleRecentThreads — the passive /api/threads/recent contract", () => {
  test("drops hidden worker:/cron-run: titles like every other list", () => {
    const rows = [
      { sessionId: "a", title: "Rapport hebdo", createdAt: 3 },
      { sessionId: "b", title: "worker: plugin-x hook", createdAt: 9 },
      { sessionId: "c", title: "cron-run: guard", createdAt: 8 },
      { sessionId: "d", title: "Question facture", createdAt: 1 },
    ]
    const out = visibleRecentThreads(rows)
    expect(out.map((row) => row.sessionId)).toEqual(["a", "d"])
  })

  test("caps at eight summaries and keeps the newest first", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `T${i}`,
      createdAt: i,
    }))
    const out = visibleRecentThreads(rows)
    expect(out.length).toBe(8)
    expect(out[0].sessionId).toBe("s0")
  })

  test("only sessionId/title/createdAt leave the server", () => {
    const out = visibleRecentThreads([
      { sessionId: "a", title: "T", createdAt: 1 },
    ])
    expect(out[0]).toEqual({ sessionId: "a", title: "T", createdAt: 1 })
    expect(Object.keys(out[0]).sort()).toEqual([
      "createdAt",
      "sessionId",
      "title",
    ])
  })
})

describe("recentRowFromSession — the real-list coverage rows", () => {
  test("keeps the real last activity (time.updated, falling back to created)", () => {
    const out = recentRowFromSession({
      id: "s1",
      title: "Rapport",
      time: { created: 100, updated: 900 },
    })
    expect(out).toEqual({ sessionId: "s1", title: "Rapport", createdAt: 900 })
    const fallback = recentRowFromSession({
      id: "s2",
      title: "Rapport",
      time: { created: 100 },
    })
    expect(fallback?.createdAt).toBe(100)
    const none = recentRowFromSession({ id: "s3", title: "Rapport" })
    expect(none?.createdAt).toBe(0)
  })

  test("never surfaces subagents or hidden worker:/cron-run: threads", () => {
    expect(
      recentRowFromSession({ id: "sub", parentID: "root", title: "x" }),
    ).toBeNull()
    expect(
      recentRowFromSession({ id: "w", title: "worker: plugin-x hook" }),
    ).toBeNull()
    expect(
      recentRowFromSession({ id: "c", title: "cron-run: guard" }),
    ).toBeNull()
    expect(recentRowFromSession({ id: "", title: "x" })).toBeNull()
    expect(recentRowFromSession({ title: "no id" })).toBeNull()
    expect(recentRowFromSession("junk")).toBeNull()
    expect(recentRowFromSession(null)).toBeNull()
  })

  test("a stock/untitled session still counts as a conversation", () => {
    // The absence of a custom title never means the absence of a thread.
    const out = recentRowFromSession({
      id: "s9",
      title: "New thread",
      time: { updated: 5 },
    })
    expect(out).toEqual({ sessionId: "s9", title: "New thread", createdAt: 5 })
  })
})
