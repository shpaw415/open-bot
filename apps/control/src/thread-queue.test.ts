import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, type User } from "@open-bot/db"
import type { EventHub } from "./events"
import {
  drainThreadQueues,
  handleThreadQueue,
  isTailDuplicate,
  parseQueueSubmission,
  queuedPromptParts,
  queueFlushAllowed,
} from "./thread-queue"

describe("parseQueueSubmission", () => {
  test("accepts text, files, or both and rejects empty submissions", () => {
    expect(parseQueueSubmission({ text: "hello" })).toEqual({
      text: "hello",
      files: [],
    })
    const file = {
      id: "f1",
      name: "a.txt",
      mime: "text/plain",
      url: "data:text/plain;base64,QQ==",
    }
    expect(parseQueueSubmission({ text: "", files: [file] })).toEqual({
      text: "",
      files: [file],
    })
    expect("error" in parseQueueSubmission({ text: "  " })).toBe(true)
    expect("error" in parseQueueSubmission(null)).toBe(true)
    expect("error" in parseQueueSubmission({ text: 42 })).toBe(true)
  })

  test("rejects malformed or oversized file lists", () => {
    expect(
      "error" in
        parseQueueSubmission({
          text: "x",
          files: [{ name: "a", mime: "text/plain", url: "https://x/y" }],
        }),
    ).toBe(true)
    const file = {
      name: "a.txt",
      mime: "text/plain",
      url: "data:text/plain;base64,QQ==",
    }
    expect(
      "error" in
        parseQueueSubmission({ text: "x", files: Array(6).fill(file) }),
    ).toBe(true)
  })
})

describe("isTailDuplicate", () => {
  test("matches the old client rule: same tail text with no files either side", () => {
    const items = [{ text: "go", files: [] }]
    expect(isTailDuplicate(items, { text: " go ", files: [] })).toBe(true)
    expect(isTailDuplicate(items, { text: "go", files: [{}, {}] })).toBe(false)
    expect(isTailDuplicate([], { text: "go", files: [] })).toBe(false)
    expect(isTailDuplicate(items, { text: "other", files: [] })).toBe(false)
  })
})

describe("queuedPromptParts", () => {
  test("mirrors the composer's part order: files first, then trimmed text", () => {
    expect(
      queuedPromptParts(" hi ", [
        {
          id: "f1",
          name: "a.txt",
          mime: "text/plain",
          url: "data:text/plain;base64,QQ==",
        },
      ]),
    ).toEqual([
      {
        type: "file",
        mime: "text/plain",
        filename: "a.txt",
        url: "data:text/plain;base64,QQ==",
      },
      { type: "text", text: "hi" },
    ])
  })
})

describe("queueFlushAllowed", () => {
  test("never flushes into a busy or unreadable session", () => {
    expect(queueFlushAllowed({ busy: true, end: null })).toBe(false)
    expect(queueFlushAllowed({ busy: null, end: null })).toBe(false)
  })

  test("holds behind an errored turn unless forced (the old banner hold)", () => {
    const error = { state: "error" as const, detail: "quota" }
    expect(queueFlushAllowed({ busy: false, end: error })).toBe(false)
    expect(queueFlushAllowed({ busy: false, end: error, force: true })).toBe(
      true,
    )
    expect(
      queueFlushAllowed({
        busy: false,
        end: { state: "done", detail: "" },
      }),
    ).toBe(true)
    expect(
      queueFlushAllowed({
        busy: false,
        end: { state: "cut", detail: "aborted" },
      }),
    ).toBe(true)
    expect(queueFlushAllowed({ busy: false, end: null })).toBe(true)
  })
})

describe("handleThreadQueue", () => {
  test("persists, dedupes, edits, promotes and deletes against a real Db", async () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser({
      id: "u1",
      email: "u1@localhost",
      passwordHash: "x",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    const user = db.userById("u1") as User
    const emitted: string[] = []
    const hub = {
      emit: (_userId: string, event: { type: string }) => {
        emitted.push(event.type)
      },
    } as unknown as EventHub
    const call = (method: string, path: string, body?: unknown) =>
      handleThreadQueue(
        new Request(`http://test${path}`, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        new URL(`http://test${path}`),
        db,
        user,
        hub,
      )

    const created = await call("POST", "/api/thread-queue/s1", {
      text: "premier",
      files: [],
    })
    expect(created?.status).toBe(201)
    const createdBody = (await created?.json()) as {
      item: { id: string; text: string }
      duplicate: boolean
    }
    expect(createdBody.duplicate).toBe(false)
    const firstId = createdBody.item.id

    // A double Enter re-posts the same text: accepted, not duplicated.
    const dupe = await call("POST", "/api/thread-queue/s1", {
      text: "premier",
      files: [],
    })
    expect(((await dupe?.json()) as { duplicate: boolean }).duplicate).toBe(
      true,
    )

    const second = await call("POST", "/api/thread-queue/s1", {
      text: "second",
      files: [],
    })
    const secondId = ((await second?.json()) as { item: { id: string } }).item
      .id

    const listed = await call("GET", "/api/thread-queue/s1")
    const items = ((await listed?.json()) as { items: { text: string }[] })
      .items
    expect(items.map((item) => item.text)).toEqual(["premier", "second"])
    expect(emitted).toContain("queue.changed")

    const edited = await call("PATCH", `/api/thread-queue/s1/${firstId}`, {
      text: "premier, corrigé",
      files: [],
    })
    expect(
      ((await edited?.json()) as { item: { text: string } }).item.text,
    ).toBe("premier, corrigé")

    // Items are session-scoped: the same id under another thread 404s.
    const foreign = await call("PATCH", `/api/thread-queue/s2/${firstId}`, {
      text: "x",
      files: [],
    })
    expect(foreign?.status).toBe(404)

    // Send-now promotes to the head even when nothing can send yet
    // (no desktop in this test): order flips, nothing is lost.
    const sendNow = await call(
      "POST",
      `/api/thread-queue/s1/${secondId}/send-now`,
    )
    expect(sendNow?.status).toBe(200)
    expect(db.threadQueue("u1", "s1").map((row) => row.text)).toEqual([
      "second",
      "premier, corrigé",
    ])

    const removed = await call("DELETE", `/api/thread-queue/s1/${secondId}`)
    expect(removed?.status).toBe(200)
    expect(db.threadQueue("u1", "s1")).toHaveLength(1)

    const empty = await call("POST", "/api/thread-queue/s1", {
      text: "  ",
      files: [],
    })
    expect(empty?.status).toBe(400)
  })
})

describe("drainThreadQueues", () => {
  test("attempts one flush per queued session across users; empty table is a no-op", async () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    const at = 1_700_000_000_000
    for (const [id, userId, sessionId] of [
      ["q1", "u1", "s1"],
      ["q2", "u1", "s1"],
      ["q3", "u1", "s2"],
      ["q4", "u2", "s9"],
    ] as const) {
      db.enqueueThreadMessage({
        id,
        userId,
        sessionId,
        text: `text ${id}`,
        files: "[]",
        createdAt: at,
      })
    }
    const hub = { emit: () => {} } as unknown as EventHub
    const calls: string[] = []
    const flushed = () => Promise.resolve(false)
    drainThreadQueues(db, hub, (_dbArg, _hub, userId, sessionId) => {
      calls.push(`${userId}/${sessionId}`)
      return flushed()
    })
    await Promise.resolve()
    expect(calls.sort()).toEqual(["u1/s1", "u1/s2", "u2/s9"])

    calls.length = 0
    db.clearThreadQueue("u1", "s1")
    db.clearThreadQueue("u1", "s2")
    db.clearThreadQueue("u2", "s9")
    drainThreadQueues(db, hub, () => {
      calls.push("must-not-run")
      return flushed()
    })
    await Promise.resolve()
    expect(calls).toEqual([])
  })
})
