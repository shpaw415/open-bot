import { describe, expect, test } from "bun:test"
import type { ChatMessage } from "./chat-view"
import {
  infoPredatesWindow,
  MESSAGE_PAGE_MAX,
  MESSAGE_PAGE_SIZE,
  type MessagePage,
  mergeOlderPage,
  mergeTailPage,
  messagePageUrl,
  parseMessagePage,
  tailLimit,
} from "./message-page"

function msg(id: string, text = id, created?: number): ChatMessage {
  return {
    info: { id, role: "assistant", time: created ? { created } : undefined },
    parts: [{ type: "text", text }],
  }
}

function page(
  messages: ChatMessage[],
  extra: Partial<MessagePage> = {},
): MessagePage {
  return {
    messages,
    total: messages.length,
    hasMore: false,
    nextBefore: null,
    startUserCount: 0,
    ...extra,
  }
}

function ids(messages: ChatMessage[]): string[] {
  return messages.map((row) => row.info?.id ?? "")
}

describe("messagePageUrl", () => {
  test("builds tail and older asks with encoded ids", () => {
    expect(messagePageUrl("s 1", 100)).toBe(
      "/api/opencode/session/s%201/message?limit=100",
    )
    expect(messagePageUrl("s1", 50, "m/9")).toBe(
      "/api/opencode/session/s1/message?limit=50&before=m%2F9",
    )
    expect(messagePageUrl("s1", 50, null)).toBe(
      "/api/opencode/session/s1/message?limit=50",
    )
  })
})

describe("tailLimit", () => {
  test("covers the loaded window up to the server cap", () => {
    expect(tailLimit(0)).toBe(MESSAGE_PAGE_SIZE)
    expect(tailLimit(250)).toBe(250)
    expect(tailLimit(5000)).toBe(MESSAGE_PAGE_MAX)
  })
})

describe("parseMessagePage", () => {
  test("a bare array reads as one complete page", () => {
    const parsed = parseMessagePage([msg("m1"), msg("m2")])
    expect(ids(parsed.messages)).toEqual(["m1", "m2"])
    expect(parsed.hasMore).toBe(false)
    expect(parsed.nextBefore).toBeNull()
    expect(parsed.total).toBe(2)
  })

  test("an envelope carries its cursor and user offset", () => {
    const parsed = parseMessagePage({
      messages: [msg("m3")],
      total: 9,
      hasMore: true,
      nextBefore: "m3",
      startUserCount: 2,
    })
    expect(parsed.hasMore).toBe(true)
    expect(parsed.nextBefore).toBe("m3")
    expect(parsed.startUserCount).toBe(2)
    expect(parsed.total).toBe(9)
  })

  test("hasMore without a cursor cannot be followed", () => {
    const parsed = parseMessagePage({
      messages: [msg("m1")],
      hasMore: true,
      nextBefore: null,
    })
    expect(parsed.hasMore).toBe(false)
  })

  test("junk shapes parse to an empty page", () => {
    for (const body of [null, 42, "nope", { messages: "x" }, {}]) {
      const parsed = parseMessagePage(body)
      expect(parsed.messages).toEqual([])
      expect(parsed.hasMore).toBe(false)
    }
  })
})

describe("mergeTailPage", () => {
  const window = [msg("m1"), msg("m2"), msg("m3"), msg("m4")]

  test("replaces from the first overlap and keeps the older prefix", () => {
    const merged = mergeTailPage(
      window,
      page([msg("m3", "edited"), msg("m4"), msg("m5")]),
    )
    expect(ids(merged.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"])
    expect(merged.messages[2]?.parts?.[0]?.text).toBe("edited")
    expect(merged.keptPrefix).toBe(true)
  })

  test("a removal inside the overlap drops the message", () => {
    const merged = mergeTailPage(window, page([msg("m2"), msg("m4")]))
    expect(ids(merged.messages)).toEqual(["m1", "m2", "m4"])
  })

  test("overlap at the window start hands meta back to the page", () => {
    const merged = mergeTailPage(window, page([msg("m1"), msg("m2")]))
    expect(ids(merged.messages)).toEqual(["m1", "m2"])
    expect(merged.keptPrefix).toBe(false)
  })

  test("no overlap resets to the page instead of hiding a gap", () => {
    const merged = mergeTailPage(window, page([msg("m8"), msg("m9")]))
    expect(ids(merged.messages)).toEqual(["m8", "m9"])
    expect(merged.keptPrefix).toBe(false)
  })

  test("an empty window takes the page as is; an empty page clears", () => {
    expect(ids(mergeTailPage([], page([msg("m1")])).messages)).toEqual(["m1"])
    expect(mergeTailPage(window, page([])).messages).toEqual([])
  })

  test("duplicate ids keep the freshest copy once", () => {
    const merged = mergeTailPage(
      [msg("m1", "old")],
      page([msg("m1", "stale"), msg("m1", "fresh")]),
    )
    expect(merged.messages).toHaveLength(1)
    expect(merged.messages[0]?.parts?.[0]?.text).toBe("fresh")
  })
})

describe("mergeOlderPage", () => {
  test("prepends older history and dedupes the seam", () => {
    const merged = mergeOlderPage(
      [msg("m3", "live"), msg("m4")],
      page([msg("m1"), msg("m2"), msg("m3", "stale")]),
    )
    expect(ids(merged)).toEqual(["m1", "m2", "m3", "m4"])
    expect(merged[2]?.parts?.[0]?.text).toBe("live")
  })

  test("empty pages and windows pass through", () => {
    const window = [msg("m1")]
    expect(mergeOlderPage(window, page([]))).toBe(window)
    expect(ids(mergeOlderPage([], page([msg("m0")])))).toEqual(["m0"])
  })
})

describe("infoPredatesWindow", () => {
  const window = [msg("m5", "x", 500), msg("m6", "y", 600)]

  test("an unknown older info predates the window", () => {
    expect(
      infoPredatesWindow(window, { id: "m1", time: { created: 100 } }),
    ).toBe(true)
  })

  test("new, in-window, and undated infos do not", () => {
    expect(
      infoPredatesWindow(window, { id: "m9", time: { created: 900 } }),
    ).toBe(false)
    expect(
      infoPredatesWindow(window, { id: "m5", time: { created: 100 } }),
    ).toBe(false)
    expect(infoPredatesWindow(window, { id: "m1" })).toBe(false)
    expect(infoPredatesWindow([], { id: "m1", time: { created: 1 } })).toBe(
      false,
    )
  })
})
