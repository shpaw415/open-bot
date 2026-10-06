import { describe, expect, test } from "bun:test"
import {
  fleetOption,
  kindBarOption,
  tokensFor,
  type UsageDay,
} from "./src/usage-charts"

const daily: UsageDay[] = [
  {
    day: "2026-10-05",
    users: [
      {
        userId: "a",
        email: "a@localhost",
        byKind: {
          chat: {
            promptTokens: 8,
            completionTokens: 2,
            totalTokens: 10,
            calls: 1,
          },
        },
      },
    ],
  },
]

describe("usage charts", () => {
  test("builds a stacked fleet series and per-user bars", () => {
    const fleet = fleetOption(daily, { text: "#111", split: "#ccc" })
    expect(fleet.series[0]?.name).toBe("a@localhost")
    expect(fleet.series[0]?.data).toEqual([10])
    const bars = kindBarOption(daily, "a", { text: "#111", split: "#ccc" })
    expect(bars.series[0]?.data[0]).toBe(8)
    expect(tokensFor(daily, "a")).toEqual({ total: 10, calls: 1 })
  })
})
