import { describe, expect, test } from "bun:test"
import { type ChatMessage, type ChatPart, transcriptBubbles } from "./chat-view"
import { formatWorkDuration, timelineRows } from "./timeline"

const user = (id: string, text: string, at: number): ChatMessage => ({
  info: { id, role: "user", time: { created: at } },
  parts: [{ type: "text", text }],
})

const assistant = (
  id: string,
  created: number,
  completed: number | undefined,
  parts: ChatPart[],
): ChatMessage => ({
  info: {
    id,
    role: "assistant",
    time: completed ? { created, completed } : { created },
  },
  parts,
})

const tool = (
  name: string,
  title?: string,
  status = "completed",
): ChatPart => ({
  type: "tool",
  tool: name,
  state: { status, ...(title ? { title } : {}) },
})

describe("timelineRows", () => {
  test("aggregates one work row per turn after its assistant bubbles", () => {
    const messages = [
      user("u1", "look around", 1_000),
      assistant("a1", 2_000, 5_000, [
        tool("read", "src/app.ts"),
        { type: "text", text: "checking" },
      ]),
      assistant("a2", 5_500, 62_000, [
        tool("bash"),
        { type: "text", text: "done" },
      ]),
      user("u2", "thanks", 70_000),
      assistant("a3", 71_000, 72_000, [{ type: "text", text: "welcome" }]),
    ]
    const entries = transcriptBubbles(messages, [])
    const rows = timelineRows(entries, messages)
    // a1+a2 burst-merge into one bubble; the work row follows it.
    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "message",
      "work",
      "message",
      "message",
    ])
    const work = rows.filter((row) => row.kind === "work")
    expect(work).toHaveLength(1)
    if (work[0]?.kind !== "work") throw new Error("work row missing")
    expect(work[0].work.steps.map((step) => step.title)).toEqual([
      "src/app.ts",
      "bash",
    ])
    expect(work[0].work.steps.map((step) => step.tool)).toEqual([
      "read",
      "bash",
    ])
    expect(work[0].work.durationMs).toBe(60_000)
    expect(work[0].work.running).toBe(false)
  })

  test("marks only the last turn's work running while live", () => {
    const messages = [
      user("u1", "go", 0),
      assistant("a1", 1_000, 2_000, [tool("read")]),
      user("u2", "again", 3_000),
      assistant("a2", 4_000, undefined, [tool("bash", undefined, "running")]),
    ]
    const rows = timelineRows(transcriptBubbles(messages, []), messages, {
      live: true,
    })
    const work = rows.filter((row) => row.kind === "work")
    expect(work.map((row) => row.kind === "work" && row.work.running)).toEqual([
      false,
      true,
    ])
    const idle = timelineRows(transcriptBubbles(messages, []), messages)
    expect(
      idle
        .filter((row) => row.kind === "work")
        .map((row) => row.kind === "work" && row.work.running),
    ).toEqual([false, false])
  })

  test("a pure-text conversation has no work rows", () => {
    const messages = [
      user("u1", "hi", 0),
      assistant("a1", 1, 2, [{ type: "text", text: "hello" }]),
    ]
    const rows = timelineRows(transcriptBubbles(messages, []), messages)
    expect(rows.every((row) => row.kind === "message")).toBe(true)
  })
})

describe("formatWorkDuration", () => {
  test("reads as compact French-ish units", () => {
    expect(formatWorkDuration(4_000)).toBe("4 s")
    expect(formatWorkDuration(59_400)).toBe("59 s")
    expect(formatWorkDuration(134_000)).toBe("2 min 14 s")
    expect(formatWorkDuration(3_660_000)).toBe("1 h 1 min")
    expect(formatWorkDuration(null)).toBe("")
    expect(formatWorkDuration(-5)).toBe("")
  })
})
