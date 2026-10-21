import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Db, User } from "@open-bot/db"

let phase = "running"
let failEndpoint = false

mock.module("./docker", () => ({
  desktopExec: () => {
    throw new Error("not mocked")
  },
  desktopPhase: async () => phase,
  endpoint: async () => {
    if (failEndpoint) throw new Error("no container")
    return "http://opencode:4096"
  },
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
  WORKER_TITLE_PREFIX,
  handleThreads,
  hiddenThreadTitle,
  isThreadRequest,
  sanitizeThreadTitle,
  threadTitleError,
} = await import("./threads")

const agent = { id: "user-1", disabled: false } as unknown as User
const db = {
  desktop: (id: string) =>
    id === "user-1" ? { opencodePassword: "pw" } : null,
  personas: () => [],
  installedPlugins: () => [],
  setThreadPersona: () => {},
} as unknown as Db

const effortDb = {
  desktop: (id: string) =>
    id === "user-1"
      ? {
          opencodePassword: "pw",
          selectedProvider: "prov",
          selectedModel: "reasoner",
          thinkingEffort: "high",
        }
      : null,
  personas: () => [],
  installedPlugins: () => [],
  setThreadPersona: () => {},
} as unknown as Db

function personaDb(bound: string[][], scoped = false) {
  return {
    desktop: (id: string) =>
      id === "user-1" ? { opencodePassword: "pw" } : null,
    personas: (userId: string) =>
      userId === "user-1"
        ? [
            {
              id: "p1",
              name: "Software manager",
              instruction: "run the team",
              ...(scoped
                ? { skills: ["research"], skillsExtra: null }
                : { skills: null, skillsExtra: null }),
              mcp: null,
              mcpExtra: null,
            },
          ]
        : [],
    installedPlugins: () => [],
    setThreadPersona: (
      userId: string,
      sessionId: string,
      personaId: string,
    ) => {
      bound.push([userId, sessionId, personaId])
    },
  } as unknown as Db
}

const originalFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []
let promptFails = false

function installFetch() {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ) => {
    const url = String(input)
    const init = options
    calls.push({ url, init })
    if (url.endsWith("/provider"))
      return Response.json({
        connected: ["prov"],
        all: [
          {
            id: "prov",
            models: {
              reasoner: { name: "Reasoner", variants: { high: {}, low: {} } },
            },
          },
        ],
      })
    if (promptFails && url.endsWith("/prompt_async"))
      return new Response("nope", { status: 500 })
    if (url.endsWith("/session") && (!init?.method || init.method === "GET"))
      return Response.json([
        { id: "s1", title: "worker:job" },
        { id: "s2", title: "Chat" },
        { id: "s3", title: "worker:helper", parentID: "p1" },
        { id: "s4", title: "cron-run:nightly" },
      ])
    return Response.json({ id: "ses_1" })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  phase = "running"
  failEndpoint = false
  promptFails = false
  calls = []
})

function post(body: unknown, useDb: Db = db) {
  return handleThreads(
    new Request("http://control/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    new URL("http://control/api/threads"),
    useDb,
    agent,
  )
}

describe("isThreadRequest", () => {
  test("matches only the agent thread routes", () => {
    expect(isThreadRequest("/api/threads", "GET")).toBe(true)
    expect(isThreadRequest("/api/threads", "POST")).toBe(true)
    expect(isThreadRequest("/api/threads", "DELETE")).toBe(true)
    expect(isThreadRequest("/api/threads", "PATCH")).toBe(false)
    expect(isThreadRequest("/api/threads/s1", "DELETE")).toBe(false)
    expect(isThreadRequest("/api/cron", "GET")).toBe(false)
  })
})

describe("sanitizeThreadTitle", () => {
  test("trims, collapses whitespace, and strips control characters", () => {
    expect(sanitizeThreadTitle("  Nightly   sync\n")).toBe("Nightly sync")
    expect(sanitizeThreadTitle("a\u0000b\tc")).toBe("a b c")
  })

  test("caps the title at 80 characters", () => {
    expect(sanitizeThreadTitle("x".repeat(100))).toHaveLength(80)
  })

  test("missing titles become empty and non-strings are rejected", () => {
    expect(sanitizeThreadTitle(undefined)).toBe("")
    expect(sanitizeThreadTitle(null)).toBe("")
    expect(sanitizeThreadTitle(42)).toBeNull()
  })
})

describe("threadTitleError", () => {
  test("rejects the reserved hidden prefixes", () => {
    expect(threadTitleError("worker:stealth")).toMatch(/worker:/)
    expect(threadTitleError("cron-run:nightly")).toMatch(/cron-run:/)
    expect(threadTitleError("Nightly sync")).toBeNull()
  })
})

describe("hiddenThreadTitle", () => {
  test("prefixes the title and falls back to a timestamp", () => {
    expect(hiddenThreadTitle("Scrape prices")).toBe("worker:Scrape prices")
    expect(hiddenThreadTitle("")).toMatch(/^worker:\d{4}-/)
  })
})

describe("POST /api/threads", () => {
  test("creates a hidden thread by default with the worker: prefix", async () => {
    installFetch()
    const res = await post({ title: "Scrape prices" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      title: string
      display: boolean
    }
    expect(body).toEqual({
      id: "ses_1",
      title: "worker:Scrape prices",
      display: false,
    })
    const create = calls.find((call) => call.url.endsWith("/session"))
    expect(create).toBeDefined()
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      title: "worker:Scrape prices",
    })
    expect(calls.some((call) => call.url.endsWith("/prompt_async"))).toBeFalse()
  })

  test("display threads keep the given title", async () => {
    installFetch()
    const res = await post({ title: "Nightly sync", display: true })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { title: string; display: boolean }
    expect(body.title).toBe("Nightly sync")
    expect(body.display).toBe(true)
  })

  test("posts the first message into the new thread", async () => {
    installFetch()
    const res = await post({
      title: "Scrape prices",
      message: "Fetch prices now",
    })
    expect(res.status).toBe(201)
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(prompt).toBeDefined()
    expect(prompt?.url).toBe("http://opencode:4096/session/ses_1/prompt_async")
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Fetch prices now" }],
    })
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toBeUndefined()
  })

  test("applies the saved thinking effort to the first message", async () => {
    installFetch()
    const res = await handleThreads(
      new Request("http://control/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Deep dive", message: "Go deep" }),
      }),
      new URL("http://control/api/threads"),
      effortDb,
      agent,
    )
    expect(res.status).toBe(201)
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Go deep" }],
      variant: "high",
    })
  })

  test("still returns the thread when the first message fails to post", async () => {
    installFetch()
    promptFails = true
    const res = await post({ title: "Job", message: "go" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toMatch(/first message failed/)
  })

  test("rejects reserved titles and bad field types", async () => {
    installFetch()
    expect((await post({ title: "worker:x" })).status).toBe(400)
    expect((await post({ title: "cron-run:x" })).status).toBe(400)
    expect((await post({ title: 42 })).status).toBe(400)
    expect((await post({ display: "yes" })).status).toBe(400)
    expect((await post({ message: 42 })).status).toBe(400)
    expect((await post({ message: "x".repeat(8001) })).status).toBe(400)
    expect((await post({ persona: 42 })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("binds a persona and injects its system line into the first message", async () => {
    installFetch()
    const bound: string[][] = []
    const res = await post(
      {
        title: "Add export",
        message: "Implement CSV export",
        persona: "software manager",
      },
      personaDb(bound),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      persona?: { id: string; name: string; matched: string }
    }
    expect(body.persona).toEqual({
      id: "p1",
      name: "Software manager",
      matched: "exact",
    })
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Implement CSV export" }],
      system: expect.stringContaining("answer as Software manager"),
    })
    expect(bound).toEqual([["user-1", "ses_1", "p1"]])
  })

  test("a skill-scoped persona rides the session-create permission rules", async () => {
    installFetch()
    const bound: string[][] = []
    const res = await post(
      {
        title: "Research run",
        message: "Check prices",
        persona: "software manager",
      },
      personaDb(bound, true),
    )
    expect(res.status).toBe(201)
    const create = calls.find(
      (call) =>
        call.url.endsWith("/session") &&
        (call.init as RequestInit | undefined)?.method === "POST",
    )
    expect(create).toBeDefined()
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      title: "worker:Research run",
      permission: [
        { permission: "skill", pattern: "*", action: "deny" },
        { permission: "skill", pattern: "research", action: "allow" },
      ],
    })
    const body = (await res.json()) as {
      persona?: { skills?: { allowed: number } }
    }
    expect(body.persona?.skills).toEqual({ allowed: 1 })
  })

  test("an unrestricted persona sends no permission key", async () => {
    installFetch()
    const res = await post(
      { title: "Job", persona: "software manager" },
      personaDb([]),
    )
    expect(res.status).toBe(201)
    const create = calls.find(
      (call) =>
        call.url.endsWith("/session") &&
        (call.init as RequestInit | undefined)?.method === "POST",
    )
    const body = JSON.parse(String(create?.init?.body)) as Record<
      string,
      unknown
    >
    expect(body.permission).toBeUndefined()
    const reported = (await res.json()) as {
      persona?: { skills?: unknown }
    }
    expect(reported.persona?.skills).toBeUndefined()
  })

  test("applyPersonaScope PATCHes the exact ruleset and skips null", async () => {
    installFetch()
    const { applyPersonaScope } = await import("./personas")
    const headers = { authorization: "Basic dGVzdA==" }
    await applyPersonaScope(
      "user-1",
      "http://opencode:4096",
      headers,
      "ses_9",
      {
        id: "p1",
        name: "Scoped",
        instruction: "x",
        builtin: false,
        skills: ["research"],
        skillsExtra: null,
        skillsEffective: ["research"],
        mcp: null,
        mcpExtra: null,
        mcpEffective: null,
      },
    )
    const patch = calls.find(
      (call) =>
        call.url.endsWith("/session/ses_9") &&
        (call.init as RequestInit | undefined)?.method === "PATCH",
    )
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      permission: [
        { permission: "skill", pattern: "*", action: "deny" },
        { permission: "skill", pattern: "research", action: "allow" },
      ],
    })
    const before = calls.length
    await applyPersonaScope(
      "user-1",
      "http://opencode:4096",
      headers,
      "ses_9",
      null,
    )
    expect(calls.length).toBe(before)
  })

  test("tolerates a typo in the persona name and reports the match", async () => {
    installFetch()
    const res = await post(
      { title: "Add export", persona: "softwre managr" },
      personaDb([]),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      persona?: { name: string; matched: string }
    }
    expect(body.persona?.name).toBe("Software manager")
    expect(body.persona?.matched).toBe("fuzzy")
  })

  test("the assistant persona binds nothing and injects nothing", async () => {
    installFetch()
    const bound: string[][] = []
    const res = await post(
      { title: "Job", message: "go", persona: "assistant" },
      personaDb(bound),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      persona?: { id: string; name: string; matched: string }
    }
    expect(body.persona).toEqual({
      id: "assistant",
      name: "Assistant",
      matched: "exact",
    })
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "go" }],
    })
    expect(bound).toEqual([])
  })

  test("an unknown persona fails fast with suggestions", async () => {
    installFetch()
    const res = await post({ title: "Job", persona: "zzzzzz" }, personaDb([]))
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: string
      suggestions: string[]
    }
    expect(body.error).toMatch(/unknown persona/)
    expect(body.suggestions.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })

  test("a blank persona is ignored", async () => {
    installFetch()
    const res = await post({ title: "Job", persona: "   " }, personaDb([]))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { persona?: unknown }
    expect(body.persona).toBeUndefined()
  })

  test("files a visible thread into a folder, creating it when new", async () => {
    installFetch()
    const dirLog: [string, string, string | null][] = []
    const dirs: {
      id: string
      userId: string
      name: string
      createdAt: number
    }[] = []
    const dirDb = {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      personas: () => [],
      installedPlugins: () => [],
      setThreadPersona: () => {},
      threadDirs: (userId: string) =>
        dirs.filter((row) => row.userId === userId),
      threadDirByName: (userId: string, name: string) =>
        dirs.find(
          (row) =>
            row.userId === userId &&
            row.name.toLowerCase() === name.toLowerCase(),
        ) ?? null,
      createThreadDir: (row: { id: string; userId: string; name: string }) => {
        dirs.push({ ...row, createdAt: 1 })
        return row
      },
      setThreadDir: (
        userId: string,
        sessionId: string,
        dirId: string | null,
      ) => {
        dirLog.push([userId, sessionId, dirId])
      },
    } as unknown as Db
    const created = await post({ title: "Follow up", dir: "Billing" }, dirDb)
    expect(created.status).toBe(201)
    const body = (await created.json()) as {
      display: boolean
      dir?: { name: string }
    }
    expect(body.display).toBe(true)
    expect(body.dir?.name).toBe("Billing")
    expect(dirLog).toEqual([["user-1", "ses_1", expect.any(String)]])
    // second run reuses the folder case-insensitively
    const again = await post({ title: "Again", dir: "billing" }, dirDb)
    expect(again.status).toBe(201)
    const againBody = (await again.json()) as { dir?: { name: string } }
    expect(againBody.dir?.name).toBe("Billing")
    expect(dirs).toHaveLength(1)
  })

  test("rejects dir with an explicit hidden thread and bad dir types", async () => {
    installFetch()
    expect(
      (await post({ title: "Job", dir: "Billing", display: false })).status,
    ).toBe(400)
    expect((await post({ title: "Job", dir: 42 })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("reports a sleeping desktop and never reaches opencode", async () => {
    installFetch()
    phase = "sleeping"
    const res = await post({ title: "Job" })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/not running/)
    expect(calls).toHaveLength(0)
  })

  test("reports an unreachable desktop", async () => {
    installFetch()
    failEndpoint = true
    const res = await post({ title: "Job" })
    expect(res.status).toBe(502)
  })

  test("surfaces session create failures", async () => {
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch
    const res = await post({ title: "Job" })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/session create failed/)
  })
})

describe("POST /api/threads councils", () => {
  function councilDb() {
    const councils: {
      id: string
      userId: string
      name: string
      createdAt: number
    }[] = []
    const members: {
      councilId: string
      userId: string
      sessionId: string
      role: string
      createdAt?: number
    }[] = []
    const mock = {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      personas: () => [],
      installedPlugins: () => [],
      setThreadPersona: () => {},
      councilByName: (userId: string, name: string) =>
        councils.find(
          (row) =>
            row.userId === userId &&
            row.name.toLowerCase() === name.toLowerCase(),
        ) ?? null,
      createCouncil: (row: { id: string; userId: string; name: string }) => {
        councils.push({ ...row, createdAt: 1 })
      },
      setCouncilMember: (row: {
        councilId: string
        userId: string
        sessionId: string
        role: string
      }) => {
        members.push(row)
      },
    } as unknown as Db
    return { mock, councils, members }
  }

  test("a council member is hidden, bound, and reported", async () => {
    installFetch()
    const { mock, councils, members } = councilDb()
    const res = await post(
      { title: "Research", council: "Auth Review", role: "Researcher" },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      display: boolean
      title: string
      council?: { name: string }
    }
    expect(body.display).toBe(false)
    expect(body.title).toBe("worker:Research")
    expect(body.council?.name).toBe("auth-review")
    expect(councils).toHaveLength(1)
    expect(members).toEqual([
      {
        councilId: councils[0]?.id,
        userId: "user-1",
        sessionId: body.id,
        role: "Researcher",
        createdAt: expect.any(Number),
      },
    ])
    // a second member joins the same council case-insensitively
    const again = await post({ title: "Review", council: "auth-review" }, mock)
    expect(again.status).toBe(201)
    const againBody = (await again.json()) as {
      council?: { name: string }
    }
    expect(againBody.council?.name).toBe("auth-review")
    expect(councils).toHaveLength(1)
    expect(members).toHaveLength(2)
  })

  test("refuses display and dir on council members", async () => {
    installFetch()
    const { mock } = councilDb()
    expect(
      (await post({ title: "Job", council: "review", display: true }, mock))
        .status,
    ).toBe(400)
    expect(
      (await post({ title: "Job", council: "review", dir: "Billing" }, mock))
        .status,
    ).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("a name with no slug characters is refused", async () => {
    installFetch()
    const { mock } = councilDb()
    const res = await post({ title: "Job", council: "!!!" }, mock)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/letters or digits/)
    expect(calls).toHaveLength(0)
  })
})

describe("POST /api/threads delegation watches", () => {
  function watchDb(withPersona = false) {
    const watches: Record<string, unknown>[] = []
    const councils: { id: string; userId: string; name: string }[] = []
    const members: Record<string, unknown>[] = []
    const mock = {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      personas: () =>
        withPersona
          ? [
              {
                id: "p1",
                name: "Software manager",
                instruction: "run the team",
                skills: null,
                skillsExtra: null,
                mcp: null,
                mcpExtra: null,
              },
            ]
          : [],
      installedPlugins: () => [],
      setThreadPersona: () => {},
      councilByName: (userId: string, name: string) =>
        councils.find(
          (row) =>
            row.userId === userId &&
            row.name.toLowerCase() === name.toLowerCase(),
        ) ?? null,
      createCouncil: (row: { id: string; userId: string; name: string }) => {
        councils.push(row)
      },
      setCouncilMember: (row: Record<string, unknown>) => {
        members.push(row)
      },
      createDelegationWatch: (row: Record<string, unknown>) => {
        watches.push(row)
      },
    } as unknown as Db
    return { mock, watches, councils }
  }

  function installDelegationFetch(options?: {
    status?: Record<string, { type: string }>
    sessions?: unknown[]
    rows?: Record<string, unknown>
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
        return Response.json(options?.sessions ?? [])
      const session = url.match(/\/session\/([^/]+)$/)
      if (session && (!init?.method || init.method === "GET")) {
        const row = options?.rows?.[session[1] ?? ""]
        return row ? Response.json(row) : new Response("nope", { status: 404 })
      }
      return Response.json({ id: "ses_1" })
    }) as unknown as typeof fetch
  }

  test("a valid --from arms a council wake and records the watch row", async () => {
    installDelegationFetch({
      rows: { chat1: { id: "chat1", title: "My chat" } },
    })
    const { mock, watches, councils } = watchDb()
    const res = await post(
      { title: "Research", council: "review", from: "chat1" },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      wake?: { armed: boolean; creator: string | null }
    }
    expect(body.wake).toEqual({ armed: true, creator: "chat1" })
    expect(watches).toHaveLength(1)
    expect(watches[0]).toMatchObject({
      kind: "council",
      creatorSessionId: "chat1",
      subjectSessionId: "ses_1",
      councilId: councils[0]?.id,
      wokenAt: null,
      pending: false,
    })
  })

  test("without --from the one busy top-level chat is inferred as the creator", async () => {
    installDelegationFetch({
      status: { chat1: { type: "busy" }, w1: { type: "busy" } },
      sessions: [
        { id: "chat1", title: "My chat" },
        { id: "w1", title: "worker:other" },
      ],
    })
    const { mock, watches } = watchDb()
    const res = await post({ title: "Research", council: "review" }, mock)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      wake?: { armed: boolean; creator: string | null }
      warning?: string
    }
    expect(body.wake).toEqual({ armed: true, creator: "chat1" })
    expect(body.warning).toBeUndefined()
    expect(watches[0]).toMatchObject({
      kind: "council",
      creatorSessionId: "chat1",
    })
  })

  test("an ambiguous desktop infers no creator and says the wake is unarmed", async () => {
    installDelegationFetch({
      status: { chat1: { type: "busy" }, chat2: { type: "busy" } },
      sessions: [
        { id: "chat1", title: "Chat one" },
        { id: "chat2", title: "Chat two" },
      ],
    })
    const { mock, watches } = watchDb()
    const res = await post({ title: "Research", council: "review" }, mock)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      wake?: { armed: boolean; creator: string | null }
    }
    expect(body.wake).toEqual({ armed: false, creator: null })
    expect(watches).toHaveLength(0)
  })

  test("an invalid --from falls back to inference and warns", async () => {
    installDelegationFetch({
      rows: { w1: { id: "w1", title: "worker:job" } },
      status: {},
    })
    const { mock, watches } = watchDb()
    const res = await post(
      { title: "Research", council: "review", from: "w1" },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      wake?: { armed: boolean; creator: string | null }
      warning?: string
    }
    expect(body.wake).toEqual({ armed: false, creator: null })
    expect(body.warning).toMatch(/--from ignored/)
    expect(watches).toHaveLength(0)
  })

  test("a persona teammate records a persona watch row", async () => {
    installDelegationFetch({
      rows: { chat1: { id: "chat1", title: "My chat" } },
    })
    const { mock, watches } = watchDb(true)
    const res = await post(
      {
        title: "Add export",
        persona: "software manager",
        from: "chat1",
        message: "Implement CSV export",
      },
      mock,
    )
    expect(res.status).toBe(201)
    expect(watches).toHaveLength(1)
    expect(watches[0]).toMatchObject({
      kind: "persona",
      creatorSessionId: "chat1",
      subjectSessionId: "ses_1",
      councilId: null,
    })
  })

  test("plain hidden threads record nothing and report no wake", async () => {
    installDelegationFetch()
    const { mock, watches } = watchDb()
    const res = await post({ title: "Scrape prices" }, mock)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { wake?: unknown }
    expect(body.wake).toBeUndefined()
    expect(watches).toHaveLength(0)
  })

  test("a non-string from is refused", async () => {
    installDelegationFetch()
    const { mock } = watchDb()
    expect((await post({ title: "Job", from: 42 }, mock)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe("GET /api/threads", () => {
  test("lists the hidden agent threads", async () => {
    installFetch()
    const res = await handleThreads(
      new Request("http://control/api/threads"),
      new URL("http://control/api/threads"),
      db,
      agent,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      threads: { id: string; title: string }[]
    }
    expect(body.threads).toEqual([{ id: "s1", title: "worker:job" }])
    expect(WORKER_TITLE_PREFIX).toBe("worker:")
  })

  test("reports a sleeping desktop", async () => {
    installFetch()
    phase = "sleeping"
    const res = await handleThreads(
      new Request("http://control/api/threads"),
      new URL("http://control/api/threads"),
      db,
      agent,
    )
    expect(res.status).toBe(409)
  })

  test("unknown methods 404", async () => {
    const res = await handleThreads(
      new Request("http://control/api/threads", { method: "PATCH" }),
      new URL("http://control/api/threads"),
      db,
      agent,
    )
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/threads", () => {
  function deleteRequest(body: unknown) {
    return handleThreads(
      new Request("http://control/api/threads", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      new URL("http://control/api/threads"),
      deleteDb,
      agent,
    )
  }

  let cleanupLog: string[]
  let deleteDb: Db
  let failDeletes = false

  function installDeleteFetch() {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      options?: RequestInit,
    ) => {
      const url = String(input)
      const init = options
      calls.push({ url, init })
      if (url.endsWith("/session") && (!init?.method || init.method === "GET"))
        return Response.json([
          { id: "s1", title: "worker:job" },
          { id: "s2", title: "Chat" },
          { id: "s3", title: "worker:helper", parentID: "p1" },
          { id: "s4", title: "cron-run:nightly" },
        ])
      if (url.includes("/session/") && init?.method === "DELETE") {
        if (failDeletes) return new Response("nope", { status: 500 })
        return Response.json({ id: url.split("/session/")[1] })
      }
      return Response.json({})
    }) as unknown as typeof fetch
  }

  beforeEach(() => {
    cleanupLog = []
    failDeletes = false
    deleteDb = {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      clearThreadPersona: (_userId: string, sessionId: string) => {
        cleanupLog.push(`persona:${sessionId}`)
      },
      clearThreadTitle: (_userId: string, sessionId: string) => {
        cleanupLog.push(`title:${sessionId}`)
      },
      clearThreadDir: (_userId: string, sessionId: string) => {
        cleanupLog.push(`dir:${sessionId}`)
      },
      clearCouncilMember: (_userId: string, sessionId: string) => {
        cleanupLog.push(`council:${sessionId}`)
      },
      deleteDelegationWatches: (_userId: string, sessionId: string) => {
        cleanupLog.push(`watch-subject:${sessionId}`)
      },
      deleteDelegationWatchesByCreator: (
        _userId: string,
        sessionId: string,
      ) => {
        cleanupLog.push(`watch-creator:${sessionId}`)
      },
      workspaceMediaForSession: () => [],
      deleteWorkspaceMedia: () => {},
      clearThreadScreen: () => {},
    } as unknown as Db
  })

  afterEach(() => {
    failDeletes = false
  })

  test("validates the ids body", async () => {
    installFetch()
    expect((await deleteRequest({})).status).toBe(400)
    expect((await deleteRequest({ ids: "s1" })).status).toBe(400)
    expect((await deleteRequest({ ids: [42] })).status).toBe(400)
    expect((await deleteRequest({ ids: [] })).status).toBe(400)
    expect((await deleteRequest({ ids: ["   "] })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("deletes hidden agent threads and runs the cleanup", async () => {
    installDeleteFetch()
    const res = await deleteRequest({ ids: ["s1", "s1"] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      deleted: string[]
      skipped: { id: string; reason: string }[]
    }
    expect(body.deleted).toEqual(["s1"])
    expect(body.skipped).toEqual([])
    expect(cleanupLog).toEqual([
      "persona:s1",
      "title:s1",
      "dir:s1",
      "council:s1",
      "watch-subject:s1",
      "watch-creator:s1",
    ])
    const del = calls.find(
      (call) =>
        call.url.endsWith("/session/s1") && call.init?.method === "DELETE",
    )
    expect(del).toBeDefined()
  })

  test("skips anything that is not a hidden agent thread", async () => {
    installDeleteFetch()
    const res = await deleteRequest({
      ids: ["s1", "s2", "s3", "s4", "missing"],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      deleted: string[]
      skipped: { id: string; reason: string }[]
    }
    expect(body.deleted).toEqual(["s1"])
    expect(body.skipped).toEqual([
      { id: "s2", reason: "not a hidden agent thread" },
      { id: "s3", reason: "not a hidden agent thread" },
      { id: "s4", reason: "not a hidden agent thread" },
      { id: "missing", reason: "not a hidden agent thread" },
    ])
    expect(cleanupLog).toEqual([
      "persona:s1",
      "title:s1",
      "dir:s1",
      "council:s1",
      "watch-subject:s1",
      "watch-creator:s1",
    ])
  })

  test("reports a delete failure as skipped", async () => {
    installDeleteFetch()
    failDeletes = true
    const res = await deleteRequest({ ids: ["s1"] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      deleted: string[]
      skipped: { id: string; reason: string }[]
    }
    expect(body.deleted).toEqual([])
    expect(body.skipped).toEqual([{ id: "s1", reason: "delete failed" }])
    expect(cleanupLog).toEqual([])
  })

  test("reports a sleeping desktop and never reaches opencode", async () => {
    installFetch()
    phase = "sleeping"
    const res = await deleteRequest({ ids: ["s1"] })
    expect(res.status).toBe(409)
    expect(calls).toHaveLength(0)
  })

  test("caps the batch at 100 ids", async () => {
    installDeleteFetch()
    const res = await deleteRequest({
      ids: Array.from({ length: 101 }, (_, index) => `s${index}`),
    })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/threads/:id/stop|post + GET status", () => {
  let abortFails = false
  let statuses: Record<string, { type: string }>

  function managedDb(personaBound: string[] = []) {
    return {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      threadPersona: (_userId: string, sessionId: string) =>
        personaBound.includes(sessionId) ? { personaId: "p1" } : null,
    } as unknown as Db
  }

  function installManageFetch() {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      options?: RequestInit,
    ) => {
      const url = String(input)
      const init = options
      calls.push({ url, init })
      if (url.endsWith("/session/status")) return Response.json(statuses)
      const session = url.match(/\/session\/([^/]+)$/)
      if (session && (!init?.method || init.method === "GET")) {
        const id = session[1]
        const rows: Record<string, unknown> = {
          w1: { id: "w1", title: "worker:job" },
          p1: { id: "p1", title: "Plugin teammate" },
          u1: { id: "u1", title: "User chat" },
          c1: { id: "c1", title: "cron-run:nightly" },
          sub: { id: "sub", title: "worker:sub", parentID: "w1" },
        }
        const row = rows[id ?? ""]
        return row ? Response.json(row) : new Response("nope", { status: 404 })
      }
      if (url.endsWith("/abort")) {
        if (abortFails) return new Response("nope", { status: 500 })
        return Response.json({})
      }
      return Response.json({})
    }) as unknown as typeof fetch
  }

  function manage(
    path: string,
    body?: unknown,
    useDb: Db = managedDb(["p1"]),
    method: "POST" | "GET" = "POST",
  ) {
    return handleThreads(
      new Request(`http://control${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      new URL(`http://control${path}`),
      useDb,
      agent,
    )
  }

  test("status reports the thread's running state", async () => {
    installManageFetch()
    statuses = { w1: { type: "busy" }, p1: { type: "idle" } }
    const busy = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(busy.status).toBe(200)
    expect(await busy.json()).toEqual({
      id: "w1",
      running: true,
      state: "busy",
    })
    const idle = await manage(
      "/api/threads/p1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(await idle.json()).toEqual({
      id: "p1",
      running: false,
      state: "idle",
    })
  })

  test("status treats a missing status entry as idle and refuses unmanaged threads", async () => {
    installManageFetch()
    statuses = {}
    const idle = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(await idle.json()).toEqual({
      id: "w1",
      running: false,
      state: "idle",
    })
    for (const id of ["u1", "c1"]) {
      expect(
        (await manage(`/api/threads/${id}/status`, undefined, undefined, "GET"))
          .status,
      ).toBe(403)
    }
    for (const id of ["sub", "missing"]) {
      expect(
        (await manage(`/api/threads/${id}/status`, undefined, undefined, "GET"))
          .status,
      ).toBe(404)
    }
  })

  test("status reports a sleeping desktop before any call", async () => {
    installManageFetch()
    statuses = {}
    phase = "sleeping"
    expect(
      (await manage("/api/threads/w1/status", undefined, undefined, "GET"))
        .status,
    ).toBe(409)
    expect(calls).toHaveLength(0)
  })

  test("isThreadRequest matches the manage routes only", () => {
    expect(isThreadRequest("/api/threads/s1/stop", "POST")).toBe(true)
    expect(isThreadRequest("/api/threads/s1/post", "POST")).toBe(true)
    expect(isThreadRequest("/api/threads/s1/status", "GET")).toBe(true)
    expect(isThreadRequest("/api/threads/s1/status", "POST")).toBe(false)
    expect(isThreadRequest("/api/threads/s1/stop", "GET")).toBe(false)
    expect(isThreadRequest("/api/threads/s1/pause", "POST")).toBe(false)
    expect(isThreadRequest("/api/threads//stop", "POST")).toBe(false)
  })

  test("stop aborts a worker thread", async () => {
    installManageFetch()
    const res = await manage("/api/threads/w1/stop")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "w1", stopped: true })
    const abort = calls.find((call) => call.url.endsWith("/session/w1/abort"))
    expect(abort?.init?.method).toBe("POST")
  })

  test("stop refuses user chats, cron jobs, and subagents", async () => {
    installManageFetch()
    for (const id of ["u1", "c1"]) {
      expect((await manage(`/api/threads/${id}/stop`)).status).toBe(403)
    }
    // subagents are not threads at all, like unknown ids
    for (const id of ["sub", "missing"]) {
      expect((await manage(`/api/threads/${id}/stop`)).status).toBe(404)
    }
    expect(calls.some((call) => call.url.endsWith("/abort"))).toBeFalse()
  })

  test("stop allows a persona-bound visible thread and reports failures", async () => {
    installManageFetch()
    const res = await manage(
      "/api/threads/p1/stop",
      undefined,
      managedDb(["p1"]),
    )
    expect(res.status).toBe(200)
    abortFails = true
    const bad = await manage("/api/threads/p1/stop")
    expect(bad.status).toBe(502)
  })

  test("post sends a follow-up prompt into a persona-bound thread", async () => {
    installManageFetch()
    const res = await manage("/api/threads/p1/post", {
      message: "Stop editing; report what you changed",
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "p1", posted: true })
    const prompt = calls.find((call) =>
      call.url.endsWith("/session/p1/prompt_async"),
    )
    expect(prompt).toBeDefined()
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Stop editing; report what you changed" }],
    })
  })

  test("post validates the message and refuses unmanaged threads", async () => {
    installManageFetch()
    expect((await manage("/api/threads/p1/post", {})).status).toBe(400)
    expect((await manage("/api/threads/p1/post", { message: "" })).status).toBe(
      400,
    )
    expect(
      (await manage("/api/threads/u1/post", { message: "hi" })).status,
    ).toBe(403)
    expect(calls.some((call) => call.url.includes("prompt_async"))).toBeFalse()
  })

  test("manage routes report a sleeping desktop before any call", async () => {
    installManageFetch()
    phase = "sleeping"
    expect((await manage("/api/threads/w1/stop")).status).toBe(409)
    expect(
      (await manage("/api/threads/w1/post", { message: "hi" })).status,
    ).toBe(409)
    expect(calls).toHaveLength(0)
  })
})
