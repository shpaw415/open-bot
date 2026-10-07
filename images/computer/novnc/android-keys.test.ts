import { expect, test } from "bun:test"
import {
  androidActions,
  diffTyped,
  ignoreAndroidUnderscore,
  isAndroid,
  PAD,
  padding,
  stripPad,
} from "./android-keys.js"

const android =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
const desktop =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

test("padding is not an underscore", () => {
  expect(padding(100)).toHaveLength(99)
  expect(padding(100).includes("_")).toBe(false)
  expect(stripPad(`${PAD}a${PAD}`)).toBe("a")
})

test("typing a does not emit the underscore baseline", () => {
  const field = `a${padding(100)}`
  const actions = androidActions("", field)
  expect(actions.backspaces).toBe(0)
  expect(actions.insert).toBe("a")
  expect(actions.insert.includes("_")).toBe(false)
})

test("a later character is appended, not rewritten as padding", () => {
  const actions = androidActions("a", `${padding(100)}ab`)
  expect(actions.backspaces).toBe(0)
  expect(actions.insert).toBe("b")
  expect(actions.typed).toBe("ab")
})

test("a typed underscore is kept", () => {
  const actions = androidActions("a", `${padding(100)}a_`)
  expect(actions.insert).toBe("_")
  expect(actions.backspaces).toBe(0)
})

test("autocorrect replaces only the changed tail", () => {
  const actions = androidActions("hellp", `${padding(100)}hello`)
  expect(actions.backspaces).toBe(1)
  expect(actions.insert).toBe("o")
})

test("backspace removes one typed character and ignores padding", () => {
  const actions = androidActions("ab", padding(100))
  expect(actions.backspaces).toBe(2)
  expect(actions.insert).toBe("")
  expect(diffTyped("ab", "a")).toEqual({ backspaces: 1, insert: "" })
})

test("android phantom underscore keydowns are dropped", () => {
  expect(isAndroid(android)).toBe(true)
  expect(ignoreAndroidUnderscore(0x5f, android)).toBe(true)
  expect(ignoreAndroidUnderscore(0x61, android)).toBe(false)
  expect(ignoreAndroidUnderscore(0x5f, desktop)).toBe(false)
})
