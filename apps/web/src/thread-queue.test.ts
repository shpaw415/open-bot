import { describe, expect, test } from "bun:test"
import { ApiHttpError } from "./api"
import { dropQueueItem, isQueueItemGone } from "./thread-queue"

describe("isQueueItemGone", () => {
  test("a 404 from a queue-item call means the item already left the queue", () => {
    // Current server: structured code.
    expect(
      isQueueItemGone(
        new ApiHttpError("queued message not found", 404, {
          code: "queue_item_gone",
        }),
      ),
    ).toBe(true)
    // Older control plane (dashboard can deploy ahead of it): bare message.
    expect(
      isQueueItemGone(new ApiHttpError("queued message not found", 404, {})),
    ).toBe(true)
  })

  test("other failures stay real errors", () => {
    expect(isQueueItemGone(new ApiHttpError("boom", 500, {}))).toBe(false)
    expect(
      isQueueItemGone(new ApiHttpError("the queue is full", 409, {})),
    ).toBe(false)
    expect(isQueueItemGone(new Error("queued message not found"))).toBe(false)
    expect(isQueueItemGone(null)).toBe(false)
    expect(isQueueItemGone(undefined)).toBe(false)
  })
})

describe("dropQueueItem", () => {
  const items = [{ id: "q1" }, { id: "q2" }, { id: "q3" }]

  test("removes exactly the named item and keeps the order of the rest", () => {
    expect(dropQueueItem(items, "q2")).toEqual([{ id: "q1" }, { id: "q3" }])
  })

  test("an unknown id changes nothing; the input is not mutated", () => {
    expect(dropQueueItem(items, "nope")).toEqual(items)
    expect(items).toHaveLength(3)
  })
})
