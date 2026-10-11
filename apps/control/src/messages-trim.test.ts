import { describe, expect, test } from "bun:test"
import { ATTACHMENT_URL_CAP, trimDashboardMessages } from "./messages-trim"

describe("trimDashboardMessages", () => {
  test("caps long tool output and stubs big attachment urls", () => {
    const big = "x".repeat(20_000)
    const messages = [
      {
        info: { id: "msg_1", role: "assistant" },
        parts: [
          { type: "text", text: "hello" },
          {
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              output: big,
              attachments: [
                {
                  id: "att_1",
                  type: "file",
                  mime: "image/png",
                  url: `data:image/png;base64,${"y".repeat(ATTACHMENT_URL_CAP + 10)}`,
                },
                {
                  id: "att_2",
                  type: "file",
                  mime: "text/plain",
                  url: "/f.txt",
                },
              ],
            },
          },
        ],
      },
    ]
    const trimmed = trimDashboardMessages(messages) as [
      {
        parts: [
          { text: string },
          {
            state: {
              output: string
              attachments: [{ url: string; mime: string }, { url: string }]
            }
          },
        ]
      },
    ]
    const state = trimmed[0].parts[1].state
    expect(state.output.startsWith("x".repeat(8_000))).toBe(true)
    expect(state.output).toContain("[truncated — 12000 more chars]")
    expect(state.attachments[0].url).toBe("data:truncated")
    expect(state.attachments[0].mime).toBe("image/png")
    expect(state.attachments[1].url).toBe("/f.txt")
  })

  test("leaves short output, file parts, and non-message shapes alone", () => {
    const messages = [
      {
        parts: [
          { type: "file", url: `data:image/png;base64,${"z".repeat(9_000)}` },
          {
            type: "tool",
            state: { status: "completed", output: "short" },
          },
        ],
      },
      { other: true },
      "not an object",
    ]
    const before = JSON.stringify(messages)
    expect(JSON.stringify(trimDashboardMessages(messages))).toBe(before)
  })

  test("passes through non-arrays untouched", () => {
    expect(trimDashboardMessages(null)).toBe(null)
    expect(trimDashboardMessages({} as unknown)).toEqual({})
  })
})
