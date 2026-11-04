import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Db, User } from "@open-bot/db"

let phase = "running"
let failEndpoint = false
let death: {
  running: boolean
  oomKilled: boolean
  exitCode: number | null
} | null = null

mock.module("./docker", () => ({
  desktopDeathInfo: async () => death,
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
  handleOpencodeRead,
  handleThreads,
  hiddenThreadTitle,
  isOpencodeReadRequest,
  isThreadRequest,
  mergeThreadModelUpdate,
  parseThreadModelUpdate,
  sanitizeThreadTitle,
  threadTitleError,
} = await import("./threads")
const { clearModelVariants } = await import("./effort")

const agent = { id: "user-1", disabled: false } as unknown as User
const db = {
  desktop: (id: string) =>
    id === "user-1" ? { opencodePassword: "pw" } : null,
  personas: () => [],
  installedPlugins: () => [],
  setThreadPersona: () => {},
  builtinPersonaScopes: () => [],
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
  builtinPersonaScopes: () => [],
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
    builtinPersonaScopes: () => [],
  } as unknown as Db
}

const originalFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []
let promptFails = false
let phaseStatuses: Record<string, string> = {}

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
    if (
      url.endsWith("/session/status") &&
      (!init?.method || init.method === "GET")
    )
      return Response.json(
        Object.fromEntries(
          Object.entries(phaseStatuses).map(([id, type]) => [id, { type }]),
        ),
      )
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
  death = null
  phaseStatuses = {}
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
    expect(isThreadRequest("/api/threads/s1/model", "GET")).toBe(true)
    expect(isThreadRequest("/api/threads/s1/model", "POST")).toBe(true)
    expect(isThreadRequest("/api/threads/s1/model", "PUT")).toBe(false)
    expect(isThreadRequest("/api/threads/s1", "DELETE")).toBe(false)
    expect(isThreadRequest("/api/cron", "GET")).toBe(false)
  })
})

describe("parseThreadModelUpdate + mergeThreadModelUpdate", () => {
  test("absent halves keep, null clears, values set", () => {
    expect(parseThreadModelUpdate({})).toEqual({ update: {} })
    expect(parseThreadModelUpdate({ model: null, effort: null })).toEqual({
      update: { model: null, effort: null },
    })
    expect(parseThreadModelUpdate({ model: " prov/fast " })).toEqual({
      update: { model: { providerID: "prov", modelID: "fast" } },
    })
    expect(parseThreadModelUpdate({ thinkingEffort: "low" })).toEqual({
      update: { effort: "low" },
    })
    expect(parseThreadModelUpdate({ model: "" })).toEqual({
      update: { model: null },
    })
  })

  test("malformed values are errors", () => {
    expect(parseThreadModelUpdate({ model: "nope" })).toHaveProperty("error")
    expect(parseThreadModelUpdate({ model: 42 })).toHaveProperty("error")
    expect(parseThreadModelUpdate({ effort: "two words" })).toHaveProperty(
      "error",
    )
  })

  test("merge applies only the halves the update names", () => {
    const stored = { providerId: "prov", modelId: "reasoner", effort: "high" }
    expect(mergeThreadModelUpdate(stored, {})).toEqual({
      providerID: "prov",
      modelID: "reasoner",
      effort: "high",
    })
    expect(
      mergeThreadModelUpdate(stored, {
        model: { providerID: "prov", modelID: "fast" },
      }),
    ).toEqual({ providerID: "prov", modelID: "fast", effort: "high" })
    expect(
      mergeThreadModelUpdate(stored, { model: null, effort: null }),
    ).toEqual({ providerID: null, modelID: null, effort: null })
    expect(mergeThreadModelUpdate(null, { effort: "low" })).toEqual({
      providerID: null,
      modelID: null,
      effort: "low",
    })
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
    const create = calls.find(
      (call) => call.url.endsWith("/session") && call.init?.method === "POST",
    )
    expect(create).toBeDefined()
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      title: "worker:Scrape prices",
    })
    expect(calls.some((call) => call.url.endsWith("/prompt_async"))).toBeFalse()
  })

  test("warns when a same-titled worker is already running a turn", async () => {
    installFetch()
    phaseStatuses = { s1: "busy" }
    const res = await post({ title: "job" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toMatch(
      /another worker with this title is already running \(s1\)/,
    )
  })

  test("warns a hidden start while other workers run on the shared filesystem", async () => {
    installFetch()
    phaseStatuses = { s1: "busy" }
    const res = await post({ title: "other job" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toMatch(
      /1 other worker thread.*running on this shared filesystem/,
    )
    expect(body.warning).toContain("job")
  })

  test("a same-titled idle worker does not warn", async () => {
    installFetch()
    phaseStatuses = { s1: "idle" }
    const res = await post({ title: "job" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { warning?: string }
    expect(body.warning).toBeUndefined()
  })

  test("display threads keep the given title", async () => {
    installFetch()
    const res = await post({ title: "Nightly sync", display: true })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { title: string; display: boolean }
    expect(body.title).toBe("Nightly sync")
    expect(body.display).toBe(true)
  })

  test("steps unlimited binds the no-step-cap agent on the session create", async () => {
    installFetch()
    const res = await post({
      title: "Deep build",
      steps: "unlimited",
      message: "go",
    })
    expect(res.status).toBe(201)
    const create = calls.find(
      (call) => call.url.endsWith("/session") && call.init?.method === "POST",
    )
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      title: "worker:Deep build",
      agent: "build-unlimited",
    })
  })

  test("rejects step values other than unlimited", async () => {
    installFetch()
    expect((await post({ title: "Job", steps: 10 })).status).toBe(400)
    expect((await post({ title: "Job", steps: "default" })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("posts the first message into the new thread with the screen line", async () => {
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
      // the screen ensure fails on the mocked desktop; the fallback line
      // still names the session id so the agent is never screen-blind
      system: expect.stringContaining("screen id"),
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
      system: expect.stringContaining("screen id"),
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
      system: expect.stringMatching(
        /answer as Software manager[\s\S]*screen id/,
      ),
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
      persona?: { skills?: { allowed: number; blocked: boolean } }
    }
    expect(body.persona?.skills).toEqual({ allowed: 1, blocked: false })
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
      db,
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
        skillsNone: false,
        skillsEffective: ["research"],
        mcp: null,
        mcpExtra: null,
        mcpNone: false,
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
      db,
      "user-1",
      "http://opencode:4096",
      headers,
      "ses_9",
      null,
    )
    expect(calls.length).toBe(before)

    // The Assistant's all-skills base must also clear a stale seed-only
    // ruleset persisted on an existing session: with no MCP rules to send
    // (the mocked config read fails), the re-apply PATCHes permission null
    // instead of leaving the old rules in place.
    await applyPersonaScope(
      db,
      "user-1",
      "http://opencode:4096",
      headers,
      "ses_9",
      {
        id: "assistant",
        name: "Assistant",
        instruction: "",
        builtin: true,
        skills: null,
        skillsExtra: null,
        skillsNone: false,
        skillsEffective: null,
        mcp: null,
        mcpExtra: null,
        mcpNone: false,
        mcpEffective: null,
      },
    )
    const clear = calls
      .slice(before)
      .find(
        (call) =>
          call.url.endsWith("/session/ses_9") &&
          (call.init as RequestInit | undefined)?.method === "PATCH",
      )
    expect(clear).toBeDefined()
    expect(JSON.parse(String(clear?.init?.body))).toEqual({
      permission: null,
    })
  })

  test("an explicitly bound assistant persona loads all skills, seed-scoped MCP", async () => {
    installFetch()
    const bound: string[][] = []
    const res = await post(
      { title: "Helper", message: "Help me", persona: "assistant" },
      personaDb(bound),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      persona?: { id: string; skills?: unknown; mcp?: unknown }
    }
    expect(body.persona?.id).toBe("assistant")
    // every skill loads (no seed probe needed); MCP keeps the seed default
    expect(body.persona?.skills).toEqual({ all: true })
    expect(body.persona?.mcp).toEqual({ seedDefault: true, extra: 0 })
    expect(bound).toEqual([["user-1", "ses_1", "assistant"]])
    // no permission key: the scope probes fail on this mock, and the
    // degrade path must stay unrestricted rather than block the thread
    const create = calls.find(
      (call) =>
        call.url.endsWith("/session") &&
        (call.init as RequestInit | undefined)?.method === "POST",
    )
    expect(JSON.parse(String(create?.init?.body)).permission).toBeUndefined()
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(String(JSON.parse(String(prompt?.init?.body)).system)).toContain(
      "All skills load in this thread",
    )
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
      builtinPersonaScopes: () => [],
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
      builtinPersonaScopes: () => [],
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

  test("steps unlimited works on a council member too", async () => {
    installFetch()
    const { mock } = councilDb()
    const res = await post(
      {
        title: "Deep review",
        council: "long-review",
        role: "Reviewer",
        steps: "unlimited",
      },
      mock,
    )
    expect(res.status).toBe(201)
    const create = calls.find(
      (call) => call.url.endsWith("/session") && call.init?.method === "POST",
    )
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      title: "worker:Deep review",
      agent: "build-unlimited",
    })
  })
})

describe("POST /api/threads model and effort picks", () => {
  function pickDb() {
    const councils: { id: string; userId: string; name: string }[] = []
    const members: Record<string, unknown>[] = []
    const picks: Record<string, unknown>[] = []
    const bound: string[][] = []
    const mock = {
      desktop: (id: string) =>
        id === "user-1"
          ? {
              opencodePassword: "pw",
              selectedProvider: "prov",
              selectedModel: "reasoner",
              thinkingEffort: null,
            }
          : null,
      personas: () => [
        {
          id: "p1",
          name: "Software manager",
          instruction: "run the team",
          skills: null,
          skillsExtra: null,
          mcp: null,
          mcpExtra: null,
        },
      ],
      installedPlugins: () => [],
      builtinPersonaScopes: () => [],
      setThreadPersona: (
        userId: string,
        sessionId: string,
        personaId: string,
      ) => {
        bound.push([userId, sessionId, personaId])
      },
      setThreadModel: (row: Record<string, unknown>) => {
        picks.push(row)
      },
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
      createDelegationWatch: () => {},
    } as unknown as Db
    return { mock, councils, members, picks, bound }
  }

  test("a council member carries its own persona, model, and effort", async () => {
    installFetch()
    const { mock, picks, bound } = pickDb()
    const res = await post(
      {
        title: "Token storage",
        council: "auth-review",
        role: "Reviewer",
        persona: "Software manager",
        model: "prov/reasoner",
        effort: "high",
        message: "Review token storage",
      },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      model?: string
      effort?: string
      persona?: { name: string }
    }
    expect(body.model).toBe("prov/reasoner")
    expect(body.effort).toBe("high")
    expect(body.persona?.name).toBe("Software manager")
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Review token storage" }],
      system: expect.stringMatching(/answer as Software manager/),
      model: { providerID: "prov", modelID: "reasoner" },
      variant: "high",
    })
    expect(picks).toEqual([
      {
        userId: "user-1",
        sessionId: "ses_1",
        providerId: "prov",
        modelId: "reasoner",
        effort: "high",
      },
    ])
    expect(bound).toEqual([["user-1", "ses_1", "p1"]])
  })

  test("members of two councils from one caller keep separate picks", async () => {
    installFetch()
    const { mock, councils, picks } = pickDb()
    expect(
      (
        await post(
          {
            title: "OAuth paths",
            council: "auth-review",
            model: "prov/reasoner",
            effort: "low",
            message: "map paths",
          },
          mock,
        )
      ).status,
    ).toBe(201)
    expect(
      (
        await post(
          {
            title: "Hot paths",
            council: "perf-review",
            model: "prov/reasoner",
            effort: "high",
            message: "profile",
          },
          mock,
        )
      ).status,
    ).toBe(201)
    expect(councils.map((row) => row.name)).toEqual([
      "auth-review",
      "perf-review",
    ])
    expect(picks.map((row) => row.effort)).toEqual(["low", "high"])
  })

  test("an unknown model is refused before any session exists", async () => {
    installFetch()
    const { mock } = pickDb()
    const res = await post(
      { title: "Job", council: "auth-review", model: "prov/nope" },
      mock,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/unknown model "prov\/nope"/)
    expect(
      calls.some(
        (call) => call.url.endsWith("/session") && call.init?.method === "POST",
      ),
    ).toBeFalse()
  })

  test("an effort the model does not offer is refused with its levels", async () => {
    installFetch()
    const { mock } = pickDb()
    const res = await post(
      { title: "Job", model: "prov/reasoner", effort: "xhigh" },
      mock,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/levels: high, low/)
  })

  test("malformed model and effort values are 400s", async () => {
    installFetch()
    const { mock } = pickDb()
    expect((await post({ title: "Job", model: "nope" }, mock)).status).toBe(400)
    expect((await post({ title: "Job", model: 42 }, mock)).status).toBe(400)
    expect((await post({ title: "Job", effort: 42 }, mock)).status).toBe(400)
    expect(
      (await post({ title: "Job", effort: "two words" }, mock)).status,
    ).toBe(400)
    expect(
      calls.some(
        (call) => call.url.endsWith("/session") && call.init?.method === "POST",
      ),
    ).toBeFalse()
  })

  test("an effort-only pick stamps the variant and stores a null model", async () => {
    installFetch()
    const { mock, picks } = pickDb()
    const res = await post(
      { title: "Quick scan", effort: "low", message: "scan" },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { model?: string; effort?: string }
    expect(body.model).toBeUndefined()
    expect(body.effort).toBe("low")
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    const sent = JSON.parse(String(prompt?.init?.body)) as Record<
      string,
      unknown
    >
    expect(sent.model).toBeUndefined()
    expect(sent.variant).toBe("low")
    expect(picks).toEqual([
      {
        userId: "user-1",
        sessionId: "ses_1",
        providerId: null,
        modelId: null,
        effort: "low",
      },
    ])
  })
})

describe("POST /api/threads delegation watches", () => {
  function watchDb(
    withPersona = false,
    parentPick: {
      providerId: string | null
      modelId: string | null
      effort: string | null
    } | null = null,
  ) {
    const watches: Record<string, unknown>[] = []
    const picks: Record<string, unknown>[] = []
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
      builtinPersonaScopes: () => [],
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
      threadModel: (_userId: string, sessionId: string) =>
        sessionId === "chat1" ? parentPick : null,
      setThreadModel: (row: Record<string, unknown>) => {
        picks.push(row)
      },
    } as unknown as Db
    return { mock, watches, councils, picks }
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

  test("a council member without --model inherits the creator thread's pick", async () => {
    installDelegationFetch({
      rows: { chat1: { id: "chat1", title: "My chat" } },
    })
    const { mock, picks } = watchDb(false, {
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    const res = await post(
      {
        title: "Research",
        council: "review",
        from: "chat1",
        message: "Go research",
      },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      model?: string
      effort?: string
      modelInherited?: boolean
    }
    expect(body.model).toBe("prov/reasoner")
    expect(body.effort).toBe("high")
    expect(body.modelInherited).toBe(true)
    expect(picks).toEqual([
      {
        userId: "user-1",
        sessionId: "ses_1",
        providerId: "prov",
        modelId: "reasoner",
        effort: "high",
      },
    ])
    const prompt = calls.find((call) => call.url.endsWith("/prompt_async"))
    const sent = JSON.parse(String(prompt?.init?.body)) as Record<
      string,
      unknown
    >
    expect(sent.model).toEqual({ providerID: "prov", modelID: "reasoner" })
  })

  test("an explicit --model wins over the creator thread's pick", async () => {
    installDelegationFetch({
      rows: { chat1: { id: "chat1", title: "My chat" } },
    })
    const { mock, picks } = watchDb(false, {
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    const res = await post(
      {
        title: "Research",
        council: "review",
        from: "chat1",
        model: "prov/reasoner",
        effort: "low",
        message: "Go research",
      },
      mock,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      effort?: string
      modelInherited?: boolean
    }
    expect(body.effort).toBe("low")
    expect(body.modelInherited).toBeUndefined()
    expect(picks[0]).toMatchObject({ effort: "low" })
  })

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
    // The busy worker:other session is live on the shared filesystem, so
    // the hidden start warns about it — that is the warning slot now.
    expect(body.warning).toMatch(/shared filesystem/)
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
      clearThreadModel: (_userId: string, sessionId: string) => {
        cleanupLog.push(`model:${sessionId}`)
      },
      clearThreadQueue: (_userId: string, sessionId: string) => {
        cleanupLog.push(`queue:${sessionId}`)
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
      "model:s1",
      "queue:s1",
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
      "model:s1",
      "queue:s1",
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

  function managedDb(
    personaBound: string[] = [],
    modelRow: {
      providerId: string | null
      modelId: string | null
      effort: string | null
    } | null = null,
  ) {
    return {
      desktop: (id: string) =>
        id === "user-1" ? { opencodePassword: "pw" } : null,
      threadPersona: (_userId: string, sessionId: string) =>
        personaBound.includes(sessionId) ? { personaId: "p1" } : null,
      threadModel: () => modelRow,
    } as unknown as Db
  }

  function installManageFetch(messages: Record<string, unknown[]> = {}) {
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
                fast: { name: "Fast", variants: {} },
              },
            },
          ],
        })
      if (url.endsWith("/session/status")) return Response.json(statuses)
      const message = url.match(/\/session\/([^/]+)\/message$/)
      if (message && (!init?.method || init.method === "GET")) {
        const rows = messages[message[1] ?? ""]
        return rows
          ? Response.json(rows)
          : new Response("nope", { status: 500 })
      }
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

  test("status reports a starting session instead of faking idle", async () => {
    installManageFetch()
    statuses = {}
    const starting = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(await starting.json()).toEqual({
      id: "w1",
      running: true,
      state: "starting",
    })
  })

  test("status derives idle from messages when the status entry is gone", async () => {
    // opencode drops the status entry once a turn ends (and on restart),
    // so a finished thread must not read as starting forever.
    installManageFetch({
      w1: [
        { info: { role: "user", time: { created: 1 } }, parts: [] },
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: 2, completed: 3 },
          },
          parts: [{ type: "text", text: "done" }],
        },
      ],
    })
    statuses = {}
    const res = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(await res.json()).toEqual({
      id: "w1",
      running: false,
      state: "idle",
    })
  })

  test("status reports stalled when a prompt never registered a turn", async () => {
    installManageFetch({
      w1: [
        {
          info: { role: "user", time: { created: Date.now() - 10 * 60_000 } },
          parts: [{ type: "text", text: "go" }],
        },
      ],
    })
    statuses = {}
    const res = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(await res.json()).toEqual({
      id: "w1",
      running: false,
      state: "stalled",
    })
  })

  test("status keeps 404 when the missing entry is a gone session", async () => {
    installManageFetch()
    statuses = {}
    for (const id of ["sub", "missing"]) {
      expect(
        (await manage(`/api/threads/${id}/status`, undefined, undefined, "GET"))
          .status,
      ).toBe(404)
    }
    for (const id of ["u1", "c1"]) {
      expect(
        (await manage(`/api/threads/${id}/status`, undefined, undefined, "GET"))
          .status,
      ).toBe(403)
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

  test("status reports a definite desktop_down with OOM info", async () => {
    installManageFetch()
    statuses = {}
    phase = "sleeping"
    death = { running: false, oomKilled: true, exitCode: 137 }
    const res = await manage(
      "/api/threads/w1/status",
      undefined,
      undefined,
      "GET",
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: "w1",
      running: false,
      state: "desktop_down",
      desktop: { running: false, oomKilled: true, exitCode: 137 },
    })
  })

  test("an inconclusive death (mid-recreate) keeps the 409", async () => {
    installManageFetch()
    statuses = {}
    phase = "sleeping"
    death = null
    expect(
      (await manage("/api/threads/w1/status", undefined, undefined, "GET"))
        .status,
    ).toBe(409)
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
    // Posts carry the screen/session system line like the first prompt —
    // a member briefed only through post must learn its own screen id.
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Stop editing; report what you changed" }],
      system: expect.stringContaining(
        "This thread's screen id (also your session id, for ob-thread --from) is p1.",
      ),
    })
  })

  test("post keeps the model and effort the thread was created with", async () => {
    installManageFetch()
    const res = await manage(
      "/api/threads/w1/post",
      { message: "Wrap up and report" },
      managedDb([], {
        providerId: "prov",
        modelId: "reasoner",
        effort: "high",
      }),
    )
    expect(res.status).toBe(200)
    const prompt = calls.find((call) =>
      call.url.endsWith("/session/w1/prompt_async"),
    )
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: "text", text: "Wrap up and report" }],
      system: expect.stringContaining(
        "This thread's screen id (also your session id, for ob-thread --from) is w1.",
      ),
      model: { providerID: "prov", modelID: "reasoner" },
      variant: "high",
    })
  })

  // Hot model updates: a mutable thread_models row over a desktop whose
  // default is prov/reasoner with no saved effort.
  function modelDb(
    row: {
      providerId: string | null
      modelId: string | null
      effort: string | null
    } | null,
  ) {
    const state = {
      row,
      saved: [] as {
        userId: string
        sessionId: string
        providerId: string | null
        modelId: string | null
        effort: string | null
      }[],
      cleared: 0,
    }
    const useDb = {
      desktop: (id: string) =>
        id === "user-1"
          ? {
              opencodePassword: "pw",
              selectedProvider: "prov",
              selectedModel: "reasoner",
              thinkingEffort: null,
            }
          : null,
      threadPersona: () => null,
      threadModel: () => state.row,
      setThreadModel: (next: {
        userId: string
        sessionId: string
        providerId: string | null
        modelId: string | null
        effort: string | null
      }) => {
        state.saved.push(next)
        state.row = {
          providerId: next.providerId,
          modelId: next.modelId,
          effort: next.effort,
        }
      },
      clearThreadModel: () => {
        state.cleared++
        state.row = null
      },
    } as unknown as Db
    return { useDb, state }
  }

  test("model reads the effective pick and the pinned halves", async () => {
    installManageFetch()
    const pinned = modelDb({
      providerId: "prov",
      modelId: "fast",
      effort: null,
    })
    const res = await manage(
      "/api/threads/w1/model",
      undefined,
      pinned.useDb,
      "GET",
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: "w1",
      model: "prov/fast",
      effort: null,
      thread: { model: "prov/fast", effort: null },
    })
    const plain = modelDb(null)
    const fallback = await manage(
      "/api/threads/w1/model",
      undefined,
      plain.useDb,
      "GET",
    )
    expect(await fallback.json()).toEqual({
      id: "w1",
      model: "prov/reasoner",
      effort: null,
      thread: { model: null, effort: null },
    })
  })

  test("model hot-switches the pick and drops an unsupported carried effort", async () => {
    clearModelVariants("user-1")
    installManageFetch()
    const { useDb, state } = modelDb({
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    const res = await manage(
      "/api/threads/w1/model",
      { model: "prov/fast" },
      useDb,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: "w1",
      model: "prov/fast",
      effort: null,
      thread: { model: "prov/fast", effort: null },
      effortDropped: "high",
    })
    expect(state.saved).toEqual([
      {
        userId: "user-1",
        sessionId: "w1",
        providerId: "prov",
        modelId: "fast",
        effort: null,
      },
    ])
  })

  test("model updates one half at a time and clears back to the default", async () => {
    clearModelVariants("user-1")
    installManageFetch()
    const { useDb, state } = modelDb({
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
    const effortOnly = await manage(
      "/api/threads/w1/model",
      { effort: "low" },
      useDb,
    )
    expect(effortOnly.status).toBe(200)
    expect(state.row).toEqual({
      providerId: "prov",
      modelId: "reasoner",
      effort: "low",
    })
    const cleared = await manage(
      "/api/threads/w1/model",
      { model: null, effort: null },
      useDb,
    )
    expect(cleared.status).toBe(200)
    expect(state.cleared).toBe(1)
    expect(state.row).toBeNull()
    expect(await cleared.json()).toEqual({
      id: "w1",
      model: "prov/reasoner",
      effort: null,
      thread: { model: null, effort: null },
    })
  })

  test("model refuses bad picks and unmanaged threads without storing", async () => {
    clearModelVariants("user-1")
    installManageFetch()
    const { useDb, state } = modelDb(null)
    const badEffort = await manage(
      "/api/threads/w1/model",
      { model: "prov/fast", effort: "high" },
      useDb,
    )
    expect(badEffort.status).toBe(400)
    expect(((await badEffort.json()) as { error: string }).error).toMatch(
      /not available on prov\/fast/,
    )
    const unknown = await manage(
      "/api/threads/w1/model",
      { model: "prov/nope" },
      useDb,
    )
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: string }).error).toMatch(
      /unknown model "prov\/nope"/,
    )
    expect((await manage("/api/threads/w1/model", {}, useDb)).status).toBe(400)
    expect(
      (await manage("/api/threads/u1/model", { model: "prov/fast" }, useDb))
        .status,
    ).toBe(403)
    expect(state.saved).toHaveLength(0)
    expect(state.cleared).toBe(0)
  })

  test("post can switch the model for its own turn and persists the pick", async () => {
    clearModelVariants("user-1")
    installManageFetch()
    const { useDb, state } = modelDb({
      providerId: "prov",
      modelId: "fast",
      effort: null,
    })
    const res = await manage(
      "/api/threads/w1/post",
      { message: "Now the hard part", model: "prov/reasoner", effort: "high" },
      useDb,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: "w1",
      posted: true,
      model: "prov/reasoner",
      effort: "high",
    })
    const prompt = calls.find((call) =>
      call.url.endsWith("/session/w1/prompt_async"),
    )
    const sent = JSON.parse(String(prompt?.init?.body)) as {
      model?: unknown
      variant?: unknown
    }
    expect(sent.model).toEqual({ providerID: "prov", modelID: "reasoner" })
    expect(sent.variant).toBe("high")
    expect(state.row).toEqual({
      providerId: "prov",
      modelId: "reasoner",
      effort: "high",
    })
  })

  test("post with a bad switch sends nothing; clearing unpins the model", async () => {
    clearModelVariants("user-1")
    installManageFetch()
    const { useDb, state } = modelDb({
      providerId: "prov",
      modelId: "fast",
      effort: null,
    })
    const bad = await manage(
      "/api/threads/w1/post",
      { message: "hi", model: "prov/nope" },
      useDb,
    )
    expect(bad.status).toBe(400)
    expect(calls.some((call) => call.url.includes("prompt_async"))).toBeFalse()
    expect(state.saved).toHaveLength(0)

    const cleared = await manage(
      "/api/threads/w1/post",
      { message: "back to the default", model: null },
      useDb,
    )
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ id: "w1", posted: true })
    expect(state.cleared).toBe(1)
    const prompt = calls.find((call) =>
      call.url.endsWith("/session/w1/prompt_async"),
    )
    expect(JSON.parse(String(prompt?.init?.body))).not.toHaveProperty("model")
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

  function read(path: string, useDb: Db = managedDb(["p1"])) {
    return handleOpencodeRead(
      new Request(`http://control${path}`),
      new URL(`http://control${path}`),
      useDb,
      agent,
    )
  }

  test("read returns trimmed messages for a worker thread", async () => {
    installManageFetch({
      w1: [
        { info: { role: "user" }, parts: [{ type: "text", text: "go" }] },
        {
          info: { role: "assistant" },
          parts: [
            { type: "text", text: "done" },
            { type: "tool", state: { output: "x".repeat(9000) } },
          ],
        },
      ],
    })
    const res = await read("/api/opencode/session/w1/message")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      info?: { role?: string }
      parts?: { type: string; state?: { output?: string } }[]
    }[]
    expect(body).toHaveLength(2)
    expect(body[0]?.info?.role).toBe("user")
    const tool = body[1]?.parts?.find((part) => part.type === "tool")
    expect(tool?.state?.output).toContain("[truncated —")
    const upstream = calls.find((call) =>
      call.url.endsWith("/session/w1/message"),
    )
    expect(upstream).toBeDefined()
  })

  test("read pages with limit/before and never forwards them upstream", async () => {
    installManageFetch({
      w1: Array.from({ length: 6 }, (_, i) => ({
        info: { id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant" },
        parts: [{ type: "text", text: `t${i}` }],
      })),
    })
    const tail = await read("/api/opencode/session/w1/message?limit=2")
    expect(tail.status).toBe(200)
    const tailBody = (await tail.json()) as {
      messages: { info: { id: string } }[]
      total: number
      hasMore: boolean
      nextBefore: string | null
      startUserCount: number
    }
    expect(tailBody.messages.map((row) => row.info.id)).toEqual(["m4", "m5"])
    expect(tailBody.total).toBe(6)
    expect(tailBody.hasMore).toBe(true)
    expect(tailBody.nextBefore).toBe("m4")
    expect(tailBody.startUserCount).toBe(2)
    const older = await read(
      "/api/opencode/session/w1/message?limit=2&before=m4",
    )
    const olderBody = (await older.json()) as {
      messages: { info: { id: string } }[]
      nextBefore: string | null
    }
    expect(olderBody.messages.map((row) => row.info.id)).toEqual(["m2", "m3"])
    expect(olderBody.nextBefore).toBe("m2")
    const stale = await read("/api/opencode/session/w1/message?before=gone")
    expect(stale.status).toBe(400)
    expect(
      calls
        .filter((call) => call.url.includes("/message"))
        .every((call) => !call.url.includes("limit=")),
    ).toBe(true)
  })

  test("read refuses plain chats, cron jobs, and unknown ids", async () => {
    installManageFetch()
    expect((await read("/api/opencode/session/u1/message")).status).toBe(403)
    expect((await read("/api/opencode/session/c1/message")).status).toBe(403)
    expect((await read("/api/opencode/session/missing/message")).status).toBe(
      404,
    )
  })

  test("read allows a persona-bound thread and reports upstream failures", async () => {
    installManageFetch({
      p1: [{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] }],
    })
    const ok = await read("/api/opencode/session/p1/message")
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as unknown[]).length).toBe(1)
    const bad = await read("/api/opencode/session/w1/message")
    expect(bad.status).toBe(502)
  })

  test("isOpencodeReadRequest matches only the agent message read", () => {
    expect(
      isOpencodeReadRequest("/api/opencode/session/s1/message", "GET"),
    ).toBe(true)
    expect(
      isOpencodeReadRequest("/api/opencode/session/s1/message", "POST"),
    ).toBe(false)
    expect(isOpencodeReadRequest("/api/opencode/session/s1", "GET")).toBe(false)
    expect(
      isOpencodeReadRequest("/api/opencode/session/s1/prompt", "GET"),
    ).toBe(false)
    expect(isOpencodeReadRequest("/api/opencode/session", "GET")).toBe(false)
  })
})
