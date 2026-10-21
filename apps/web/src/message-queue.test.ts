import { describe, expect, test } from "bun:test"
import {
  canQueueMore,
  dropQueuedHead,
  enqueueQueued,
  MAX_QUEUED_MESSAGES,
  promoteQueued,
  type QueuedMessage,
  removeQueuedItem,
} from "./message-queue"

function item(id: string, text = `msg ${id}`): QueuedMessage {
  return { id, text, files: [] }
}

describe("enqueueQueued", () => {
  test("appends in order", () => {
    const result = enqueueQueued([item("a")], item("b"))
    expect(result?.duplicate).toBeFalse()
    expect(result?.queue.map((m) => m.id)).toEqual(["a", "b"])
  })

  test("refuses past the cap", () => {
    const full = Array.from({ length: MAX_QUEUED_MESSAGES }, (_, i) =>
      item(`m${i}`),
    )
    expect(enqueueQueued(full, item("x"))).toBeNull()
    expect(canQueueMore(full)).toBeFalse()
    expect(canQueueMore(full.slice(1))).toBeTrue()
  })

  test("marks an identical tail message as a duplicate", () => {
    const queue = [item("a"), item("b", "même texte")]
    const result = enqueueQueued(queue, item("c", "  même texte  "))
    expect(result).toEqual({ queue, duplicate: true })
  })

  test("allows the same text when files are attached", () => {
    const withFile: QueuedMessage = {
      id: "c",
      text: "même texte",
      files: [{ id: "f1", name: "a.txt", mime: "text/plain", url: "data:" }],
    }
    const result = enqueueQueued([item("a", "même texte")], withFile)
    expect(result?.duplicate).toBeFalse()
    expect(result?.queue).toHaveLength(2)
  })
})

describe("dropQueuedHead", () => {
  test("removes only the first message", () => {
    expect(dropQueuedHead([item("a"), item("b")]).map((m) => m.id)).toEqual([
      "b",
    ])
    expect(dropQueuedHead([])).toEqual([])
  })
})

describe("promoteQueued", () => {
  test("moves the picked message to the front", () => {
    const queue = [item("a"), item("b"), item("c")]
    expect(promoteQueued(queue, "c").map((m) => m.id)).toEqual(["c", "a", "b"])
  })

  test("keeps the list untouched for the head or an unknown id", () => {
    const queue = [item("a"), item("b")]
    expect(promoteQueued(queue, "a")).toBe(queue)
    expect(promoteQueued(queue, "zzz")).toBe(queue)
    expect(promoteQueued([], "a")).toEqual([])
  })
})

describe("removeQueuedItem", () => {
  test("drops the picked message and keeps the order", () => {
    const queue = [item("a"), item("b"), item("c")]
    expect(removeQueuedItem(queue, "b").map((m) => m.id)).toEqual(["a", "c"])
    expect(removeQueuedItem(queue, "zzz").map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ])
  })
})
