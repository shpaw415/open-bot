import { afterAll, afterEach, describe, expect, test } from "bun:test"
import {
  playNotifySound,
  readNotifySound,
  writeNotifySound,
} from "./src/notify-sound"

const KEY = "ob-notify-sound"

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

const globals = globalThis as Record<string, unknown>
// This file owns its globals: a `window` stubbed before another file
// registers a DOM stays a plain property there, and code that attached to
// it at import (back-nav's popstate listener) never hears that DOM.
const replaced = Object.fromEntries(
  ["window", "localStorage"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
)
globals.localStorage = memoryStorage()
globals.window = globalThis

afterAll(() => {
  for (const [key, descriptor] of Object.entries(replaced)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globals[key]
  }
})

afterEach(() => {
  localStorage.removeItem(KEY)
  delete (globalThis as Record<string, unknown>).AudioContext
})

describe("notify sound", () => {
  test("defaults on and persists the toggle", () => {
    expect(readNotifySound()).toBe(true)
    writeNotifySound(false)
    expect(readNotifySound()).toBe(false)
    writeNotifySound(true)
    expect(readNotifySound()).toBe(true)
  })

  test("muted flag skips audio entirely", () => {
    writeNotifySound(false)
    let created = 0
    class FakeAudioContext {
      constructor() {
        created += 1
      }
    }
    ;(globalThis as Record<string, unknown>).AudioContext = FakeAudioContext
    expect(() => playNotifySound()).not.toThrow()
    expect(created).toBe(0)
  })

  test("unmuted without audio support stays silent", () => {
    writeNotifySound(true)
    expect(() => playNotifySound()).not.toThrow()
  })
})
