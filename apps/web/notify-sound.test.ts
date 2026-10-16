import { afterEach, describe, expect, test } from "bun:test"
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

globalThis.localStorage = memoryStorage()
;(globalThis as Record<string, unknown>).window = globalThis

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
