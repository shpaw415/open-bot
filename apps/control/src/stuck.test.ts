import { describe, expect, test } from "bun:test"
import { newestTool, STUCK_TOOL_MS, toolLimit, toolStuck } from "./stuck"

const running = (start: number, command = "") => ({
  parts: [
    {
      type: "tool",
      state: { status: "running", time: { start }, input: { command } },
    },
  ],
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
    expect(newestTool([running(50)])).toEqual({
      status: "running",
      start: 50,
      command: "",
    })
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

  test("desktop nav commands get a shorter budget than the default", () => {
    const now = 10_000_000
    expect(toolLimit([running(now - 1, "ob-nav --session s --goal g")])).toBe(
      0.75 * STUCK_TOOL_MS,
    )
    expect(toolLimit([running(now - 1, "sleep 500")])).toBe(STUCK_TOOL_MS)
  })

  test("blender pipelines get long budgets", () => {
    const now = 10_000_000
    expect(
      toolLimit([
        running(
          now - 1,
          'blender-team "an owl" -o /home/agent/workspace/o.glb',
        ),
      ]),
    ).toBe(6 * STUCK_TOOL_MS)
    expect(
      toolLimit([
        running(now - 1, "blender --background --python-expr 'import bpy'"),
      ]),
    ).toBe(3 * STUCK_TOOL_MS)
  })
})
