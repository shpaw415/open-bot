import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { CronJob, Db } from "@open-bot/db"
import * as dockerModule from "./docker"

let phase = "running"

// Spread the real module: mock.module leaks into later files of the same run,
// so every export must stay present (plugins-apply destructures these).
mock.module("./docker", () => ({
  ...dockerModule,
  desktopPhase: async () => phase,
  endpoint: async () => "http://opencode:4096",
  opencodeScript: () => {
    throw new Error("not mocked")
  },
  startDesktop: async () => {
    throw new Error("not mocked")
  },
}))

const {
  cleanupGuardSharedThread,
  ensureGuardDeliveryThread,
  GUARD_JOB_RE,
  GUARD_THREAD_TITLE,
} = await import("./cron")

function job(partial: Partial<CronJob>): CronJob {
  return {
    id: "j",
    userId: "u",
    name: "plugin:weather-pro:guard",
    message: "m",
    kind: "every",
    cronExpr: null,
    everySeconds: 86_400,
    atMs: null,
    enabled: true,
    deleteAfterRun: false,
    sessionId: null,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    lastError: null,
    providerId: null,
    modelId: null,
    personaId: null,
    runKind: "auto",
    script: null,
    ...partial,
  }
}

const originalFetch = globalThis.fetch
let live = new Set<string>()
let calls: { url: string; init?: RequestInit }[] = []

function installFetch() {
  globalThis.fetch = (async (input, options) => {
    const url = String(input)
    calls.push({ url, init: options })
    const path = new URL(url).pathname
    const method = options?.method ?? "GET"
    if (method === "POST" && path === "/session") {
      const id = `s-new-${calls.length}`
      live.add(id)
      return Response.json({ id })
    }
    if (
      path.startsWith("/session/") &&
      (method === "PATCH" || method === "DELETE")
    ) {
      if (method === "DELETE") live.delete(path.slice("/session/".length))
      return Response.json({ ok: true })
    }
    if (path.startsWith("/session/")) {
      const id = path.slice("/session/".length)
      return live.has(id)
        ? Response.json({ id })
        : Response.json({ error: "not found" }, { status: 404 })
    }
    return Response.json({ error: "not found" }, { status: 404 })
  }) as typeof fetch
}

function guardDb(jobs: CronJob[], updates: string[][] = []) {
  return {
    cronJobs: () => jobs,
    setCronSession: (id: string, sessionId: string) => {
      updates.push([id, sessionId])
    },
    userById: () => ({ disabled: false }),
    desktop: () => ({ opencodePassword: "pw" }),
    clearThreadScreen: () => {},
  } as unknown as Db
}

const headers = {
  authorization: "Basic dw==",
  "content-type": "application/json",
}

beforeEach(() => {
  live = new Set()
  calls = []
  phase = "running"
  installFetch()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("guard shared delivery thread", () => {
  test("adopts the newest live guard thread, renames it, deletes leftovers", async () => {
    live = new Set(["s-old-1", "s-old-2"])
    const jobs = [
      job({ id: "j1", sessionId: "s-old-1", createdAt: 1 }),
      job({ id: "j2", sessionId: "s-old-2", createdAt: 5 }),
      job({ id: "j3", sessionId: null, createdAt: 9 }),
    ]
    const updates: string[][] = []
    const sid = await ensureGuardDeliveryThread(
      guardDb(jobs, updates),
      "u",
      "http://opencode:4096",
      headers,
    )
    expect(sid).toBe("s-old-2")
    const patch = calls.find((call) => call.init?.method === "PATCH")
    expect(patch?.url).toBe("http://opencode:4096/session/s-old-2")
    expect(JSON.parse(String(patch?.init?.body)).title).toBe(GUARD_THREAD_TITLE)
    expect(
      calls.some(
        (call) =>
          call.init?.method === "DELETE" && call.url.endsWith("/s-old-1"),
      ),
    ).toBe(true)
    expect(live.has("s-old-1")).toBe(false)
    expect(updates).toEqual([
      ["j1", "s-old-2"],
      ["j3", "s-old-2"],
    ])
  })

  test("creates the shared thread when no guard session is live", async () => {
    const jobs = [job({ id: "j1", sessionId: "s-dead", createdAt: 1 })]
    const updates: string[][] = []
    const sid = await ensureGuardDeliveryThread(
      guardDb(jobs, updates),
      "u",
      "http://opencode:4096",
      headers,
    )
    expect(live.has(sid)).toBe(true)
    expect(updates).toEqual([["j1", sid]])
    expect(
      calls.some(
        (call) =>
          call.init?.method === "POST" &&
          new URL(call.url).pathname === "/session",
      ),
    ).toBe(true)
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(false)
  })

  test("leaves non-guard jobs and their threads untouched", async () => {
    live = new Set(["s-old-1", "plain"])
    const jobs = [
      job({ id: "j1", sessionId: "s-old-1", createdAt: 1 }),
      job({ id: "jn", name: "nightly", sessionId: "plain", createdAt: 2 }),
    ]
    const updates: string[][] = []
    const sid = await ensureGuardDeliveryThread(
      guardDb(jobs, updates),
      "u",
      "http://opencode:4096",
      headers,
    )
    expect(sid).toBe("s-old-1")
    expect(live.has("plain")).toBe(true)
    expect(calls.some((call) => call.url.endsWith("/plain"))).toBe(false)
    expect(updates).toEqual([])
  })

  test("GUARD_JOB_RE matches guard names only", () => {
    expect(GUARD_JOB_RE.test("plugin:weather-pro:guard")).toBe(true)
    expect(GUARD_JOB_RE.test("plugin:weather-pro:other")).toBe(false)
    expect(GUARD_JOB_RE.test("nightly")).toBe(false)
  })
})

describe("cleanupGuardSharedThread", () => {
  test("deletes the shared thread when the last guard job is gone", async () => {
    live = new Set(["s-shared"])
    await cleanupGuardSharedThread(guardDb([]), "u", ["s-shared", ""])
    expect(
      calls.some(
        (call) =>
          call.init?.method === "DELETE" && call.url.endsWith("/s-shared"),
      ),
    ).toBe(true)
    expect(live.has("s-shared")).toBe(false)
  })

  test("keeps the thread while other guard jobs remain", async () => {
    live = new Set(["s-shared"])
    await cleanupGuardSharedThread(guardDb([job({ id: "j1" })]), "u", [
      "s-shared",
    ])
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(false)
  })

  test("skips silently when the desktop is not running", async () => {
    phase = "sleeping"
    await cleanupGuardSharedThread(guardDb([]), "u", ["s-shared"])
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(false)
  })
})
