import { afterEach, describe, expect, mock, test } from "bun:test"
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
  setThreadPersona: () => {},
} as unknown as Db

function personaDb(bound: string[][]) {
  return {
    desktop: (id: string) =>
      id === "user-1" ? { opencodePassword: "pw" } : null,
    personas: (userId: string) =>
      userId === "user-1"
        ? [{ id: "p1", name: "Software manager", instruction: "run the team" }]
        : [],
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
    expect(isThreadRequest("/api/threads", "DELETE")).toBe(false)
    expect(isThreadRequest("/api/threads/s1", "GET")).toBe(false)
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
      new Request("http://control/api/threads", { method: "DELETE" }),
      new URL("http://control/api/threads"),
      db,
      agent,
    )
    expect(res.status).toBe(404)
  })
})
