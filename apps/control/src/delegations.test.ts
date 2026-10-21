import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Db } from "@open-bot/db"

let phase = "running"

mock.module("./docker", () => ({
  desktopExec: () => {
    throw new Error("not mocked")
  },
  desktopPhase: async () => phase,
  endpoint: async () => "http://opencode:4096",
  isRunning: () => false,
  opencodeExec: () => {
    throw new Error("not mocked")
  },
  opencodeScript: () => {
    throw new Error("not mocked")
  },
  restartOpencode: async () => {
    throw new Error("not mocked")
  },
  startDesktop: async () => {
    throw new Error("not mocked")
  },
}))

const {
  dispatchDelegationWakes,
  eventSessionId,
  handleDelegationIdle,
  lastAssistantText,
  recordDelegation,
  resolveDelegationCreator,
  wakeableSessionRow,
} = await import("./delegations")

type WatchRow = {
  id: string
  userId: string
  kind: "council" | "persona"
  creatorSessionId: string
  subjectSessionId: string
  councilId: string | null
  createdAt: number
  wokenAt: number | null
  pending: boolean
}

function fakeDb() {
  const watches: WatchRow[] = []
  const councils: { id: string; userId: string; name: string }[] = []
  const db = {
    desktop: (id: string) =>
      id === "user-1" ? { opencodePassword: "pw" } : null,
    createDelegationWatch: (row: WatchRow) => {
      watches.push({ ...row })
    },
    delegationWatchesBySubject: (userId: string, sessionId: string) =>
      watches.filter(
        (row) => row.userId === userId && row.subjectSessionId === sessionId,
      ),
    delegationWatchesByCouncil: (userId: string, councilId: string) =>
      watches.filter(
        (row) => row.userId === userId && row.councilId === councilId,
      ),
    pendingDelegationWatches: (userId: string, creator: string) =>
      watches.filter(
        (row) =>
          row.userId === userId &&
          row.creatorSessionId === creator &&
          row.pending,
      ),
    markDelegationsWoken: (userId: string, ids: string[], at: number) => {
      for (const row of watches) {
        if (row.userId === userId && ids.includes(row.id)) {
          row.wokenAt = at
          row.pending = false
        }
      }
    },
    markDelegationsPending: (userId: string, ids: string[]) => {
      for (const row of watches) {
        if (row.userId === userId && ids.includes(row.id)) row.pending = true
      }
    },
    rearmDelegation: (userId: string, sessionId: string) => {
      for (const row of watches) {
        if (
          row.userId === userId &&
          row.subjectSessionId === sessionId &&
          (row.wokenAt !== null || row.pending)
        ) {
          row.wokenAt = null
          row.pending = false
        }
      }
    },
    councilById: (id: string, userId: string) =>
      councils.find((row) => row.id === id && row.userId === userId) ?? null,
  } as unknown as Db
  return { db, watches, councils }
}

function seedCouncil(
  store: ReturnType<typeof fakeDb>,
  rows: {
    id: string
    kind?: "council" | "persona"
    creator: string
    subject: string
    councilId?: string | null
    wokenAt?: number | null
    pending?: boolean
  }[],
) {
  for (const row of rows) {
    recordDelegation(
      store.db,
      "user-1",
      row.kind ?? "council",
      row.creator,
      row.subject,
      row.councilId ?? null,
    )
    const created = store.watches.at(-1)
    if (created) {
      if (row.id) created.id = row.id
      if (row.wokenAt !== undefined) created.wokenAt = row.wokenAt
      if (row.pending !== undefined) created.pending = row.pending
    }
  }
}

const originalFetch = globalThis.fetch

let statusMap: Record<string, { type: string }>
let prompts: { url: string; body: Record<string, unknown> }[]

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/session/status")) return Response.json(statusMap)
    if (url.endsWith("/prompt_async") && init?.method === "POST") {
      prompts.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      })
      return Response.json({ ok: true })
    }
    return Response.json({})
  }) as unknown as typeof fetch
}

beforeEach(() => {
  installFetch()
  statusMap = {}
  prompts = []
})

afterEach(() => {
  globalThis.fetch = originalFetch
  phase = "running"
})

function idleEvent(sessionId: string) {
  return {
    type: "session.idle",
    properties: { sessionID: sessionId },
  }
}

describe("dispatchDelegationWakes", () => {
  test("a council wakes its creator only when every member is idle", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
      { id: "w2", creator: "chat1", subject: "m2", councilId: "c1" },
    ])
    store.councils.push({ id: "c1", userId: "user-1", name: "auth-review" })
    statusMap = { m1: { type: "idle" }, m2: { type: "busy" } }

    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(0) // m2 is still busy: rows stay armed

    statusMap = { m1: { type: "idle" }, m2: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "m2")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.url).toBe(
      "http://opencode:4096/session/chat1/prompt_async",
    )
    const text = (
      (prompts[0]?.body.parts as { text: string }[])[0] ?? { text: "" }
    ).text
    expect(text).toContain("[council: auth-review]")
    expect(text).toContain("All 2 members finished")
    expect(store.watches.map((row) => row.wokenAt)).toEqual([
      expect.any(Number),
      expect.any(Number),
    ])
  })

  test("a member that is still busy blocks the wake", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
      { id: "w2", creator: "chat1", subject: "m2", councilId: "c1" },
    ])
    statusMap = { m1: { type: "idle" }, m2: { type: "busy" } }
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(0)
    expect(store.watches.every((row) => row.wokenAt === null)).toBe(true)
  })

  test("a second idle event never double-prompts", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
    ])
    statusMap = { m1: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "m1")
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(1)
  })

  test("a busy creator defers the wake until its own idle", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
    ])
    statusMap = { m1: { type: "idle" }, chat1: { type: "busy" } }
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(0)
    expect(store.watches[0]?.pending).toBe(true)
    expect(store.watches[0]?.wokenAt).toBeNull()

    statusMap = { m1: { type: "idle" }, chat1: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "chat1")
    expect(prompts).toHaveLength(1)
    expect(store.watches[0]).toMatchObject({ pending: false })
    expect(store.watches[0]?.wokenAt).not.toBeNull()
  })

  test("activity on a member re-arms a delivered wake", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
    ])
    statusMap = { m1: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(store.watches[0]?.wokenAt).not.toBeNull()

    dispatchDelegationWakes(store.db, "user-1", {
      type: "message.part.updated",
      properties: { sessionID: "m1" },
    })
    expect(store.watches[0]?.wokenAt).toBeNull()

    statusMap = { m1: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(2)
  })

  test("a persona teammate wakes on its own idle", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", kind: "persona", creator: "chat1", subject: "mate1" },
    ])
    statusMap = { mate1: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "mate1")
    expect(prompts).toHaveLength(1)
    const text = (
      (prompts[0]?.body.parts as { text: string }[])[0] ?? { text: "" }
    ).text
    expect(text).toContain("[teammate]")
  })

  test("sessions without watch rows are ignored", async () => {
    const store = fakeDb()
    statusMap = { anyone: { type: "idle" } }
    await handleDelegationIdle(store.db, "user-1", "anyone")
    expect(prompts).toHaveLength(0)
  })

  test("a failed wake prompt keeps the rows armed", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
    ])
    statusMap = { m1: { type: "idle" } }
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(store.watches[0]?.wokenAt).toBeNull()
    expect(store.watches[0]?.pending).toBe(false)
  })

  test("a sleeping desktop skips the wake", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", creator: "chat1", subject: "m1", councilId: "c1" },
    ])
    phase = "sleeping"
    await handleDelegationIdle(store.db, "user-1", "m1")
    expect(prompts).toHaveLength(0)
    expect(store.watches[0]?.wokenAt).toBeNull()
  })

  test("dispatch re-arms on non-idle events and routes idle through the pump path", async () => {
    const store = fakeDb()
    seedCouncil(store, [
      { id: "w1", kind: "persona", creator: "chat1", subject: "mate1" },
    ])
    statusMap = { mate1: { type: "idle" } }
    dispatchDelegationWakes(store.db, "user-1", idleEvent("mate1"))
    // fire-and-forget: flush the microtask queue
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prompts).toHaveLength(1)
  })
})

describe("resolveDelegationCreator", () => {
  function installSessionFetch(options?: {
    rows?: Record<string, unknown>
    sessions?: unknown[]
    status?: Record<string, { type: string }>
  }) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/session/status"))
        return Response.json(options?.status ?? {})
      if (url === "http://opencode:4096/session")
        return Response.json(options?.sessions ?? [])
      const match = url.match(/\/session\/([^/]+)$/)
      if (match) {
        const row = options?.rows?.[match[1] ?? ""]
        return row ? Response.json(row) : new Response("nope", { status: 404 })
      }
      return Response.json({})
    }) as unknown as typeof fetch
  }

  const ctx = {
    base: "http://opencode:4096",
    headers: { authorization: "Basic dGVzdA==" },
  }

  test("a valid --from wins without touching status", async () => {
    installSessionFetch({ rows: { chat1: { id: "chat1", title: "Chat" } } })
    const out = await resolveDelegationCreator(ctx.base, ctx.headers, "chat1")
    expect(out).toEqual({ creator: "chat1", warning: null })
  })

  test("worker:, cron-run:, subagent, and unknown sessions are not wakeable", async () => {
    installSessionFetch({
      rows: {
        w1: { id: "w1", title: "worker:job" },
        c1: { id: "c1", title: "cron-run:nightly" },
        sub: { id: "sub", title: "worker:sub", parentID: "w1" },
      },
    })
    for (const id of ["w1", "c1", "sub", "missing"]) {
      const out = await resolveDelegationCreator(ctx.base, ctx.headers, id)
      expect(out.creator).toBeNull()
      expect(out.warning).toMatch(/--from ignored/)
    }
  })

  test("inference picks the single busy top-level chat", async () => {
    installSessionFetch({
      status: { chat1: { type: "busy" }, w1: { type: "busy" } },
      sessions: [
        { id: "chat1", title: "Chat" },
        { id: "w1", title: "worker:other" },
      ],
    })
    const out = await resolveDelegationCreator(ctx.base, ctx.headers, "")
    expect(out).toEqual({ creator: "chat1", warning: null })
  })

  test("inference refuses ambiguity and quiet desktops", async () => {
    installSessionFetch({
      status: { chat1: { type: "busy" }, chat2: { type: "busy" } },
      sessions: [
        { id: "chat1", title: "One" },
        { id: "chat2", title: "Two" },
      ],
    })
    expect(
      (await resolveDelegationCreator(ctx.base, ctx.headers, "")).creator,
    ).toBeNull()
    installSessionFetch({ status: {} })
    expect(
      (await resolveDelegationCreator(ctx.base, ctx.headers, "")).creator,
    ).toBeNull()
  })
})

describe("wake helpers", () => {
  test("wakeableSessionRow rejects hidden prefixes and subagents", () => {
    expect(wakeableSessionRow({ id: "s", title: "Chat" })).toBe(true)
    expect(wakeableSessionRow({ id: "s", title: "worker:job" })).toBe(false)
    expect(wakeableSessionRow({ id: "s", title: "cron-run:x" })).toBe(false)
    expect(
      wakeableSessionRow({ id: "s", title: "worker:sub", parentID: "p" }),
    ).toBe(false)
    expect(wakeableSessionRow({ id: "s", title: 42 })).toBe(false)
    expect(wakeableSessionRow({ title: "Chat" })).toBe(false)
  })

  test("eventSessionId reads sessionID then info.id", () => {
    expect(eventSessionId({ properties: { sessionID: "a" } })).toBe("a")
    expect(eventSessionId({ properties: { info: { id: "b" } } })).toBe("b")
    expect(eventSessionId({ properties: {} })).toBeNull()
  })

  test("lastAssistantText returns the newest assistant text, tail-capped", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool" }, { type: "text", text: "working" }],
      },
      { info: { role: "assistant" }, parts: [{ type: "tool" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "x".repeat(500) }],
      },
    ]
    const out = lastAssistantText(messages)
    expect(out).toHaveLength(400)
    expect(out.startsWith("x")).toBe(true)
    expect(lastAssistantText([])).toBe("")
    expect(lastAssistantText(null)).toBe("")
    expect(lastAssistantText([{ info: { role: "user" } }])).toBe("")
  })
})
