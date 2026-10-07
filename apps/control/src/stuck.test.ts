import { describe, expect, test } from "bun:test"
import { newestTool, STUCK_TOOL_MS, toolStuck } from "./stuck"

const running = (start: number) => ({
  parts: [{ type: "tool", state: { status: "running", time: { start } } }],
})

describe("stuck tools", () => {
  test("ignores a finished tool and a young running tool", () => {
    const now = 1_000_000
    expect(
      toolStuck(
        [
          {
            parts: [
              {
                type: "tool",
                state: { status: "completed", time: { start: 1 } },
              },
            ],
          },
        ],
        now,
      ),
    ).toBe(false)
    expect(toolStuck([running(now - 1_000)], now)).toBe(false)
    expect(newestTool([running(50)])).toEqual({ status: "running", start: 50 })
  })

  test("the newest running tool past 90s is stuck", () => {
    const now = 200_000
    const messages = [
      running(now - STUCK_TOOL_MS - 1),
      {
        parts: [
          {
            type: "tool",
            state: { status: "completed", time: { start: now - 1_000 } },
          },
        ],
      },
    ]
    expect(toolStuck(messages, now)).toBe(false)
    expect(toolStuck([running(now - STUCK_TOOL_MS)], now)).toBe(true)
    expect(toolStuck("nope", now)).toBe(false)
  })
})
