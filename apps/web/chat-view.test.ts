import { describe, expect, test } from "bun:test"
import {
  type ChatMessage,
  chatImageUrl,
  modelActivity,
  nearBottom,
  samePayload,
  splitScreenHandoff,
  threadBubbles,
  visibleMessages,
  visibleText,
  workspaceImagePath,
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

  test("starts a new agent bubble after a 5 minute gap", () => {
    const t0 = 1_700_000_000_000
    const later = t0 + 4 * 60_000 + 5 * 60_000
    const messages: ChatMessage[] = [
      {
        info: { role: "assistant", time: { created: t0 } },
        parts: [{ type: "text", text: "First." }],
      },
      {
        info: { role: "assistant", time: { created: t0 + 4 * 60_000 } },
        parts: [{ type: "text", text: "Still this reply." }],
      },
      {
        info: { role: "assistant", time: { created: later } },
        parts: [{ type: "text", text: "Later." }],
      },
      {
        info: { role: "user", time: { created: later + 1_000 } },
        parts: [{ type: "text", text: "ok" }],
      },
    ]
    const bubbles = threadBubbles(messages)
    expect(bubbles.map((item) => item.text)).toEqual([
      "First.\n\nStill this reply.",
      "Later.",
      "ok",
    ])
    expect(bubbles.map((item) => item.sentAt)).toEqual([
      t0,
      later,
      later + 1_000,
    ])
  })

  test("shows a copied cron result as an agent bubble", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "user" },
        parts: [
          { type: "text", text: "[cron-result: daily]\n\nfound 3 changes" },
        ],
      },
    ]
    const bubbles = threadBubbles(messages)
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.info?.role).toBe("assistant")
    expect(bubbles[0]?.text).toBe("found 3 changes")
  })

  test("keeps an image-only reply and hides tool screenshots", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", url: "file:///home/agent/workspace/shot.png" },
          {
            type: "file",
            mime: "image/png",
            url: "file:///home/agent/workspace/koi.png",
          },
        ],
      },
    ]
    const bubbles = threadBubbles(messages)
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.text).toBe("")
    expect(bubbles[0]?.images).toEqual([
      `/api/workspace/image?path=${encodeURIComponent("/home/agent/workspace/koi.png")}`,
    ])
    expect(
      threadBubbles([
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "tool",
              mime: "image/png",
              url: "file:///home/agent/workspace/shot.png",
            },
          ],
        },
      ]),
    ).toEqual([])
  })

  test("a screen marker hands the live screen to the user", () => {
    expect(
      splitScreenHandoff("Sign in.\n\n![screen](open-bot://screen)"),
    ).toEqual({ text: "Sign in.", handoff: true })
    expect(splitScreenHandoff("see open-bot://other")).toEqual({
      text: "see open-bot://other",
      handoff: false,
    })
    const messages: ChatMessage[] = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Opening the page." }],
      },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "Please sign in.\n\n![screen](open-bot://screen)",
          },
        ],
      },
    ]
    const bubbles = threadBubbles(messages)
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.text).toBe("Opening the page.\n\nPlease sign in.")
    expect(bubbles[0]?.handoff).toBe(true)
    expect(bubbles[0]?.text).not.toContain("open-bot://screen")
  })

  test("turns a bare workspace image path into markdown and blocks other paths", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "/home/agent/workspace/koi.png" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "saved /home/agent/workspace/other.png",
          },
        ],
      },
    ]
    expect(threadBubbles(messages).map((item) => item.text)).toEqual([
      "![koi.png](/home/agent/workspace/koi.png)\n\nsaved /home/agent/workspace/other.png",
    ])
    expect(workspaceImagePath("/home/agent/.config/cf-ai/auth.json")).toBeNull()
    expect(
      workspaceImagePath("/home/agent/workspace/../.config/cf-ai/auth.json"),
    ).toBeNull()
    expect(workspaceImagePath("/home/agent/workspace/note.txt")).toBeNull()
    expect(chatImageUrl("javascript:alert(1)")).toBe("")
    expect(chatImageUrl("data:image/png;base64,aaaa")).toBe("")
    expect(chatImageUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    )
    expect(chatImageUrl("/home/agent/workspace/koi.png")).toBe(
      `/api/workspace/image?path=${encodeURIComponent("/home/agent/workspace/koi.png")}`,
    )
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
