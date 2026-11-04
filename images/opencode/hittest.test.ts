import { expect, test } from "bun:test"
import { HIT_SCRIPT } from "./hittest"

type HitResult = {
  hit?: string
  tag?: string
  dpr?: number
  viewport?: { x: number; y: number }
}

function runHit(dpr: number, liveX: number, liveY: number) {
  const seen: { x: number; y: number }[] = []
  const el = {
    tagName: "BUTTON",
    id: "go",
    textContent: "Go",
    getAttribute: () => null,
    closest: () => null,
  }
  const windowFake = {
    // Window chrome in CSS px: viewport origin at (8, 60), size 800x600.
    screenX: 4,
    screenY: 30,
    outerWidth: 808,
    innerWidth: 800,
    outerHeight: 630,
    innerHeight: 600,
    devicePixelRatio: dpr,
  }
  const documentFake = {
    elementFromPoint: (x: number, y: number) => {
      seen.push({ x, y })
      return el
    },
  }
  const make = new Function("window", "document", `return (${HIT_SCRIPT})`) as (
    w: unknown,
    d: unknown,
  ) => (x: number, y: number) => HitResult
  return { result: make(windowFake, documentFake)(liveX, liveY), seen }
}

test("hit converts live device px to viewport CSS px through dpr", () => {
  // Viewport CSS point (100, 50) at 3x zoom sits at live (324, 330).
  const { result, seen } = runHit(3, 324, 330)
  expect(seen).toEqual([{ x: 100, y: 50 }])
  expect(result.tag).toBe("button")
  expect(result.dpr).toBe(3)
  expect(result.viewport).toEqual({ x: 100, y: 50 })
})

test("hit no longer reports a zoomed in-window point as outside", () => {
  // CSS (700, 500) at dpr 3 is live (2124, 1680) — past innerWidth in raw
  // device px, which the old un-divided math called "outside".
  const { result } = runHit(3, 2124, 1680)
  expect(result.hit).toBeUndefined()
  expect(result.tag).toBe("button")
})

test("hit at dpr 1 keeps the plain subtraction", () => {
  const { seen } = runHit(1, 108, 110)
  expect(seen).toEqual([{ x: 100, y: 50 }])
})

test("an outside hit explains the mapping it used", () => {
  const { result } = runHit(2, 20, 20)
  expect(result.hit).toBe("outside the browser window")
  expect(result.dpr).toBe(2)
  expect(result.viewport).toEqual({ x: 2, y: -50 })
})
