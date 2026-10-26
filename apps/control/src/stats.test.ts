import { describe, expect, test } from "bun:test"
import {
  effectiveDiskMaxGb,
  memoryLatchedFor,
  memoryPressureDecision,
  memoryRatio,
  parseDuTotal,
  parsePercent,
  parseSize,
} from "./stats"

describe("parseSize", () => {
  test("docker ps -s decimal units", () => {
    expect(parseSize("707MB")).toBe(707_000_000)
    expect(parseSize("28.7kB")).toBe(28_700)
    expect(parseSize("3.7GB")).toBe(3_700_000_000)
    expect(parseSize("1.23TB")).toBe(1_230_000_000_000)
  })

  test("docker stats binary units", () => {
    expect(parseSize("15.14MiB")).toBe(Math.round(15.14 * 1024 ** 2))
    expect(parseSize("4GiB")).toBe(4 * 1024 ** 3)
    expect(parseSize("62.72GiB")).toBe(Math.round(62.72 * 1024 ** 3))
    expect(parseSize("0B")).toBe(0)
  })

  test("docker ps -s writable layer token", () => {
    expect(parseSize("707MB (virtual 3.7GB)".split("(")[0] ?? "")).toBe(
      707_000_000,
    )
  })

  test("garbage", () => {
    expect(parseSize("")).toBe(0)
    expect(parseSize("junk")).toBe(0)
    expect(parseSize("12")).toBe(0)
  })
})

describe("parsePercent", () => {
  test("docker stats CPUPerc", () => {
    expect(parsePercent("40.35%")).toBe(40.35)
    expect(parsePercent("0.00%")).toBe(0)
    expect(parsePercent("junk")).toBe(0)
  })
})

describe("parseDuTotal", () => {
  test("du -sb output for two volumes", () => {
    expect(parseDuTotal("6414669363\t/home/agent\n318944714\t/usr/local")).toBe(
      6414669363 + 318944714,
    )
  })

  test("du lines with errors still carry totals", () => {
    expect(
      parseDuTotal("123\t/a\ndu: cannot read: permission denied\n7\t/b"),
    ).toBe(130)
  })

  test("empty", () => {
    expect(parseDuTotal("")).toBe(0)
  })
})

describe("memoryRatio", () => {
  test("usage over the cgroup cap", () => {
    expect(memoryRatio({ memUsed: 3, memMax: 4 } as never)).toBe(0.75)
    expect(memoryRatio({ memUsed: 1, memMax: 0 } as never)).toBeNull()
  })
})

describe("effectiveDiskMaxGb", () => {
  test("the per-user cap wins over the host-wide cap", () => {
    expect(effectiveDiskMaxGb(20, 50)).toBe(20)
    expect(effectiveDiskMaxGb(20, 0)).toBe(20)
    expect(effectiveDiskMaxGb(1_000_000, 50)).toBe(1_000_000)
  })

  test("no per-user cap falls back to the host-wide cap", () => {
    expect(effectiveDiskMaxGb(null, 50)).toBe(50)
    expect(effectiveDiskMaxGb(undefined, 50)).toBe(50)
    expect(effectiveDiskMaxGb(0, 50)).toBe(50)
    expect(effectiveDiskMaxGb(-5, 50)).toBe(50)
  })

  test("no cap anywhere means full disk (null on the wire)", () => {
    expect(effectiveDiskMaxGb(null, 0)).toBe(0)
    expect(effectiveDiskMaxGb(0, 0)).toBe(0)
  })

  test("fractional per-user caps floor to whole GB", () => {
    expect(effectiveDiskMaxGb(10.9, 0)).toBe(10)
  })
})

describe("memoryPressureDecision", () => {
  const id = "stats-test-user"

  function rearm() {
    memoryPressureDecision(id, 0.5)
    expect(memoryLatchedFor(id)).toBe(false)
  }

  test("one alert per episode, re-armed only under the rearm line", () => {
    rearm()
    expect(memoryPressureDecision(id, 0.86)).toEqual({
      alert: true,
      sweep: false,
    })
    // still latched at 88% — no second alert
    expect(memoryPressureDecision(id, 0.88)).toEqual({
      alert: false,
      sweep: false,
    })
    // dip to 80% is not enough; back up over the line still latched
    expect(memoryPressureDecision(id, 0.8)).toEqual({
      alert: false,
      sweep: false,
    })
    expect(memoryPressureDecision(id, 0.91)).toEqual({
      alert: false,
      sweep: false,
    })
    // under 75% re-arms
    expect(memoryPressureDecision(id, 0.7)).toEqual({
      alert: false,
      sweep: false,
    })
    expect(memoryLatchedFor(id)).toBe(false)
    expect(memoryPressureDecision(id, 0.86)).toEqual({
      alert: true,
      sweep: false,
    })
    rearm()
  })

  test("the sweep rides the alert only at the 90% crossing", () => {
    rearm()
    expect(memoryPressureDecision(id, 0.91)).toEqual({
      alert: true,
      sweep: true,
    })
    expect(memoryPressureDecision(id, 0.95)).toEqual({
      alert: false,
      sweep: false,
    })
    rearm()
  })
})
