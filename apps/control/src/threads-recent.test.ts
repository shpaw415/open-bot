import { describe, expect, test } from "bun:test"
import { visibleRecentThreads } from "./threads"

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
