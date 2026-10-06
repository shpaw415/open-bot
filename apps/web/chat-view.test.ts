import { describe, expect, test } from "bun:test"
import {
  type ChatMessage,
  modelActivity,
  nearBottom,
  samePayload,
  threadBubbles,
  visibleMessages,
  visibleText,
} from "./src/chat-view"

const toolTurn: ChatMessage = {
  info: { role: "assistant", time: { created: 1, completed: 2 } },
  parts: [
    { type: "step-start" },
    { type: "reasoning", text: "thinking" },
    { type: "tool", text: "ran bash" },
    { type: "text", text: "Done with the file.", synthetic: true },
    { type: "text", text: "Hidden", ignored: true },
    { type: "text", text: "Here is the **result**." },
    { type: "step-finish" },
    { type: "snapshot" },
    { type: "patch" },
    { type: "compaction" },
  ],
}

describe("visible text", () => {
  test("keeps reply text and drops tool use and synthetic parts", () => {
    expect(visibleText(toolTurn)).toBe("Here is the **result**.")
    expect(visibleText(toolTurn)).not.toContain("[tool]")
    expect(visibleText(toolTurn)).not.toContain("thinking")
    expect(visibleText(toolTurn)).not.toContain("ran bash")
  })

  test("drops compaction summaries and empty bubbles", () => {
    const messages: ChatMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
      {
        info: { role: "assistant", summary: true },
        parts: [{ type: "text", text: "summary of the thread" }],
      },
      { info: { role: "assistant" }, parts: [{ type: "tool" }] },
    ]
    expect(visibleMessages(messages).map((item) => item.text)).toEqual(["hi"])
  })

  test("keeps the user reply when OpenCode attaches an empty diff summary", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "user", summary: { diffs: [] } },
        parts: [
          { type: "text", text: "<openviking-context>", synthetic: true },
          { type: "text", text: "a tu gpio-companion en memoire?" },
        ],
      },
    ]
    expect(visibleMessages(messages).map((item) => item.text)).toEqual([
      "a tu gpio-companion en memoire?",
    ])
    expect(threadBubbles(messages).map((item) => item.text)).toEqual([
      "a tu gpio-companion en memoire?",
    ])
  })

  test("folds one answer into a single bubble", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "check the site" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Opening the page." }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "The login form is up." }],
      },
      { info: { role: "user" }, parts: [{ type: "text", text: "sign in" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Signed in." }],
      },
    ]
    expect(threadBubbles(messages).map((item) => item.text)).toEqual([
      "check the site",
      "Opening the page.\n\nThe login form is up.",
      "sign in",
      "Signed in.",
    ])
  })
})

describe("model activity", () => {
  test("maps desktop open, busy, and idle", () => {
    expect(
      modelActivity({ phase: "starting", sending: false, messages: [] }),
    ).toBe("initialize")
    expect(
      modelActivity({ phase: "sleeping", sending: false, messages: [] }),
    ).toBeNull()
    expect(
      modelActivity({
        phase: "running",
        sending: true,
        status: { type: "idle" },
        messages: [],
      }),
    ).toBe("working")
    expect(
      modelActivity({
        phase: "running",
        sending: false,
        status: { type: "busy" },
        messages: [],
      }),
    ).toBe("working")
    expect(
      modelActivity({
        phase: "running",
        sending: false,
        status: { type: "retry" },
        messages: [],
      }),
    ).toBe("working")
    expect(
      modelActivity({
        phase: "running",
        sending: false,
        status: { type: "idle" },
        now: 10_000,
        messages: [
          {
            info: { role: "assistant", time: { created: 9_000 } },
            parts: [{ type: "text", text: "…" }],
          },
        ],
      }),
    ).toBe("working")
    expect(
      modelActivity({
        phase: "running",
        sending: false,
        status: { type: "idle" },
        now: 60_000,
        messages: [
          {
            info: { role: "assistant", time: { created: 1 } },
            parts: [{ type: "text", text: "…" }],
          },
        ],
      }),
    ).toBe("done")
    expect(
      modelActivity({
        phase: "running",
        sending: false,
        status: { type: "idle" },
        messages: [
          {
            info: { role: "assistant", time: { created: 1, completed: 2 } },
            parts: [{ type: "text", text: "ok" }],
          },
        ],
      }),
    ).toBe("done")
  })
})

describe("scroll stick", () => {
  test("treats the bottom as stuck and a scroll-up as free", () => {
    expect(nearBottom(1000, 960, 40)).toBe(true)
    expect(nearBottom(1000, 400, 40)).toBe(false)
  })

  test("skips identical polls", () => {
    const body = [{ info: { role: "user" } }]
    expect(samePayload(JSON.stringify(body), body)).toBe(true)
    expect(samePayload(JSON.stringify(body), [])).toBe(false)
  })
})
