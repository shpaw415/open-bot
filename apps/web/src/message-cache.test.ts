import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearCachedMessages,
  dropCachedMessages,
  getCachedMessages,
  putCachedMessages,
} from "./message-cache"

function entry(text: string) {
  return {
    payload: JSON.stringify([{ info: { id: text }, parts: [] }]),
    messages: [{ info: { id: text }, parts: [] }],
  }
}

beforeEach(() => clearCachedMessages())

describe("message cache", () => {
  test("stores, returns, and drops entries", () => {
    const one = entry("one")
    putCachedMessages("s1", one.payload, one.messages)
    expect(getCachedMessages("s1")?.payload).toBe(one.payload)
    dropCachedMessages("s1")
    expect(getCachedMessages("s1")).toBeUndefined()
  })

  test("ignores empty ids and empty payloads", () => {
    const one = entry("one")
    putCachedMessages("", one.payload, one.messages)
    putCachedMessages("s1", "", one.messages)
    expect(getCachedMessages("s1")).toBeUndefined()
    expect(getCachedMessages("")).toBeUndefined()
  })

  test("evicts the least recently used entry past the cap", () => {
    for (let i = 0; i < 10; i++)
      putCachedMessages(
        `s${i}`,
        entry(`m${i}`).payload,
        entry(`m${i}`).messages,
      )
    expect(getCachedMessages("s0")?.messages[0].info?.id).toBe("m0")
    putCachedMessages("s10", entry("m10").payload, entry("m10").messages)
    // s1 is now the oldest un-touched entry; s0 survived via the LRU touch
    expect(getCachedMessages("s0")).toBeTruthy()
    expect(getCachedMessages("s1")).toBeUndefined()
    expect(getCachedMessages("s10")).toBeTruthy()
  })

  test("overwrites an existing id and moves it to newest", () => {
    for (let i = 0; i < 10; i++)
      putCachedMessages(
        `s${i}`,
        entry(`m${i}`).payload,
        entry(`m${i}`).messages,
      )
    putCachedMessages("s0", entry("m0b").payload, entry("m0b").messages)
    putCachedMessages("s10", entry("m10").payload, entry("m10").messages)
    expect(getCachedMessages("s1")).toBeUndefined()
    expect(getCachedMessages("s0")?.messages[0].info?.id).toBe("m0b")
  })
})
