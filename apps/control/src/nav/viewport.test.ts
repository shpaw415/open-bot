import { expect, test } from "bun:test"
import {
  emulationAction,
  findPreset,
  metricsOverride,
  parseViewportRequest,
  shapeSpec,
  userAgentOverride,
  VIEWPORT_PRESETS,
  viewportSignature,
} from "./viewport"

function setOf(argv: string[], current = null as never) {
  const request = parseViewportRequest(argv, current)
  if (request.kind !== "set")
    throw new Error(`expected set, got ${request.kind}`)
  return request.spec
}

test("bare viewport is status; bare mobile is the default device", () => {
  expect(parseViewportRequest([], null)).toEqual({ kind: "status" })
  const spec = setOf(["mobile"])
  expect(spec.preset).toBe("iphone-14")
  expect(spec).toMatchObject({ width: 390, height: 844, dpr: 3, mobile: true })
  expect(spec.userAgent).toContain("iPhone")
})

test("presets resolve by slug, tolerating case and separator drift", () => {
  expect(findPreset("Pixel_7")?.width).toBe(412)
  expect(findPreset("iphone 14 pro max")?.height).toBe(932)
  expect(findPreset("nokia-3310")).toBeNull()
  expect(setOf(["galaxy-s23"]).userAgent).toContain("Android")
  expect(setOf(["mobile", "ipad-mini"]).width).toBe(768)
})

test("every preset is a valid mobile spec with a UA", () => {
  for (const row of VIEWPORT_PRESETS) {
    expect(shapeSpec(row)).not.toBeNull()
    expect(row.mobile).toBe(true)
    expect(row.userAgent.length).toBeGreaterThan(20)
  }
})

test("custom sizes default to mobile metrics; --desktop is a plain resize", () => {
  expect(setOf(["390x844"])).toMatchObject({
    preset: "",
    width: 390,
    height: 844,
    dpr: 2,
    mobile: true,
    userAgent: "",
  })
  expect(setOf(["800x600", "--desktop"])).toMatchObject({
    dpr: 1,
    mobile: false,
  })
  expect(setOf(["390x844", "--dpr", "3"]).dpr).toBe(3)
  expect(setOf(["390x844", "--dpr=2.5"]).dpr).toBe(2.5)
})

test("orientation flags swap portrait and landscape", () => {
  expect(setOf(["390x844", "--landscape"])).toMatchObject({
    width: 844,
    height: 390,
  })
  expect(setOf(["iphone-14", "--landscape"]).width).toBe(844)
  expect(setOf(["844x390", "--portrait"])).toMatchObject({
    width: 390,
    height: 844,
  })
  // Already in the asked orientation: untouched.
  expect(setOf(["390x844", "--portrait"]).width).toBe(390)
})

test("a bare flag never swallows the following preset", () => {
  expect(setOf(["--landscape", "iphone-14"])).toMatchObject({
    preset: "iphone-14",
    width: 844,
  })
  expect(setOf(["--dpr", "2", "pixel-7"])).toMatchObject({
    preset: "pixel-7",
    dpr: 2,
  })
})

test("rotate swaps the current spec and refuses without one", () => {
  const current = setOf(["iphone-14"])
  const rotated = parseViewportRequest(["rotate"], current)
  expect(rotated.kind).toBe("set")
  if (rotated.kind === "set")
    expect(rotated.spec).toMatchObject({ width: 844, height: 390 })
  expect(() => parseViewportRequest(["rotate"], null)).toThrow(
    "no mobile viewport to rotate",
  )
})

test("off and list words map to their kinds", () => {
  for (const word of ["off", "reset", "desktop", "clear"])
    expect(parseViewportRequest([word], null).kind).toBe("off")
  expect(parseViewportRequest(["list"], null).kind).toBe("list")
  expect(parseViewportRequest(["devices"], null).kind).toBe("list")
  expect(parseViewportRequest(["status"], null).kind).toBe("status")
})

test("flags alone adjust the current spec", () => {
  const current = setOf(["iphone-14"])
  const adjusted = parseViewportRequest(["--landscape"], current)
  expect(adjusted.kind).toBe("set")
  if (adjusted.kind === "set")
    expect(adjusted.spec).toMatchObject({ preset: "iphone-14", width: 844 })
})

test("unknown devices, bad sizes and bad dprs name the fix", () => {
  expect(() => parseViewportRequest(["nokia"], null)).toThrow(
    "viewport list names the presets",
  )
  expect(() => parseViewportRequest(["99x844"], null)).toThrow("unknown device")
  expect(() => parseViewportRequest(["100x100"], null)).toThrow(
    "bad viewport size",
  )
  expect(() => parseViewportRequest(["5000x844"], null)).toThrow(
    "bad viewport size",
  )
  expect(() => parseViewportRequest(["390x844", "--dpr", "9"], null)).toThrow(
    "bad --dpr",
  )
  expect(() => parseViewportRequest(["--wifi"], null)).toThrow(
    "unknown viewport flag",
  )
})

test("shapeSpec refuses junk so the recorder never applies a bad file", () => {
  expect(shapeSpec(null)).toBeNull()
  expect(shapeSpec("390x844")).toBeNull()
  expect(shapeSpec({ width: "390", height: 844, dpr: 3 })).toMatchObject({
    width: 390,
    mobile: false,
  })
  expect(shapeSpec({ width: 390, height: 844, dpr: 99 })).toBeNull()
  expect(shapeSpec({ width: 390.5, height: 844, dpr: 3 })).toBeNull()
  expect(shapeSpec({ width: 390, height: 844 })).toBeNull()
})

test("signature ignores the preset name; equal metrics are one override", () => {
  const preset = setOf(["iphone-14"])
  const custom = { ...preset, preset: "" }
  expect(viewportSignature(custom)).toBe(viewportSignature(preset))
  expect(viewportSignature(null)).toBe("off")
  expect(viewportSignature({ ...preset, width: 391 })).not.toBe(
    viewportSignature(preset),
  )
})

test("emulationAction applies, clears, or leaves the override alone", () => {
  const spec = setOf(["iphone-14"])
  const sig = viewportSignature(spec)
  expect(emulationAction("off", spec)).toBe("apply")
  expect(emulationAction(sig, spec)).toBe("none")
  expect(emulationAction(sig, null)).toBe("clear")
  expect(emulationAction("off", null)).toBe("none")
  expect(emulationAction("stale", spec)).toBe("apply")
})

test("CDP params carry orientation and a plain UA override", () => {
  const portrait = setOf(["iphone-14"])
  expect(metricsOverride(portrait)).toMatchObject({
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenOrientation: { type: "portraitPrimary", angle: 0 },
  })
  const landscape = setOf(["iphone-14", "--landscape"])
  expect(metricsOverride(landscape).screenOrientation).toEqual({
    type: "landscapePrimary",
    angle: 90,
  })
  // No userAgentMetadata: Chromium rejects a partial one (no brands) as
  // Invalid parameters, sinking the whole override.
  expect(userAgentOverride(portrait)).toEqual({
    userAgent: portrait.userAgent,
  })
  expect(userAgentOverride(setOf(["pixel-7"])).userAgent).toContain("Pixel 7")
  expect(userAgentOverride(setOf(["390x844"]))).toEqual({ userAgent: "" })
})
