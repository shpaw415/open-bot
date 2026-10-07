import { describe, expect, test } from "bun:test"
import { shotSize } from "./xshot"

describe("screenshot resolution", () => {
  test("accepts a scale or a size", () => {
    expect(shotSize("2")).toEqual({ width: null, height: null, scale: 2 })
    expect(shotSize("2x")).toEqual({ width: null, height: null, scale: 2 })
    expect(shotSize("2560x1600")).toEqual({
      width: 2560,
      height: 1600,
      scale: 1,
    })
  })

  test("rejects a blurry upscale request", () => {
    expect(() => shotSize("4")).toThrow()
    expect(() => shotSize("100x100")).toThrow()
    expect(() => shotSize("sharp")).toThrow()
  })
})
