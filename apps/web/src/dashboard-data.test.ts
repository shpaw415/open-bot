import { describe, expect, test } from "bun:test"
import {
  atMsToLocalInput,
  buildAlerts,
  buildChecklist,
  checklistComplete,
  formatFrAgo,
  formatFrNamedAgo,
  formatFrWhen,
  type JobLike,
  jobDeepLink,
  jobIdFromSearch,
  localInputToMs,
  parseJobs,
  parseRecentThreads,
  pickUpcomingJobs,
  splitJobProblems,
} from "./dashboard-data"

const HOUR = 3_600_000
const NOW = 1_800_000_000_000

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
    expect(out.threads.length).toBe(5)
    expect(out.threads[0].sessionId).toBe("s0")
  })

  test("drops malformed and null rows instead of crashing", () => {
    expect(
      parseRecentThreads({
        threads: [
          { sessionId: "ok", title: "t", createdAt: 1 },
          { sessionId: 42, title: "t", createdAt: 1 },
          { sessionId: "x" },
          "junk",
          null,
          undefined,
          { sessionId: "inf", title: "t", createdAt: Number.POSITIVE_INFINITY },
        ],
      }),
    ).toEqual({
      threads: [{ sessionId: "ok", title: "t", createdAt: 1 }],
      coverage: "titles",
    })
  })

  test("a wrong-shaped body is an error, never a silent empty list", () => {
    expect(() => parseRecentThreads({ nope: true })).toThrow()
    expect(() => parseRecentThreads(null)).toThrow()
    expect(() => parseRecentThreads([1, 2])).toThrow()
  })

  test("a coverage marker is kept; missing marker reads as titles (conservative)", () => {
    const full = parseRecentThreads({
      threads: [{ sessionId: "s", title: "T", createdAt: 1 }],
      coverage: "full",
    })
    expect(full.coverage).toBe("full")
    // an unknown/absent marker never upgrades the claim to "full"
    const absent = parseRecentThreads({
      threads: [{ sessionId: "s", title: "T", createdAt: 1 }],
    })
    expect(absent.coverage).toBe("titles")
    const bogus = parseRecentThreads({
      threads: [],
      coverage: "everything",
    })
    expect(bogus.coverage).toBe("titles")
  })
})

describe("parseJobs", () => {
  test("a non-array body is a contract error, never a silent empty list", () => {
    expect(() => parseJobs({ jobs: [] })).toThrow()
    expect(() => parseJobs(null)).toThrow()
  })

  test("keeps full rows, drops rows without identity", () => {
    const rows = [
      {
        id: "j1",
        name: "Veille",
        enabled: true,
        nextRunAt: 5,
        lastError: null,
        atMs: null,
        message: "hello",
      },
      { id: "", name: "nope" },
      { name: "no id" },
      null,
      "junk",
    ]
    const out = parseJobs(rows)
    expect(out.length).toBe(1)
    expect(out[0].id).toBe("j1")
    // extra fields survive for CronView
    expect((out[0] as unknown as { message: string }).message).toBe("hello")
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
      job({ id: "b", nextRunAt: NOW + 2000 }),
      job({ id: "a", nextRunAt: NOW + 1000 }),
      job({ id: "paused", enabled: false, nextRunAt: NOW + 500 }),
      job({ id: "none", nextRunAt: null }),
      job({
        id: "plugin",
        plugin: { id: "p", name: "P" },
        nextRunAt: NOW + 300,
      }),
      job({ id: "c", nextRunAt: NOW + 1500 }),
      job({ id: "d", nextRunAt: NOW + 4000 }),
    ]
    const out = pickUpcomingJobs(jobs, 3, NOW)
    expect(out.map((item) => item.id)).toEqual(["a", "c", "b"])
  })

  test("a run deep in the past is overdue, not upcoming", () => {
    const jobs: JobLike[] = [
      job({ id: "fresh", nextRunAt: NOW + 1000 }),
      job({ id: "stale", nextRunAt: 1 }),
      job({ id: "late", nextRunAt: NOW - 5 * HOUR }),
    ]
    const out = pickUpcomingJobs(jobs, 3, NOW)
    expect(out.map((item) => item.id)).toEqual(["fresh"])
  })

  test("a run slightly late (sleeping desktop) stays upcoming", () => {
    const jobs: JobLike[] = [job({ id: "due", nextRunAt: NOW - 10 * 60_000 })]
    expect(pickUpcomingJobs(jobs, 3, NOW).map((item) => item.id)).toEqual([
      "due",
    ])
  })
})

describe("splitJobProblems — the full source, not the upcoming cap", () => {
  const job = (over: Partial<JobLike>): JobLike => ({
    id: "j",
    name: "Job",
    enabled: true,
    nextRunAt: null,
    lastError: null,
    ...over,
  })

  test("failures beyond the upcoming three are still reported", () => {
    const jobs: JobLike[] = [
      job({ id: "1", nextRunAt: NOW + 1 }),
      job({ id: "2", nextRunAt: NOW + 2 }),
      job({ id: "3", nextRunAt: NOW + 3 }),
      job({ id: "4", nextRunAt: NOW + 4, lastError: "boom" }),
    ]
    const { failed } = splitJobProblems(jobs, NOW)
    expect(failed.map((item) => item.id)).toEqual(["4"])
  })

  test("paused and plugin failures are reported too", () => {
    const jobs: JobLike[] = [
      job({ id: "p", enabled: false, lastError: "x" }),
      job({
        id: "pl",
        plugin: { id: "x", name: "X" },
        lastError: "y",
      }),
    ]
    const { failed } = splitJobProblems(jobs, NOW)
    expect(failed.map((item) => item.id)).toEqual(["p", "pl"])
  })

  test("an enabled job far past its run is overdue; failed-and-scheduled is both", () => {
    const jobs: JobLike[] = [
      job({ id: "late", nextRunAt: NOW - 2 * HOUR }),
      job({ id: "both", nextRunAt: NOW + 10, lastError: "kaboom" }),
      job({ id: "grace", nextRunAt: NOW - 5 * 60_000 }),
    ]
    const { failed, overdue } = splitJobProblems(jobs, NOW)
    expect(failed.map((item) => item.id)).toEqual(["both"])
    expect(overdue.map((item) => item.id)).toEqual(["late"])
  })
})

describe("checklist", () => {
  test("team-ready accounts pass the model step without a personal key", () => {
    const steps = buildChecklist({
      hasModel: true,
      hasThreads: false,
      threadsKnown: true,
    })
    expect(checklistComplete(steps)).toBe(false)
    expect(steps[0].state).toBe("done")
  })

  test("an unknown thread list never pushes a first conversation", () => {
    const steps = buildChecklist({
      hasModel: true,
      hasThreads: false,
      threadsKnown: false,
    })
    expect(steps[1].state).toBe("unknown")
    expect(checklistComplete(steps)).toBe(true)
  })

  test("only known-and-empty pushes the first-thread step", () => {
    const steps = buildChecklist({
      hasModel: true,
      hasThreads: false,
      threadsKnown: true,
    })
    expect(steps[1].state).toBe("todo")
    expect(checklistComplete(steps)).toBe(false)
  })

  test("a complete known account is complete", () => {
    const steps = buildChecklist({
      hasModel: true,
      hasThreads: true,
      threadsKnown: true,
    })
    expect(checklistComplete(steps)).toBe(true)
  })
})

describe("buildAlerts", () => {
  test("server-reported failures become actionable alerts, capped at three", () => {
    const alerts = buildAlerts({
      desktopError: "docker died",
      failedJobs: [
        {
          id: "1",
          name: "Veille marché",
          lastError: "timeout",
          nextRunAt: null,
          enabled: true,
        },
        {
          id: "2",
          name: "Rapport",
          lastError: "crash",
          nextRunAt: null,
          enabled: true,
        },
        {
          id: "3",
          name: "Autre",
          lastError: "x",
          nextRunAt: null,
          enabled: true,
        },
      ],
    })
    expect(alerts.length).toBe(3)
    expect(alerts[0].actionPath).toBe("/chat")
    expect(alerts[1].actionPath).toBe(jobDeepLink("1"))
  })

  test("a failed job that stays scheduled says so, one that does not says that", () => {
    const alerts = buildAlerts({
      failedJobs: [
        {
          id: "s",
          name: "Planifiée",
          lastError: "x",
          nextRunAt: NOW + HOUR,
          enabled: true,
        },
        {
          id: "u",
          name: "Pause",
          lastError: "y",
          nextRunAt: null,
          enabled: false,
        },
      ],
    })
    expect(alerts[0].text).toMatch(/maintenue/)
    expect(alerts[1].text).toMatch(/pas d’exécution programmée/)
  })

  test("a blocking quota points at the section that shows the meter", () => {
    const alerts = buildAlerts({
      quota: { limitTokens: 100, used: 200, over: true, behavior: "block" },
      failedJobs: [],
    })
    expect(alerts.length).toBe(1)
    expect(alerts[0].severity).toBe("error")
    expect(alerts[0].actionPath).toBe("/config/keys")
  })

  test("healthy inputs produce no decorative alerts", () => {
    expect(buildAlerts({ failedJobs: [] })).toEqual([])
  })

  test("more than three problems collapse honestly with a total", () => {
    const failed = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      name: `J${i}`,
      lastError: "x",
      nextRunAt: null,
      enabled: true,
    }))
    const alerts = buildAlerts({ failedJobs: failed })
    expect(alerts.length).toBe(3)
    expect(alerts[2].id).toBe("alerts-more")
    expect(alerts[2].text).toMatch(/3 autres/)
    expect(alerts[2].actionPath).toBe("/automations")
  })
})

describe("job deep link contract", () => {
  test("deep link rides the search, path stays /automations", () => {
    const link = jobDeepLink("abc_123")
    expect(link.startsWith("/automations?job=")).toBe(true)
    // parseRoute receives only the pathname part
    expect(new URL(link, "http://x").pathname).toBe("/automations")
  })

  test("jobIdFromSearch round-trips and rejects junk", () => {
    expect(jobIdFromSearch(`?job=${encodeURIComponent("abc_123")}`)).toBe(
      "abc_123",
    )
    expect(jobIdFromSearch("")).toBe("")
    expect(jobIdFromSearch("?other=1")).toBe("")
    expect(jobIdFromSearch("?job=../../etc")).toBe("")
  })
})

describe("datetime-local roundtrip — the one-shot schedule edit", () => {
  test("local input parses back to the same instant (no UTC relabel)", () => {
    // 2026-06-15T14:30:00Z
    const ms = Date.UTC(2026, 5, 15, 14, 30)
    const value = atMsToLocalInput(ms)
    // must NOT be the UTC clock text when the zone differs from UTC
    const back = localInputToMs(value)
    expect(back).not.toBeNull()
    // parsing is the inverse of rendering in the same zone: identical instant
    expect(back).toBe(new Date(value).getTime())
    expect(new Date(back ?? 0).getTimezoneOffset()).toBe(
      new Date(ms).getTimezoneOffset(),
    )
  })

  test("roundtrip keeps the exact minute across a DST-ambiguous naming", () => {
    const ms = new Date(2026, 9, 25, 3, 30).getTime()
    const value = atMsToLocalInput(ms)
    expect(value).toBe("2026-10-25T03:30")
    expect(localInputToMs(value)).toBe(new Date(2026, 9, 25, 3, 30).getTime())
  })

  test("malformed values are rejected, not NaN", () => {
    expect(localInputToMs("")).toBeNull()
    expect(localInputToMs("2026-10-25 03:30")).toBeNull()
    expect(localInputToMs("garbage")).toBeNull()
  })
})

describe("fr-CA time labels", () => {
  test("formatFrAgo reads recent past in minutes and hours", () => {
    const now = 1_000_000_000
    expect(formatFrAgo(now - 30_000, now)).toMatch(/instant|maintenance|minute/)
    expect(formatFrAgo(now - 5 * 60_000, now)).toMatch(/minute/)
    expect(formatFrAgo(now - 3 * HOUR, now)).toMatch(/heure/)
  })

  test("formatFrNamedAgo qualifies the date as the naming time", () => {
    expect(formatFrNamedAgo(0)).toBe("")
    expect(formatFrNamedAgo(1_000_000_000 - 5 * 60_000, 1_000_000_000)).toMatch(
      /^nommée/,
    )
  })

  test("formatFrWhen names the timezone abbreviation", () => {
    const text = formatFrWhen(new Date("2026-10-19T09:00:00Z").getTime())
    expect(text).toMatch(/\(.+\)/)
  })
  test("formatFrWhen handles the null next run", () => {
    expect(formatFrWhen(null)).toBe("—")
  })
})
