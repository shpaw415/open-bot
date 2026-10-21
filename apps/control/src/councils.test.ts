import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Db, User } from "@open-bot/db"

let phase = "running"
let failDeletes = false

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
  COUNCIL_NAME_MAX,
  findOrCreateCouncil,
  handleCouncils,
  isCouncilPath,
  sanitizeCouncilName,
  sanitizeRole,
} = await import("./councils")

const user = { id: "user-1", disabled: false } as unknown as User

type CouncilRow = {
  id: string
  userId: string
  name: string
  createdAt: number
}

type MemberRow = {
  councilId: string
  userId: string
  sessionId: string
  role: string
  createdAt: number
}

function makeDb() {
  const councils: CouncilRow[] = []
  const members: MemberRow[] = []
  const cleanup: string[] = []
  const db = {
    desktop: (id: string) =>
      id === "user-1" ? { opencodePassword: "pw" } : null,
    councils: (userId: string) =>
      councils.filter((row) => row.userId === userId),
    councilByName: (userId: string, name: string) =>
      councils.find(
        (row) =>
          row.userId === userId &&
          row.name.toLowerCase() === name.toLowerCase(),
      ) ?? null,
    createCouncil: (row: CouncilRow) => {
      councils.push(row)
    },
    allCouncilMembers: (userId: string) =>
      members.filter((row) => row.userId === userId),
    councilMembers: (userId: string, councilId: string) =>
      members.filter(
        (row) => row.userId === userId && row.councilId === councilId,
      ),
    deleteCouncil: (id: string, userId: string) => {
      const index = councils.findIndex(
        (row) => row.id === id && row.userId === userId,
      )
      if (index === -1) return false
      councils.splice(index, 1)
      for (let i = members.length - 1; i >= 0; i--) {
        if (members[i].councilId === id) members.splice(i, 1)
      }
      return true
    },
    clearThreadPersona: (_userId: string, sessionId: string) => {
      cleanup.push(`persona:${sessionId}`)
    },
    clearThreadTitle: (_userId: string, sessionId: string) => {
      cleanup.push(`title:${sessionId}`)
    },
    clearThreadDir: (_userId: string, sessionId: string) => {
      cleanup.push(`dir:${sessionId}`)
    },
    clearCouncilMember: (_userId: string, sessionId: string) => {
      const index = members.findIndex(
        (row) => row.sessionId === sessionId && row.userId === _userId,
      )
      if (index !== -1) members.splice(index, 1)
      cleanup.push(`council:${sessionId}`)
    },
    workspaceMediaForSession: () => [],
    deleteWorkspaceMedia: () => {},
    clearThreadScreen: () => {},
  } as unknown as Db
  return { db, councils, members, cleanup }
}

function makeHub() {
  const events: { userId: string; type: string }[] = []
  return {
    events,
    emit: (userId: string, event: { type?: string }) => {
      events.push({ userId, type: event.type ?? "" })
    },
  }
}

const originalFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []
let sessionList: unknown[] = [
  { id: "s1", title: "worker:Research" },
  { id: "s2", title: "worker:Reviewer" },
]

function installFetch(list?: unknown[]) {
  if (list) sessionList = list
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ) => {
    const url = String(input)
    const init = options
    calls.push({ url, init })
    if (url.endsWith("/session") && (!init?.method || init.method === "GET"))
      return Response.json(sessionList)
    if (url.includes("/session/") && init?.method === "DELETE") {
      if (failDeletes) return new Response("nope", { status: 500 })
      return Response.json({ id: url.split("/session/")[1] })
    }
    return Response.json({})
  }) as unknown as typeof fetch
}

beforeEach(() => {
  failDeletes = false
  calls = []
  sessionList = [
    { id: "s1", title: "worker:Research" },
    { id: "s2", title: "worker:Reviewer" },
  ]
})

afterEach(() => {
  globalThis.fetch = originalFetch
  phase = "running"
})

function request(method: string, path: string, body?: unknown, database?: Db) {
  const hub = makeHub()
  const store = database as never
  return handleCouncils(
    new Request(`http://control${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    new URL(`http://control${path}`),
    (store ?? makeDb().db) as Db,
    user,
    hub as never,
  )
}

describe("council name and role helpers", () => {
  test("names normalize to lowercase kebab", () => {
    expect(sanitizeCouncilName("Auth Review")).toBe("auth-review")
    expect(sanitizeCouncilName("  --Foo__bar!!  ")).toBe("foo-bar")
    expect(sanitizeCouncilName(null)).toBe("")
    expect(sanitizeCouncilName(42)).toBeNull()
    expect(COUNCIL_NAME_MAX).toBe(48)
  })

  test("roles keep readable labels and cap length", () => {
    expect(sanitizeRole("  Second  reviewer ")).toBe("Second reviewer")
    expect(sanitizeRole("x".repeat(200))).toHaveLength(80)
    expect(sanitizeRole(42)).toBeNull()
  })

  test("find-or-create reuses a council case-insensitively", () => {
    const { db, councils } = makeDb()
    const first = findOrCreateCouncil(db, "user-1", "auth-review")
    const second = findOrCreateCouncil(db, "user-1", "Auth-Review")
    expect(first.name).toBe("auth-review")
    expect(second.id).toBe(first.id)
    expect(councils).toHaveLength(1)
  })

  test("isCouncilPath matches the council routes", () => {
    expect(isCouncilPath("/api/councils")).toBe(true)
    expect(isCouncilPath("/api/councils/auth-review")).toBe(true)
    expect(isCouncilPath("/api/threads")).toBe(false)
  })
})

describe("GET /api/councils", () => {
  test("lists councils with member counts", async () => {
    const store = makeDb()
    findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push(
      {
        councilId: store.councils[0].id,
        userId: "user-1",
        sessionId: "s1",
        role: "Researcher",
        createdAt: 1,
      },
      {
        councilId: store.councils[0].id,
        userId: "user-1",
        sessionId: "s2",
        role: "",
        createdAt: 2,
      },
    )
    const res = (await request(
      "GET",
      "/api/councils",
      undefined,
      store.db,
    )) as Response
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      councils: {
        id: string
        name: string
        members: number
        createdAt: number
      }[]
    }
    expect(body.councils).toEqual([
      {
        id: store.councils[0].id,
        name: "auth-review",
        createdAt: expect.any(Number),
        members: 2,
      },
    ])
  })

  test("detail merges opencode titles and strips the worker prefix", async () => {
    installFetch()
    const store = makeDb()
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push(
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s1",
        role: "Researcher",
        createdAt: 1,
      },
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s3",
        role: "",
        createdAt: 2,
      },
    )
    const res = (await request(
      "GET",
      "/api/councils/auth-review",
      undefined,
      store.db,
    )) as Response
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      name: string
      members: {
        sessionId: string
        role: string
        title: string
        createdAt: number
      }[]
      subagents: unknown[]
    }
    expect(body.name).toBe("auth-review")
    expect(body.members).toEqual([
      { sessionId: "s1", role: "Researcher", title: "Research", createdAt: 1 },
      { sessionId: "s3", role: "", title: "", createdAt: 2 },
    ])
    expect(body.subagents).toEqual([])
  })

  test("detail lists task-tool subagents of members only, sorted by age", async () => {
    installFetch([
      { id: "s1", title: "worker:Research" },
      // children of member s1
      { id: "c1", title: "explore", parentID: "s1", time: { created: 30 } },
      {
        id: "c2",
        title: "worker:helper",
        parentID: "s1",
        time: { created: 10 },
      },
      // child of a non-member session
      { id: "x1", title: "other", parentID: "zzz", time: { created: 5 } },
      // grandchild (subagent of a subagent) stays out of the rail
      { id: "g1", title: "grandchild", parentID: "c1", time: { created: 40 } },
      // member session with no children, plus a childless non-member
      { id: "s3", title: "worker:Third" },
      { id: "s9", title: "worker:Stranger" },
    ])
    const store = makeDb()
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push(
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s1",
        role: "Researcher",
        createdAt: 1,
      },
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s3",
        role: "",
        createdAt: 2,
      },
    )
    const res = (await request(
      "GET",
      "/api/councils/auth-review",
      undefined,
      store.db,
    )) as Response
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      subagents: {
        sessionId: string
        parentId: string
        title: string
        createdAt: number
      }[]
    }
    expect(body.subagents).toEqual([
      { sessionId: "c2", parentId: "s1", title: "helper", createdAt: 10 },
      { sessionId: "c1", parentId: "s1", title: "explore", createdAt: 30 },
    ])
  })

  test("unknown council 404s and a sleeping desktop degrades to empty titles", async () => {
    installFetch()
    phase = "sleeping"
    const store = makeDb()
    expect(
      (
        (await request(
          "GET",
          "/api/councils/nope",
          undefined,
          store.db,
        )) as Response
      ).status,
    ).toBe(404)
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push({
      councilId: council.id,
      userId: "user-1",
      sessionId: "s1",
      role: "",
      createdAt: 1,
    })
    const res = (await request(
      "GET",
      "/api/councils/auth-review",
      undefined,
      store.db,
    )) as Response
    const body = (await res.json()) as {
      members: {
        sessionId: string
        role: string
        title: string
        createdAt: number
      }[]
      subagents: unknown[]
    }
    expect(body.members).toEqual([
      { sessionId: "s1", role: "", title: "", createdAt: 1 },
    ])
    expect(body.subagents).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe("DELETE /api/councils/:name", () => {
  test("deletes every member, runs the cleanup, and drops the council", async () => {
    installFetch()
    const store = makeDb()
    const hub = makeHub()
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push(
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s1",
        role: "Researcher",
        createdAt: 1,
      },
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s2",
        role: "Reviewer",
        createdAt: 2,
      },
    )
    const res = (await handleCouncils(
      new Request("http://control/api/councils/auth-review", {
        method: "DELETE",
      }),
      new URL("http://control/api/councils/auth-review"),
      store.db,
      user,
      hub as never,
    )) as Response
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: string[]; skipped: unknown[] }
    expect(body.deleted).toEqual(["s1", "s2"])
    expect(body.skipped).toEqual([])
    expect(store.councils).toHaveLength(0)
    expect(store.members).toHaveLength(0)
    expect(store.cleanup).toContain("council:s1")
    expect(hub.events).toEqual([
      { userId: "user-1", type: "councils.changed" },
      { userId: "user-1", type: "threads.changed" },
    ])
    const del = calls.find(
      (call) =>
        call.url.endsWith("/session/s1") && call.init?.method === "DELETE",
    )
    expect(del).toBeDefined()
  })

  test("keeps the council tracked when a member delete fails", async () => {
    installFetch()
    failDeletes = true
    const store = makeDb()
    const hub = makeHub()
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push({
      councilId: council.id,
      userId: "user-1",
      sessionId: "s1",
      role: "",
      createdAt: 1,
    })
    const res = (await handleCouncils(
      new Request("http://control/api/councils/auth-review", {
        method: "DELETE",
      }),
      new URL("http://control/api/councils/auth-review"),
      store.db,
      user,
      hub as never,
    )) as Response
    const body = (await res.json()) as {
      deleted: string[]
      skipped: { sessionId: string; reason: string }[]
    }
    expect(body.deleted).toEqual([])
    expect(body.skipped).toEqual([{ sessionId: "s1", reason: "delete failed" }])
    expect(store.councils).toHaveLength(1)
    expect(store.members).toHaveLength(1)
    expect(store.cleanup).toEqual([])
  })

  test("unknown council 404s and a sleeping desktop refuses", async () => {
    installFetch()
    const store = makeDb()
    expect(
      (
        (await request(
          "DELETE",
          "/api/councils/nope",
          undefined,
          store.db,
        )) as Response
      ).status,
    ).toBe(404)
    phase = "sleeping"
    findOrCreateCouncil(store.db, "user-1", "auth-review")
    const res = (await request(
      "DELETE",
      "/api/councils/auth-review",
      undefined,
      store.db,
    )) as Response
    expect(res.status).toBe(409)
    expect(calls).toHaveLength(0)
  })
})

describe("GET /api/councils/:name/status", () => {
  function installStatusFetch(options?: {
    status?: Record<string, { type: string }>
    messages?: Record<string, unknown>
  }) {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith("/session/status"))
        return Response.json(options?.status ?? {})
      if (url.endsWith("/session") && (!init?.method || init.method === "GET"))
        return Response.json(sessionList)
      const message = url.match(/\/session\/([^/]+)\/message$/)
      if (message) {
        const rows = options?.messages?.[message[1] ?? ""]
        return rows
          ? Response.json(rows)
          : new Response("nope", { status: 404 })
      }
      return Response.json({})
    }) as unknown as typeof fetch
  }

  function statusRequest(name: string, useDb: Db) {
    return handleCouncils(
      new Request(`http://control/api/councils/${name}/status`),
      new URL(`http://control/api/councils/${name}/status`),
      useDb,
      user,
      makeHub() as never,
    ) as Promise<Response>
  }

  test("pairs member state with the last assistant reply", async () => {
    installStatusFetch({
      status: { s1: { type: "busy" }, s2: { type: "idle" } },
      messages: {
        s1: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "half done" }],
          },
        ],
        s2: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "finished the review" }],
          },
        ],
      },
    })
    const store = makeDb()
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push(
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s1",
        role: "Researcher",
        createdAt: 1,
      },
      {
        councilId: council.id,
        userId: "user-1",
        sessionId: "s2",
        role: "Reviewer",
        createdAt: 2,
      },
    )
    const res = await statusRequest("auth-review", store.db)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: "auth-review",
      members: [
        {
          sessionId: "s1",
          role: "Researcher",
          title: "Research",
          status: "busy",
          lastReply: "half done",
        },
        {
          sessionId: "s2",
          role: "Reviewer",
          title: "Reviewer",
          status: "idle",
          lastReply: "finished the review",
        },
      ],
    })
  })

  test("unknown council 404s and a down desktop degrades to unknown", async () => {
    installStatusFetch()
    const store = makeDb()
    expect((await statusRequest("nope", store.db)).status).toBe(404)
    const council = findOrCreateCouncil(store.db, "user-1", "auth-review")
    store.members.push({
      councilId: council.id,
      userId: "user-1",
      sessionId: "s1",
      role: "",
      createdAt: 1,
    })
    phase = "sleeping"
    const res = await statusRequest("auth-review", store.db)
    expect(await res.json()).toEqual({
      name: "auth-review",
      members: [
        {
          sessionId: "s1",
          role: "",
          title: "",
          status: "unknown",
          lastReply: "",
        },
      ],
    })
  })
})
