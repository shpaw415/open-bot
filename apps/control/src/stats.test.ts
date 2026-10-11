import { describe, expect, test } from "bun:test"
import { parseDuTotal, parsePercent, parseSize } from "./stats"

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
