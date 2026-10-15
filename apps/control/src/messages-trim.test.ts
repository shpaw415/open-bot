import { describe, expect, test } from "bun:test"
import {
  ATTACHMENT_URL_CAP,
  trimDashboardEvent,
  trimDashboardMessages,
} from "./messages-trim"

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

describe("trimDashboardEvent", () => {
  const bigUrl = `data:image/png;base64,${"y".repeat(ATTACHMENT_URL_CAP + 10)}`
  const bigOutput = "x".repeat(20_000)

  test("trims tool part payloads on message.part.updated", () => {
    const event = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_1",
          messageID: "msg_1",
          type: "tool",
          state: { status: "completed", output: bigOutput },
        },
      },
    }
    const sent = trimDashboardEvent(event)
    const state = (sent.properties as { part: { state: { output: string } } })
      .part.state
    expect(state.output.startsWith("x".repeat(8_000))).toBe(true)
    expect(state.output).toContain("[truncated — 12000 more chars]")
  })

  test("stubs big attachment urls on part.updated", () => {
    const event = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_1",
          type: "tool",
          state: {
            attachments: [
              { id: "att_1", mime: "image/png", url: bigUrl },
              { id: "att_2", url: "/f.txt" },
            ],
          },
        },
      },
    }
    const sent = trimDashboardEvent(event)
    const attachments = (
      sent.properties as {
        part: { state: { attachments: { url: string }[] } }
      }
    ).part.state.attachments
    expect(attachments[0].url).toBe("data:truncated")
    expect(attachments[1].url).toBe("/f.txt")
  })

  test("trims nested parts on message.updated info", () => {
    const event = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          role: "assistant",
          parts: [
            {
              type: "tool",
              state: { output: bigOutput, attachments: [{ url: bigUrl }] },
            },
          ],
        },
      },
    }
    const sent = trimDashboardEvent(event)
    const info = (
      sent.properties as unknown as {
        info: {
          parts: [{ state: { output: string; attachments: { url: string }[] } }]
        }
      }
    ).info
    expect(info.parts[0].state.output).toContain("[truncated")
    expect(info.parts[0].state.attachments[0].url).toBe("data:truncated")
  })

  test("copy-on-write: the original event keeps raw payloads for observers", () => {
    const event = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_1",
          type: "tool",
          state: { output: bigOutput, attachments: [{ url: bigUrl }] },
        },
      },
    }
    const sent = trimDashboardEvent(event)
    expect(sent).not.toBe(event)
    const sentPart = (
      sent.properties as {
        part: { state: { output: string; attachments: { url: string }[] } }
      }
    ).part
    expect(sentPart.state.output).toContain("[truncated")
    expect(sentPart.state.attachments[0].url).toBe("data:truncated")
    const rawPart = (
      event.properties as {
        part: { state: { output: string; attachments: { url: string }[] } }
      }
    ).part
    expect(rawPart.state.output).toBe(bigOutput)
    expect(rawPart.state.attachments[0].url).toBe(bigUrl)
  })

  test("returns the same event when nothing needs trimming", () => {
    const event = {
      type: "message.part.updated",
      properties: { part: { id: "prt_1", type: "text", text: "hi" } },
    }
    expect(trimDashboardEvent(event)).toBe(event)
  })

  test("leaves other event types and shapes untouched", () => {
    const idle = {
      type: "session.idle",
      properties: {
        sessionID: "s1",
        part: { type: "tool", state: { output: bigOutput } },
      },
    }
    const before = JSON.stringify(idle)
    trimDashboardEvent(idle)
    expect(JSON.stringify(idle)).toBe(before)
    const noProps: { type: string; properties?: unknown } = {
      type: "message.part.updated",
    }
    trimDashboardEvent(noProps)
    expect(noProps.properties).toBeUndefined()
  })
})
