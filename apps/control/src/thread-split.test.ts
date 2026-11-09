import { afterEach, describe, expect, test } from "bun:test"
import type { Db } from "@open-bot/db"
import { splitForkBoundary, splitThread } from "./thread-split"

const msg = (id: string, role = "user") => ({ info: { id, role }, parts: [] })

describe("splitForkBoundary", () => {
  const list = [msg("m1"), msg("m2", "assistant"), msg("m3")]

  test("a middle message forks at the following raw message", () => {
    expect(splitForkBoundary(list, "m2")).toEqual({
      forkMessageId: "m3",
      copied: 2,
    })
  })

  test("the first message forks at the second", () => {
    expect(splitForkBoundary(list, "m1")).toEqual({
      forkMessageId: "m2",
      copied: 1,
    })
  })

  test("the last message needs no boundary (full copy)", () => {
    expect(splitForkBoundary(list, "m3")).toEqual({
      forkMessageId: null,
      copied: 3,
    })
  })

  test("an unknown message is missing", () => {
    expect(splitForkBoundary(list, "nope")).toBe("missing")
    expect(splitForkBoundary([], "m1")).toBe("missing")
  })

  test("a following message without an id is unreadable", () => {
    expect(splitForkBoundary([msg("m1"), { info: {}, parts: [] }], "m1")).toBe(
      "unreadable",
    )
  })
})

type BindingCall =
  | ["persona", string, string, string]
  | ["model", Record<string, unknown>]
  | ["dir", string, string, string]

function stubDb() {
  const calls: BindingCall[] = []
  const db = {
    threadPersona: (_userId: string, sessionId: string) =>
      sessionId === "s1"
        ? { userId: "u1", sessionId: "s1", personaId: "p1" }
        : null,
    setThreadPersona: (userId: string, sessionId: string, personaId: string) =>
      calls.push(["persona", userId, sessionId, personaId]),
    threadModel: (_userId: string, sessionId: string) =>
      sessionId === "s1"
        ? {
            userId: "u1",
            sessionId: "s1",
            providerId: "prov",
            modelId: "reasoner",
            effort: "high",
          }
        : null,
    setThreadModel: (row: Record<string, unknown>) =>
      calls.push(["model", row]),
    threadDirAssignments: () => [
      { userId: "u1", sessionId: "s1", dirId: "d1" },
      { userId: "u1", sessionId: "other", dirId: "d2" },
    ],
    setThreadDir: (userId: string, sessionId: string, dirId: string) =>
      calls.push(["dir", userId, sessionId, dirId]),
  } as unknown as Db
  return { db, calls }
}

const originalFetch = globalThis.fetch
let forkCalls: { url: string; body: unknown }[] = []
let sessionRow: Record<string, unknown> = { id: "s1", title: "Chat" }
let sessionStatus = 200
let statusType: string | null = null
let forkStatus = 200
let listStatus = 200

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/session/s1/fork")) {
      forkCalls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      if (forkStatus !== 200)
        return new Response("boom", { status: forkStatus })
      return Response.json({ id: "ses_new", title: "Chat (fork #1)" })
    }
    if (url.endsWith("/session/s1/message")) {
      if (listStatus !== 200)
        return new Response("boom", { status: listStatus })
      return Response.json([msg("m1"), msg("m2", "assistant"), msg("m3")])
    }
    if (url.endsWith("/session/status"))
      return Response.json(statusType ? { s1: { type: statusType } } : {})
    if (url.endsWith("/session/s1")) {
      if (sessionStatus !== 200)
        return new Response("gone", { status: sessionStatus })
      return Response.json(sessionRow)
    }
    return new Response("unexpected " + url, { status: 500 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  forkCalls = []
  sessionRow = { id: "s1", title: "Chat" }
  sessionStatus = 200
  statusType = null
  forkStatus = 200
  listStatus = 200
})

function split(body: Record<string, unknown>, db: Db) {
  installFetch()
  return splitThread({
    db,
    userId: "u1",
    base: "http://opencode:4096",
    headers: { authorization: "Basic x" },
    sessionId: "s1",
    body,
  })
}

describe("splitThread", () => {
  test("splits at a middle message and copies the bindings", async () => {
    const { db, calls } = stubDb()
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: "ses_new",
      title: "Chat (fork #1)",
      sourceId: "s1",
      messageId: "m2",
      copiedMessages: 2,
    })
    // Fork is exclusive: the boundary is the message AFTER the selected one.
    expect(forkCalls).toEqual([
      {
        url: "http://opencode:4096/session/s1/fork",
        body: { messageID: "m3" },
      },
    ])
    expect(calls).toEqual([
      ["persona", "u1", "ses_new", "p1"],
      [
        "model",
        {
          userId: "u1",
          sessionId: "ses_new",
          providerId: "prov",
          modelId: "reasoner",
          effort: "high",
        },
      ],
      ["dir", "u1", "ses_new", "d1"],
    ])
  })

  test("splitting at the last message forks with no boundary", async () => {
    const { db } = stubDb()
    const res = await split({ messageId: "m3" }, db)
    expect(res.status).toBe(201)
    expect(forkCalls[0]?.body).toEqual({})
    expect((await res.json()).copiedMessages).toBe(3)
  })

  test("accepts the messageID spelling", async () => {
    const { db } = stubDb()
    const res = await split({ messageID: "m1" }, db)
    expect(res.status).toBe(201)
    expect(forkCalls[0]?.body).toEqual({ messageID: "m2" })
  })

  test("a missing or blank messageId is a 400 and never forks", async () => {
    const { db } = stubDb()
    expect((await split({}, db)).status).toBe(400)
    expect((await split({ messageId: "  " }, db)).status).toBe(400)
    expect((await split({ messageId: 7 }, db)).status).toBe(400)
    expect(forkCalls).toEqual([])
  })

  test("an unknown message is a 400 and never forks", async () => {
    const { db } = stubDb()
    const res = await split({ messageId: "gone" }, db)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("message_not_found")
    expect(forkCalls).toEqual([])
  })

  test("a busy thread is a 409 and never forks", async () => {
    statusType = "busy"
    const { db } = stubDb()
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("thread_busy")
    expect(forkCalls).toEqual([])
  })

  test("a subagent session cannot be split", async () => {
    sessionRow = { id: "s1", title: "Helper", parentID: "root" }
    const { db } = stubDb()
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("not_top_level")
  })

  test("hidden worker:/cron-run: threads cannot be split", async () => {
    const { db } = stubDb()
    sessionRow = { id: "s1", title: "worker:job" }
    expect((await (await split({ messageId: "m2" }, db)).json()).code).toBe(
      "hidden_thread",
    )
    sessionRow = { id: "s1", title: "cron-run:nightly" }
    expect((await split({ messageId: "m2" }, db)).status).toBe(400)
    expect(forkCalls).toEqual([])
  })

  test("a missing thread is a 404", async () => {
    sessionStatus = 404
    const { db } = stubDb()
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(404)
    expect(forkCalls).toEqual([])
  })

  test("upstream failures are 502s", async () => {
    const { db } = stubDb()
    listStatus = 500
    expect((await split({ messageId: "m2" }, db)).status).toBe(502)
    listStatus = 200
    forkStatus = 500
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe("fork_failed")
  })

  test("no bindings are written when the source has none", async () => {
    const calls: BindingCall[] = []
    const db = {
      threadPersona: () => null,
      setThreadPersona: () => calls.push(["persona", "", "", ""]),
      threadModel: () => null,
      setThreadModel: (row: Record<string, unknown>) =>
        calls.push(["model", row]),
      threadDirAssignments: () => [],
      setThreadDir: () => calls.push(["dir", "", "", ""]),
    } as unknown as Db
    const res = await split({ messageId: "m2" }, db)
    expect(res.status).toBe(201)
    expect(calls).toEqual([])
  })
})
