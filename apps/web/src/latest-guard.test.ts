import { describe, expect, test } from "bun:test"
import { createLatestGuard } from "./latest-guard"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("latest guard", () => {
  test("a fresh token is current", () => {
    const guard = createLatestGuard()
    const token = guard.begin()
    expect(guard.isCurrent(token)).toBe(true)
  })

  test("a newer begin invalidates the older token", () => {
    const guard = createLatestGuard()
    const first = guard.begin()
    guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
  })

  test("a late async response for a stale token is discarded", async () => {
    const guard = createLatestGuard()
    const first = deferred<string>()
    const firstToken = guard.begin()
    void first.promise.then((value) => {
      if (!guard.isCurrent(firstToken)) return
      throw new Error(`stale response applied: ${value}`)
    })
    const second = guard.begin()
    first.resolve("stale")
    await first.promise
    expect(guard.isCurrent(firstToken)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  test("tokens are unique and monotonic", () => {
    const guard = createLatestGuard()
    const seen = new Set<number>()
    for (let i = 0; i < 5; i++) {
      const token = guard.begin()
      expect(seen.has(token)).toBe(false)
      seen.add(token)
    }
    expect(guard.isCurrent(0)).toBe(false)
  })
})
