import { describe, expect, test } from "bun:test"
import {
  newestMessageTime,
  newestTool,
  STUCK_TOOL_MS,
  toolLimit,
  toolStale,
  toolStuck,
} from "./stuck"

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

  test("a documented ob-thread wait gets the long teammate budget", () => {
    const now = 10_000_000
    expect(
      toolLimit([running(now - 1, "ob-thread wait ses_abc --timeout 90")]),
    ).toBe(6 * STUCK_TOOL_MS)
    // other ob-thread commands keep the default budget
    expect(toolLimit([running(now - 1, "ob-thread list")])).toBe(STUCK_TOOL_MS)
  })

  test("a tool frozen by a killed turn is stale once the session is re-prompted", () => {
    const now = 10_000_000
    const corpse = {
      info: { time: { created: now - STUCK_TOOL_MS - 60_000 } },
      parts: [
        {
          type: "tool",
          state: {
            status: "running",
            time: { start: now - STUCK_TOOL_MS - 30_000 },
            input: { command: "sleep 500" },
          },
        },
      ],
    }
    expect(newestMessageTime([corpse])).toBe(now - STUCK_TOOL_MS - 60_000)
    expect(toolStuck([corpse], now)).toBe(true)
    // the corpse stops mattering once a fresh turn created newer messages
    const reprompted = [
      corpse,
      { info: { time: { created: now - 5_000 } }, parts: [] },
    ]
    expect(newestTool(reprompted)).toEqual({
      status: "running",
      start: now - STUCK_TOOL_MS - 30_000,
      command: "sleep 500",
    })
    expect(toolStale(reprompted)).toBe(true)
    expect(toolStuck(reprompted, now)).toBe(true)
  })

  test("a live tool running inside the newest message is not stale", () => {
    const now = 10_000_000
    const live = {
      info: { time: { created: now - STUCK_TOOL_MS - 2_000 } },
      parts: [
        {
          type: "tool",
          state: {
            status: "running",
            time: { start: now - STUCK_TOOL_MS },
            input: { command: "sleep 500" },
          },
        },
      ],
    }
    expect(toolStuck([live], now)).toBe(true)
    expect(toolStale([live])).toBe(false)
  })

  test("messages without timestamps never count as stale", () => {
    const now = 10_000_000
    expect(toolStale([running(now - STUCK_TOOL_MS - 1, "sleep 500")])).toBe(
      false,
    )
    expect(newestMessageTime(["nope"])).toBe(0)
    expect(newestMessageTime(null)).toBe(0)
  })
})
