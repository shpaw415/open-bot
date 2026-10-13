import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Desktop } from "@open-bot/db"
import { pendingRestart, restartOpencode } from "./docker"
import * as shellModule from "./shell"

const shCalls: string[][] = []
const shResult = { code: 0, stdout: "", stderr: "" }
mock.module("./shell", () => ({
  ...shellModule,
  docker: async () => "",
  sh: async (args: string[]) => {
    shCalls.push(args)
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
