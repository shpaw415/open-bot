import { describe, expect, test } from "bun:test"
import {
  captureTransform,
  clipShifted,
  pngSize,
  scaledClip,
  shotSize,
  shouldReshoot,
  visualViewport,
} from "./xshot"

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

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
    // #47: the rejection names the real limits instead of implying only
    // "2" and 2560x1600 exist.
    expect(() => shotSize("320x1900")).toThrow("640")
    expect(() => shotSize("320x1900")).toThrow("480")
    expect(() => shotSize("sharp")).toThrow("WxH")
  })
})

describe("capture transform", () => {
  test("pngSize reads the IHDR dimensions and rejects non-PNG bytes", () => {
    expect(pngSize(pngHeader(3840, 2400))).toEqual({
      width: 3840,
      height: 2400,
    })
    expect(pngSize(new Uint8Array(24))).toBeNull()
    expect(pngSize(pngHeader(10, 10).slice(0, 12))).toBeNull()
  })

  test("factor is measured from the PNG, and the CSS offset scales by dpr", () => {
    // 2x clip-scale shot under 3x page zoom: PNG = css * 2 * 3, and the
    // window origin the page reports (CSS px) must land in device px.
    const transform = captureTransform({
      pngWidth: 1920,
      pngHeight: 1200,
      cssWidth: 320,
      cssHeight: 200,
      dpr: 3,
      oxCss: 4,
      oyCss: 125,
    })
    expect(transform.factor).toBe(6)
    expect(transform.yFactor).toBe(6)
    expect(transform.ox).toBe(12)
    expect(transform.oy).toBe(375)
    expect(transform.dpr).toBe(3)
  })

  test("at dpr 1 the transform is the plain ratio and offset", () => {
    const transform = captureTransform({
      pngWidth: 3822,
      pngHeight: 2148,
      cssWidth: 1911,
      cssHeight: 1074,
      dpr: 1,
      oxCss: 4,
      oyCss: 125,
    })
    expect(transform.factor).toBe(2)
    expect(transform.ox).toBe(4)
    expect(transform.oy).toBe(125)
  })

  test("reshoots only an identical capture on a still-painting page (#67)", () => {
    expect(shouldReshoot("abc", "abc", true)).toBe(true)
    // A static page legitimately captures identical bytes — no reshoot.
    expect(shouldReshoot("abc", "abc", false)).toBe(false)
    expect(shouldReshoot("abc", "def", true)).toBe(false)
    expect(shouldReshoot("", "", true)).toBe(false)
  })
})

describe("scaled clip (#126)", () => {
  // Page.captureScreenshot clip x/y are DOCUMENT coordinates: at
  // scrollY 2400 a (0,0) clip captured blank surface, while anchoring
  // at the visual viewport's page offset captured the visible page.
  const scrolled = {
    layoutViewport: {
      pageX: 12,
      pageY: 2400,
      clientWidth: 980,
      clientHeight: 2144,
    },
    cssLayoutViewport: {
      pageX: 0,
      pageY: 2400,
      clientWidth: 980,
      clientHeight: 2144,
    },
    cssVisualViewport: {
      pageX: 12,
      pageY: 2400,
      clientWidth: 320,
      clientHeight: 700,
    },
  }

  test("visualViewport prefers the css visual viewport over layout", () => {
    expect(visualViewport(scrolled)).toEqual({
      x: 12,
      y: 2400,
      width: 320,
      height: 700,
    })
  })

  test("visualViewport falls back to layout, then throws on junk", () => {
    expect(
      visualViewport({
        cssLayoutViewport: {
          pageX: 0,
          pageY: 50,
          clientWidth: 800,
          clientHeight: 600,
        },
      }),
    ).toEqual({ x: 0, y: 50, width: 800, height: 600 })
    expect(() => visualViewport({})).toThrow("no page size")
  })

  test("scaledClip anchors at the visual page offset with the scale", () => {
    expect(scaledClip(scrolled, 2)).toEqual({
      x: 12,
      y: 2400,
      width: 320,
      height: 700,
      scale: 2,
    })
  })

  test("scaledClip converts CSS to DIP document space under browser zoom", () => {
    // Live zoom-200 metrics: css visual 948x537 at pageY 2400, DIP
    // layout 1896x1074. The CSS-space clip captured blank; the
    // DIP-scaled rect captured the visible page.
    const zoomed = {
      layoutViewport: {
        pageX: 0,
        pageY: 4800,
        clientWidth: 1896,
        clientHeight: 1074,
      },
      cssLayoutViewport: {
        pageX: 0,
        pageY: 2400,
        clientWidth: 948,
        clientHeight: 537,
      },
      cssVisualViewport: {
        pageX: 0,
        pageY: 2400,
        clientWidth: 948,
        clientHeight: 537,
      },
    }
    expect(scaledClip(zoomed, 2)).toEqual({
      x: 0,
      y: 4800,
      width: 1896,
      height: 1074,
      scale: 2,
    })
    // The CSS view (transform denominators) stays in CSS pixels.
    expect(visualViewport(zoomed)).toEqual({
      x: 0,
      y: 2400,
      width: 948,
      height: 537,
    })
  })

  test("clipShifted spots the zoom+emulation DIP flip after a shot", () => {
    // First read in that state reports DIP==CSS; after one capture the
    // layout origin flips to real DIP (2400 -> 4800). The stale clip
    // must read as shifted; a stable clip must not.
    const stale = {
      layoutViewport: {
        pageX: 0,
        pageY: 2400,
        clientWidth: 320,
        clientHeight: 700,
      },
      cssLayoutViewport: {
        pageX: 0,
        pageY: 2400,
        clientWidth: 320,
        clientHeight: 700,
      },
      cssVisualViewport: {
        pageX: 0,
        pageY: 2400,
        clientWidth: 320,
        clientHeight: 700,
      },
    }
    const fresh = {
      ...stale,
      layoutViewport: {
        pageX: 0,
        pageY: 4800,
        clientWidth: 320,
        clientHeight: 700,
      },
    }
    expect(scaledClip(stale, 2).y).toBe(2400)
    expect(scaledClip(fresh, 2).y).toBe(4800)
    expect(clipShifted(scaledClip(stale, 2), scaledClip(fresh, 2))).toBe(true)
    expect(clipShifted(scaledClip(fresh, 2), scaledClip(fresh, 2))).toBe(false)
  })
})

describe("stale frame recovery (#67)", () => {
  test("settle expression waits two animation frames", async () => {
    const { FRAME_SETTLE_EXPRESSION } = await import("./xshot")
    expect(FRAME_SETTLE_EXPRESSION).toContain("requestAnimationFrame")
    expect(
      FRAME_SETTLE_EXPRESSION.match(/requestAnimationFrame/g),
    ).toHaveLength(2)
  })
})
