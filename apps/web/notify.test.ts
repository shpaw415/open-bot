import { describe, expect, test } from "bun:test"
import type { ChatMessage } from "./src/chat-view"
import {
  armsSession,
  CLAIM_TTL_MS,
  type ClaimStorage,
  claimNotice,
  clearThreadUnread,
  freshReply,
  idleSessionId,
  markThreadUnread,
  notificationPreview,
  readUnread,
  shouldNotify,
} from "./src/notify"

function memory(): ClaimStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

const reply = (
  id: string,
  text: string,
  completed: number,
  role = "assistant",
): ChatMessage => ({
  info: {
    id,
    role,
    time: { created: completed - 10, completed },
  } as ChatMessage["info"],
  parts: [{ type: "text", text }],
})

describe("reply notices", () => {
  test("arms on part updates and busy status, not idle history", () => {
    expect(
      armsSession({
        type: "message.part.updated",
        properties: { part: { sessionID: "s1" } },
      }),
    ).toBe("s1")
    expect(
      armsSession({
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      }),
    ).toBe("s1")
    expect(
      armsSession({
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "idle" } },
      }),
    ).toBe("")
    expect(
      armsSession({ type: "session.idle", properties: { sessionID: "s1" } }),
    ).toBe("")
    expect(
      idleSessionId({ type: "session.idle", properties: { sessionID: "s1" } }),
    ).toBe("s1")
  })

  test("skips only the visible chat for that thread", () => {
    const base = {
      hidden: false,
      path: "/",
      tab: "chat",
      viewingSessionId: "s1",
      replySessionId: "s1",
    }
    expect(shouldNotify(base)).toBe(false)
    expect(shouldNotify({ ...base, hidden: true })).toBe(true)
    expect(shouldNotify({ ...base, tab: "desktop" })).toBe(true)
    expect(shouldNotify({ ...base, tab: "cron" })).toBe(true)
    expect(shouldNotify({ ...base, viewingSessionId: "other" })).toBe(true)
    expect(shouldNotify({ ...base, path: "/config" })).toBe(true)
    expect(shouldNotify({ ...base, path: "/providers" })).toBe(true)
    expect(shouldNotify({ ...base, path: "/admin" })).toBe(true)
  })

  test("flattens and truncates the preview", () => {
    expect(notificationPreview("  hello\n\nworld  ")).toBe("hello world")
    expect(notificationPreview("a".repeat(120))).toBe("a".repeat(120))
    expect(notificationPreview("a".repeat(121))).toBe(`${"a".repeat(119)}…`)
  })

  test("picks the newest fresh assistant text and skips tool-only turns", () => {
    const armedAt = 1_000_000
    const stale = reply("old", "earlier answer", 100)
    const tools: ChatMessage = {
      info: {
        id: "tools",
        role: "assistant",
        time: { created: armedAt, completed: armedAt + 100 },
      },
      parts: [{ type: "tool", text: "ran bash" }],
    }
    const messages: ChatMessage[] = [
      stale,
      reply("user", "hello", armedAt - 50, "user"),
      tools,
      reply("new", "Here is the **result**.", armedAt + 200),
    ]
    expect(freshReply(messages, armedAt)).toEqual({
      id: "new",
      text: "Here is the **result**.",
      completedAt: armedAt + 200,
    })
    expect(freshReply([stale, tools], armedAt)).toBeNull()
  })

  test("claims a message once until the ttl expires", () => {
    const storage = memory()
    expect(claimNotice(storage, "m1", 1_000, "a")).toBe(true)
    expect(claimNotice(storage, "m1", 1_000, "b")).toBe(false)
    expect(claimNotice(storage, "m1", 1_000 + CLAIM_TTL_MS, "c")).toBe(true)
    expect(claimNotice(storage, "", 1_000, "d")).toBe(false)
  })

  test("marks a thread unread until it is opened", () => {
    const storage = memory()
    expect(markThreadUnread(storage, "s1")).toBe(true)
    expect(markThreadUnread(storage, "s1")).toBe(false)
    expect(markThreadUnread(storage, "s2")).toBe(true)
    expect(readUnread(storage)).toEqual(["s1", "s2"])
    expect(clearThreadUnread(storage, "s1")).toBe(true)
    expect(readUnread(storage)).toEqual(["s2"])
    expect(clearThreadUnread(storage, "s1")).toBe(false)
  })
})
