import { describe, expect, test } from "bun:test"
import {
  buildAlerts,
  buildChecklist,
  checklistComplete,
  formatFrAgo,
  formatFrWhen,
  type JobLike,
  parseRecentThreads,
  pickUpcomingJobs,
} from "./dashboard-data"

const HOUR = 3_600_000

describe("parseRecentThreads", () => {
  test("keeps valid rows, capped at five", () => {
    const body = {
      threads: Array.from({ length: 8 }, (_, i) => ({
        sessionId: `s${i}`,
        title: `T${i}`,
        createdAt: 1000 + i,
      })),
    }
    const out = parseRecentThreads(body)
    expect(out.length).toBe(5)
    expect(out[0].sessionId).toBe("s0")
  })

  test("drops malformed rows instead of crashing", () => {
    expect(
      parseRecentThreads({
        threads: [
          { sessionId: "ok", title: "t", createdAt: 1 },
          { sessionId: 42, title: "t", createdAt: 1 },
          { sessionId: "x" },
          "junk",
        ],
      }),
    ).toEqual([{ sessionId: "ok", title: "t", createdAt: 1 }])
  })

  test("a wrong-shaped body is an error, never a silent empty list", () => {
    expect(() => parseRecentThreads({ nope: true })).toThrow()
    expect(() => parseRecentThreads(null)).toThrow()
  })
})

describe("pickUpcomingJobs", () => {
  const job = (over: Partial<JobLike>): JobLike => ({
    id: "j",
    name: "Job",
    enabled: true,
    nextRunAt: null,
    lastError: null,
    ...over,
  })

  test("only enabled jobs with a real next run, soonest first, capped", () => {
    const jobs: JobLike[] = [
      job({ id: "b", nextRunAt: 2000 }),
      job({ id: "a", nextRunAt: 1000 }),
      job({ id: "paused", enabled: false, nextRunAt: 500 }),
      job({ id: "none", nextRunAt: null }),
      job({ id: "plugin", plugin: { id: "p", name: "P" }, nextRunAt: 300 }),
      job({ id: "c", nextRunAt: 1500 }),
      job({ id: "d", nextRunAt: 4000 }),
    ]
    const out = pickUpcomingJobs(jobs, 3)
    expect(out.map((item) => item.id)).toEqual(["a", "c", "b"])
  })
})

describe("checklist", () => {
  test("team-ready accounts pass the model step without a personal key", () => {
    const steps = buildChecklist({ hasModel: true, hasThreads: false })
    expect(checklistComplete(steps)).toBe(false)
    expect(steps[0].done).toBe(true)
  })
  test("only the optional app step left open still counts as complete", () => {
    const steps = buildChecklist({ hasModel: true, hasThreads: true })
    expect(checklistComplete(steps)).toBe(true)
  })
  test("a fresh account has both required steps open", () => {
    const steps = buildChecklist({ hasModel: false, hasThreads: false })
    expect(checklistComplete(steps)).toBe(false)
    expect(steps.filter((step) => !step.optional).length).toBe(2)
  })
})

describe("buildAlerts", () => {
  test("server-reported failures become actionable alerts, capped at three", () => {
    const alerts = buildAlerts({
      desktopError: "docker died",
      failedJobs: [
        { id: "1", name: "Veille marché", lastError: "timeout" },
        { id: "2", name: "Rapport", lastError: "crash" },
        { id: "3", name: "Autre", lastError: "x" },
      ],
    })
    expect(alerts.length).toBe(3)
    expect(alerts[0].actionPath).toBe("/chat")
    expect(alerts[1].actionPath).toBe("/automations")
  })

  test("a blocking quota is an error alert pointing at settings", () => {
    const alerts = buildAlerts({
      quota: {
        limitTokens: 100,
        used: 200,
        over: true,
        behavior: "block",
      },
      failedJobs: [],
    })
    expect(alerts.length).toBe(1)
    expect(alerts[0].severity).toBe("error")
    expect(alerts[0].actionPath).toBe("/config")
  })

  test("healthy inputs produce no decorative alerts", () => {
    expect(buildAlerts({ failedJobs: [] })).toEqual([])
  })
})

describe("fr-CA time labels", () => {
  test("formatFrAgo reads recent past in minutes and hours", () => {
    const now = 1_000_000_000
    expect(formatFrAgo(now - 30_000, now)).toMatch(/instant|maintenance|minute/)
    expect(formatFrAgo(now - 5 * 60_000, now)).toMatch(/minute/)
    expect(formatFrAgo(now - 3 * HOUR, now)).toMatch(/heure/)
  })
  test("formatFrWhen names the timezone abbreviation", () => {
    const text = formatFrWhen(new Date("2026-10-19T09:00:00Z").getTime())
    expect(text).toMatch(/\(.+\)/)
  })
  test("formatFrWhen handles the null next run", () => {
    expect(formatFrWhen(null)).toBe("—")
  })
})
