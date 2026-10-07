import { describe, expect, test } from "bun:test"
import {
  type ChatMessage,
  chatImageUrl,
  eventTouchesSession,
  handoffStamp,
  modelActivity,
  nearBottom,
  samePayload,
  showLiveScreen,
  splitScreenHandoff,
  threadBubbles,
  transcriptBubbles,
  userMessageCount,
  visibleMessages,
  visibleText,
  vncFrameSrc,
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

  test("a takeover hides the bubble viewer until a newer handoff", () => {
    expect(
      showLiveScreen({
        handoff: true,
        isLast: true,
        held: false,
        dismissed: false,
      }),
    ).toBe(true)
    expect(
      showLiveScreen({
        handoff: true,
        isLast: true,
        held: true,
        dismissed: false,
      }),
    ).toBe(false)
    expect(
      showLiveScreen({
        handoff: true,
        isLast: true,
        held: false,
        dismissed: true,
      }),
    ).toBe(false)
    expect(handoffStamp({ text: "Sign in.", sentAt: 5 })).toBe("5:Sign in.")
    const src = vncFrameSrc("desktop/view/websockify?token=ses_abc", false)
    expect(src).toContain("view_only=1")
    expect(src).toContain("resize=scale")
    expect(
      vncFrameSrc("desktop/view/websockify?token=ses_abc", true),
    ).toContain("view_only=0")
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

describe("send receipts", () => {
  const prior: ChatMessage = {
    info: { role: "user", time: { created: 1 } },
    parts: [{ type: "text", text: "earlier" }],
  }

  test("shows the outgoing text immediately with a sending mark", () => {
    const bubbles = transcriptBubbles(
      [prior],
      [
        {
          id: "r1",
          text: "hello",
          status: "sending",
          sentAt: 50,
          baseline: userMessageCount([prior]),
        },
      ],
    )
    expect(bubbles.map((item) => item.message.text)).toEqual([
      "earlier",
      "hello",
    ])
    expect(bubbles[1]?.mark).toBe("sending")
    expect(bubbles[1]?.pendingId).toBe("r1")
  })

  test("keeps a check on the optimistic bubble until the server copy arrives", () => {
    const bubbles = transcriptBubbles(
      [],
      [
        {
          id: "r1",
          text: "hello",
          status: "sent",
          sentAt: 50,
          baseline: 0,
        },
      ],
    )
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.mark).toBe("sent")
  })

  test("moves the check onto the accepted server message and drops the duplicate", () => {
    const messages: ChatMessage[] = [
      prior,
      {
        info: { role: "user", time: { created: 60 } },
        parts: [{ type: "text", text: "hello" }],
      },
    ]
    const bubbles = transcriptBubbles(messages, [
      {
        id: "r1",
        text: "hello",
        status: "sent",
        sentAt: 50,
        baseline: 1,
      },
    ])
    expect(bubbles.map((item) => item.message.text)).toEqual([
      "earlier",
      "hello",
    ])
    expect(bubbles[1]?.mark).toBe("sent")
    expect(bubbles[1]?.pendingId).toBeNull()
  })

  test("shows a file-only send until the joined path arrives", () => {
    const pending = transcriptBubbles(
      [],
      [
        {
          id: "r1",
          text: "",
          files: ["notes.xls"],
          status: "sending",
          sentAt: 50,
          baseline: 0,
        },
      ],
    )
    expect(pending).toHaveLength(1)
    expect(pending[0]?.message.text).toBe("Joined file: notes.xls")
    expect(pending[0]?.mark).toBe("sending")
    const accepted = transcriptBubbles(
      [
        {
          info: { role: "user", time: { created: 60 } },
          parts: [
            {
              type: "text",
              text: "Joined file: /home/agent/workspace/uploads/abcd1234-notes.xls",
            },
          ],
        },
      ],
      [
        {
          id: "r1",
          text: "",
          files: ["notes.xls"],
          status: "sent",
          sentAt: 50,
          baseline: 0,
        },
      ],
    )
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.pendingId).toBeNull()
    expect(accepted[0]?.mark).toBe("sent")
    expect(accepted[0]?.message.text).toContain("notes.xls")
  })

  test("marks a joined file on the user text without a duplicate", () => {
    const bubbles = transcriptBubbles(
      [
        {
          info: { role: "user", time: { created: 60 } },
          parts: [
            {
              type: "text",
              text: "look\n\nJoined file: /home/agent/workspace/uploads/abcd1234-cat.png",
            },
          ],
        },
      ],
      [
        {
          id: "r1",
          text: "look",
          files: ["cat.png"],
          status: "sent",
          sentAt: 50,
          baseline: 0,
        },
      ],
    )
    expect(bubbles.map((item) => item.message.text)).toEqual([
      "look\n\nJoined file: /home/agent/workspace/uploads/abcd1234-cat.png",
    ])
    expect(bubbles[0]?.mark).toBe("sent")
    expect(bubbles[0]?.pendingId).toBeNull()
  })

  test("does not mark an older copy of the same text", () => {
    const messages: ChatMessage[] = [
      {
        info: { role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", time: { created: 2 } },
        parts: [{ type: "text", text: "ok" }],
      },
    ]
    const bubbles = transcriptBubbles(messages, [
      {
        id: "r1",
        text: "hello",
        status: "sending",
        sentAt: 50,
        baseline: 1,
      },
    ])
    expect(bubbles.map((item) => [item.message.text, item.mark])).toEqual([
      ["hello", null],
      ["ok", null],
      ["hello", "sending"],
    ])
  })

  test("does not flash a sent bubble while a loaded thread is cleared", () => {
    expect(
      transcriptBubbles(
        [],
        [
          {
            id: "r1",
            text: "hello",
            status: "sent",
            sentAt: 50,
            baseline: 2,
          },
        ],
      ),
    ).toEqual([])
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

describe("event stream session matching", () => {
  test("matches every opencode event payload shape", () => {
    expect(
      eventTouchesSession(
        { type: "session.status", properties: { sessionID: "s1" } },
        "s1",
      ),
    ).toBe(true)
    expect(
      eventTouchesSession(
        { type: "session.updated", properties: { info: { id: "s1" } } },
        "s1",
      ),
    ).toBe(true)
    expect(
      eventTouchesSession(
        {
          type: "message.updated",
          properties: { info: { sessionID: "s1", role: "assistant" } },
        },
        "s1",
      ),
    ).toBe(true)
    expect(
      eventTouchesSession(
        {
          type: "message.part.updated",
          properties: { part: { sessionID: "s1" } },
        },
        "s1",
      ),
    ).toBe(true)
  })

  test("ignores other sessions and malformed payloads", () => {
    expect(
      eventTouchesSession(
        { type: "message.updated", properties: { sessionID: "s2" } },
        "s1",
      ),
    ).toBe(false)
    expect(eventTouchesSession({ type: "cron.changed" }, "s1")).toBe(false)
    expect(
      eventTouchesSession(
        { type: "message.updated", properties: { sessionID: 42 } },
        "s1",
      ),
    ).toBe(false)
    expect(eventTouchesSession({ type: "message.updated" }, "s1")).toBe(false)
  })
})
