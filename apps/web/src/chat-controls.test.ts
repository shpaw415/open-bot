import { describe, expect, test } from "bun:test"
import {
  composerSlim,
  effortForModel,
  effortLabel,
  effortOptions,
  MODEL_DEFAULT_EFFORT,
  nextReadingMode,
  orbSizePx,
  orbState,
} from "./chat-controls"

describe("effortLabel", () => {
  test("maps known variants to fr-CA labels", () => {
    expect(effortLabel("none")).toBe("Désactivée")
    expect(effortLabel("low")).toBe("Faible")
    expect(effortLabel("medium")).toBe("Moyenne")
    expect(effortLabel("high")).toBe("Haute")
    expect(effortLabel("xhigh")).toBe("Très haute")
    expect(effortLabel("max")).toBe("Maximale")
    expect(effortLabel("thinking")).toBe("Réflexion activée")
  })

  test("falls back to a capitalized passthrough for unknown variants", () => {
    expect(effortLabel("deep")).toBe("Deep")
    expect(effortLabel("")).toBe("")
  })
})

describe("effortForModel", () => {
  test("keeps a level the new model supports", () => {
    expect(effortForModel(["low", "medium", "high"], "high")).toBe("high")
  })

  test("drops a level the new model does not support — never kept silently", () => {
    expect(effortForModel(["low", "high"], "medium")).toBe(MODEL_DEFAULT_EFFORT)
  })

  test("an empty effort stays the model default", () => {
    expect(effortForModel([], "")).toBe(MODEL_DEFAULT_EFFORT)
  })

  test("a model with no variants always resets to the model default", () => {
    expect(effortForModel([], "high")).toBe(MODEL_DEFAULT_EFFORT)
  })
})

describe("effortOptions", () => {
  test("lists the model default first, then the variants", () => {
    expect(effortOptions(["low", "high"], "low")).toEqual(["", "low", "high"])
  })

  test("keeps an unknown saved effort visible so the display stays honest", () => {
    expect(effortOptions(["low"], "mystery")).toEqual(["", "low", "mystery"])
  })

  test("no duplicated current value", () => {
    expect(effortOptions([], "low")).toEqual(["", "low"])
    expect(effortOptions(["low"], "")).toEqual(["", "low"])
  })
})

describe("orbState — visual activity phases", () => {
  test("no activity means no orb", () => {
    expect(orbState(null, false)).toBeNull()
    expect(orbState(null, true)).toBeNull()
  })

  test("initialize reads as thinking, sending or not", () => {
    expect(orbState("initialize", false)).toBe("thinking")
    expect(orbState("initialize", true)).toBe("thinking")
  })

  test("an accepted send waiting for events reads as thinking", () => {
    expect(orbState("working", true)).toBe("thinking")
  })

  test("live turn activity reads as working", () => {
    expect(orbState("working", false)).toBe("working")
  })
})

describe("nextReadingMode — scroll-up reading hysteresis", () => {
  test("enters only well above the bottom, exits back at the bottom", () => {
    expect(nextReadingMode(400, false)).toBe(true)
    expect(nextReadingMode(0, true)).toBe(false)
    expect(nextReadingMode(47, true)).toBe(false)
  })

  test("the band between thresholds keeps the current mode (no flicker)", () => {
    // The shrink itself frees ~150px of viewport, which cuts the measured
    // gap by the same amount — inside the band the mode must not flip.
    expect(nextReadingMode(120, false)).toBe(false)
    expect(nextReadingMode(120, true)).toBe(true)
    expect(nextReadingMode(240, false)).toBe(false)
  })
})

describe("orbSizePx — the animation stays, smaller while reading", () => {
  test("full size at the bottom, mini while reading", () => {
    expect(orbSizePx(false, false)).toBe(112)
    expect(orbSizePx(true, false)).toBe(80)
    expect(orbSizePx(false, true)).toBe(32)
    expect(orbSizePx(true, true)).toBe(32)
  })
})

describe("composerSlim — never hides an in-progress composition", () => {
  const idle = {
    reading: true,
    focused: false,
    hasDraft: false,
    hasAttachments: false,
    voiceBusy: false,
  }

  test("slims only while reading an untouched composer", () => {
    expect(composerSlim(idle)).toBe(true)
    expect(composerSlim({ ...idle, reading: false })).toBe(false)
  })

  test("focus, draft text, attachments, or voice keep it full", () => {
    expect(composerSlim({ ...idle, focused: true })).toBe(false)
    expect(composerSlim({ ...idle, hasDraft: true })).toBe(false)
    expect(composerSlim({ ...idle, hasAttachments: true })).toBe(false)
    expect(composerSlim({ ...idle, voiceBusy: true })).toBe(false)
  })
})
