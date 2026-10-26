import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Desktop } from "@open-bot/db"
import {
  captureOpencodeAuth,
  pendingRestart,
  restartOpencode,
  syncOpencodeAuth,
} from "./docker"
import * as shellModule from "./shell"

const shCalls: string[][] = []
const shInputs: (string | undefined)[] = []
const shResult = { code: 0, stdout: "", stderr: "" }
mock.module("./shell", () => ({
  ...shellModule,
  docker: async () => "",
  sh: async (args: string[], input?: string) => {
    // docker.ts's isRunning probes the container through sh — answer it so
    // capture/sync reach the code under test.
    if (args.includes("inspect")) {
      return { code: 0, stdout: "true\n", stderr: "" }
    }
    shCalls.push(args)
    shInputs.push(input)
    return shResult
  },
}))

beforeEach(() => {
  shCalls.length = 0
})

const desktop = { opencodePassword: "secret" } as Desktop
const pkillCount = () => shCalls.filter((args) => args.includes("pkill")).length

type HubEvent = { type: string }
const fakeHub = (events: HubEvent[]) => ({
  emit: (_userId: string, event: HubEvent) => {
    events.push(event)
  },
})

describe("restartOpencode", () => {
  test("kills immediately when the desktop is idle", async () => {
    await restartOpencode("u-idle", {
      desktop,
      busy: async () => false,
      serving: async () => true,
    })
    expect(pkillCount()).toBe(1)
    expect(pendingRestart("u-idle")).toBeUndefined()
  })

  test("defers while busy and kills once idle, without blocking the caller", async () => {
    const busyCounts: number[] = []
    await restartOpencode("u-defer", {
      desktop,
      pollMs: 2,
      busy: async () => {
        busyCounts.push(1)
        return busyCounts.length <= 3
      },
      serving: async () => true,
    })
    // the caller is back before the restart fired
    expect(pkillCount()).toBe(0)
    const run = pendingRestart("u-defer")
    expect(run).toBeDefined()
    await run
    expect(pkillCount()).toBe(1)
    expect(pendingRestart("u-defer")).toBeUndefined()
  })

  test("coalesces concurrent requests into one restart", async () => {
    const busyCounts: number[] = []
    const busyFour = async () => {
      busyCounts.push(1)
      return busyCounts.length <= 4
    }
    void restartOpencode("u-coalesce", {
      desktop,
      pollMs: 2,
      busy: busyFour,
      serving: async () => true,
    })
    await restartOpencode("u-coalesce", {
      desktop,
      pollMs: 2,
      busy: async () => true,
      serving: async () => true,
    })
    // both callers are back and exactly one poller is pending
    expect(pkillCount()).toBe(0)
    const run = pendingRestart("u-coalesce")
    expect(run).toBeDefined()
    await run
    expect(pkillCount()).toBe(1)
    // once idle again, a fresh request kills immediately
    await restartOpencode("u-coalesce", {
      desktop,
      busy: async () => false,
      serving: async () => true,
    })
    expect(pkillCount()).toBe(2)
  })

  test("gives up waiting at the deadline and kills anyway", async () => {
    const events: HubEvent[] = []
    await restartOpencode("u-deadline", {
      desktop,
      hub: fakeHub(events) as never,
      maxWaitMs: 15,
      pollMs: 5,
      busy: async () => true,
      serving: async () => true,
    })
    const run = pendingRestart("u-deadline")
    await run
    expect(pkillCount()).toBe(1)
    expect(events.map((event) => event.type)).toEqual([
      "opencode.restart.pending",
      "opencode.restart.forced",
    ])
  })

  test("skips the kill when the server stopped serving on its own", async () => {
    const busyCounts: number[] = []
    await restartOpencode("u-down", {
      desktop,
      pollMs: 2,
      busy: async () => {
        busyCounts.push(1)
        return busyCounts.length <= 2
      },
      serving: async () => false,
    })
    await pendingRestart("u-down")
    expect(pkillCount()).toBe(0)
  })

  test("force kills right away even while busy", async () => {
    await restartOpencode("u-force", {
      desktop,
      force: true,
      busy: async () => true,
      serving: async () => true,
    })
    expect(pkillCount()).toBe(1)
    expect(pendingRestart("u-force")).toBeUndefined()
  })
})

// Shared OpenCode provider auth (team mode): capture and fan-out shell
// wrappers. These live here because this file owns the ./shell mock that the
// shared docker module binds to in the full-suite run order.
describe("opencode auth capture and sync", () => {
  test("capture reads the auth file once the container answers running", async () => {
    shResult.code = 0
    shResult.stdout = JSON.stringify({ zai: { type: "api", key: "k" } })
    shResult.stderr = ""
    const auth = await captureOpencodeAuth("u1")
    expect(auth).toEqual({ zai: { type: "api", key: "k" } })
    expect(shCalls.at(-1)?.includes("cat")).toBe(true)
  })

  test("capture skips the container when it is not running", async () => {
    shResult.code = 1
    shResult.stdout = ""
    expect(await captureOpencodeAuth("u1")).toBeNull()
  })

  test("sync pipes the entries payload and parses changed ids", async () => {
    shResult.code = 0
    shResult.stdout = '{"changed":["zai"]}'
    shResult.stderr = ""
    const result = await syncOpencodeAuth("u1", { zai: { type: "api" } })
    expect(result).toEqual({ changed: ["zai"] })
    expect(
      shCalls.at(-1)?.some((arg) => arg.endsWith("apply-opencode-auth.sh")),
    ).toBe(true)
    expect(JSON.parse(shInputs.at(-1) ?? "{}")).toEqual({
      entries: { zai: { type: "api" } },
    })
  })

  test("sync names the missing image script", async () => {
    shResult.code = 127
    shResult.stdout = ""
    shResult.stderr = "sh: /opt/open-bot/apply-opencode-auth.sh: not found"
    expect(syncOpencodeAuth("u1", { zai: { type: "api" } })).rejects.toThrow(
      /missing opencode auth setup/,
    )
    shResult.stdout = ""
    shResult.stderr = ""
  })
})
