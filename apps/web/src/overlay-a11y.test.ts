import { describe, expect, test } from "bun:test"
import {
  isOverlayFocusable,
  isTopOverlay,
  overlayDepth,
  registerOverlay,
  unregisterOverlay,
} from "./dialog-a11y"

describe("overlay stack — topmost-only Escape", () => {
  test("registers, orders and unregisters overlays", () => {
    const a = Symbol("a")
    const b = Symbol("b")
    registerOverlay(a)
    registerOverlay(b)
    expect(overlayDepth()).toBe(2)
    expect(isTopOverlay(b)).toBe(true)
    expect(isTopOverlay(a)).toBe(false)
    unregisterOverlay(b)
    expect(isTopOverlay(a)).toBe(true)
    unregisterOverlay(a)
    expect(overlayDepth()).toBe(0)
    expect(isTopOverlay(a)).toBe(false)
  })

  test("unregistering an unknown id is a no-op", () => {
    expect(() => unregisterOverlay(Symbol("ghost"))).not.toThrow()
  })
})

describe("isOverlayFocusable", () => {
  const ok = {
    matches: (selector: string) => selector.includes("button"),
    getAttribute: () => null,
    hasAttribute: () => false,
  }

  test("a plain matching element is focusable", () => {
    expect(isOverlayFocusable(ok)).toBe(true)
  })

  test("disabled, aria-hidden and tabindex=-1 are excluded", () => {
    expect(
      isOverlayFocusable({
        ...ok,
        hasAttribute: (name) => name === "disabled",
      }),
    ).toBe(false)
    expect(
      isOverlayFocusable({
        ...ok,
        getAttribute: (name) => (name === "aria-hidden" ? "true" : null),
      }),
    ).toBe(false)
    expect(
      isOverlayFocusable({
        ...ok,
        getAttribute: (name) => (name === "tabindex" ? "-1" : null),
      }),
    ).toBe(false)
  })

  test("hidden inputs and visually hidden elements are excluded", () => {
    expect(isOverlayFocusable({ ...ok, type: "hidden" })).toBe(false)
    expect(isOverlayFocusable(ok, { visibility: "hidden" })).toBe(false)
    expect(isOverlayFocusable(ok, { display: "none" })).toBe(false)
    expect(isOverlayFocusable(ok, { visibility: "visible" })).toBe(true)
  })

  test("selector mismatch is excluded", () => {
    expect(
      isOverlayFocusable({
        matches: () => false,
        getAttribute: () => null,
        hasAttribute: () => false,
      }),
    ).toBe(false)
  })
})
