import { describe, expect, test } from "bun:test"
import {
  type CronJobInfo,
  cronScheduleLabel,
  everySecondsFrom,
  filterCronJobs,
  intervalFromSeconds,
  intervalLabel,
  isGuardJob,
  partitionGuardJobs,
} from "./CronView"

describe("intervalLabel — real French, no 'les 1'", () => {
  test("singular and plural units", () => {
    expect(intervalLabel(3600)).toBe("Toutes les heures")
    expect(intervalLabel(7200)).toBe("Toutes les 2 heures")
    expect(intervalLabel(86_400)).toBe("Tous les jours")
    expect(intervalLabel(172_800)).toBe("Tous les 2 jours")
    expect(intervalLabel(1800)).toBe("Toutes les 30 minutes")
  })
  test("odd seconds stay honest", () => {
    expect(intervalLabel(90)).toBe("Toutes les 90 secondes")
  })
})

const job = (over: Partial<CronJobInfo>): CronJobInfo => ({
  id: "j",
  name: "Veille",
  message: "saluer",
  kind: "every",
  cronExpr: null,
  everySeconds: 3600,
  atMs: null,
  enabled: true,
  sessionId: null,
  createdAt: 0,
  lastRunAt: null,
  nextRunAt: null,
  runCount: 0,
  lastError: null,
  providerId: null,
  modelId: null,
  personaId: null,
  ...over,
})

describe("everySecondsFrom — bounded simple-interval conversion", () => {
  test("value × unit becomes server seconds", () => {
    expect(everySecondsFrom("2", "hours")).toBe(7200)
    expect(everySecondsFrom("30", "minutes")).toBe(1800)
    expect(everySecondsFrom("1", "days")).toBe(86_400)
  })
  test("below one minute or above one year is refused, not clamped silently", () => {
    expect(everySecondsFrom("0.5", "minutes")).toBeNull()
    expect(everySecondsFrom("0", "hours")).toBeNull()
    expect(everySecondsFrom("400", "days")).toBeNull()
    expect(everySecondsFrom("abc", "hours")).toBeNull()
  })
})

describe("intervalFromSeconds — honest reverse mapping", () => {
  test("whole minutes/hours/days map back", () => {
    expect(intervalFromSeconds(86_400)).toEqual({ value: "1", unit: "days" })
    expect(intervalFromSeconds(5400)).toEqual({ value: "90", unit: "minutes" })
  })
  test("odd seconds have no simple representation", () => {
    expect(intervalFromSeconds(90)).toBeNull()
  })
})

describe("cronScheduleLabel — the truth about time", () => {
  test("intervals read as durations in French", () => {
    expect(cronScheduleLabel(job({ everySeconds: 3600 }))).toBe(
      "Toutes les heures",
    )
  })
  test("cron says UTC explicitly", () => {
    expect(
      cronScheduleLabel(job({ kind: "cron", cronExpr: "0 9 * * *" })),
    ).toBe("Expression cron (UTC) : 0 9 * * *")
  })
  test("one-time runs name date and zone", () => {
    const label = cronScheduleLabel(
      job({ kind: "at", atMs: Date.parse("2026-11-01T14:00:00Z") }),
    )
    expect(label).toMatch(/^Une seule fois, le \d+/)
    expect(label).toMatch(/\(/)
  })
})

describe("filterCronJobs — the automations search field", () => {
  const jobs = [
    job({ id: "a", name: "Résumé du matin", message: "Résume mes courriels" }),
    job({
      id: "b",
      name: "Veille prix",
      message: "Surveille les billets",
      runKind: "script",
      script: "curl https://example.com/prix",
    }),
    job({
      id: "c",
      name: "plugin:stock:Suivi bourse",
      message: "Cours du jour",
      kind: "cron",
      cronExpr: "0 9 * * 1-5",
      plugin: { id: "stock", name: "Stock" },
    }),
  ]
  const ids = (list: CronJobInfo[]) => list.map((item) => item.id)

  test("an empty or blank query keeps every job, in order", () => {
    expect(ids(filterCronJobs(jobs, ""))).toEqual(["a", "b", "c"])
    expect(ids(filterCronJobs(jobs, "  "))).toEqual(["a", "b", "c"])
  })

  test("matches name and instruction, accents and case ignored", () => {
    expect(ids(filterCronJobs(jobs, "resume"))).toEqual(["a"])
    expect(ids(filterCronJobs(jobs, "BILLETS"))).toEqual(["b"])
  })

  test("matches the script, the cron expression and the plugin name", () => {
    expect(ids(filterCronJobs(jobs, "curl"))).toEqual(["b"])
    expect(ids(filterCronJobs(jobs, "1-5"))).toEqual(["c"])
    expect(ids(filterCronJobs(jobs, "stock"))).toEqual(["c"])
  })

  test("no match gives an empty list", () => {
    expect(filterCronJobs(jobs, "introuvable")).toEqual([])
  })
})

describe("guard grouping — plugin:<id>:guard under one collapsible", () => {
  test("isGuardJob follows the control plane's GUARD_JOB_RE contract", () => {
    expect(isGuardJob(job({ name: "plugin:weather-pro:guard" }))).toBe(true)
    expect(isGuardJob(job({ name: "plugin:stock:guard" }))).toBe(true)
    // Other plugin jobs and user jobs that merely mention a guard stay out.
    expect(isGuardJob(job({ name: "plugin:weather-pro:Suivi bourse" }))).toBe(
      false,
    )
    expect(isGuardJob(job({ name: "plugin:guard" }))).toBe(false)
    expect(isGuardJob(job({ name: "Veille guard" }))).toBe(false)
    expect(isGuardJob(job({ name: "Résumé du matin" }))).toBe(false)
  })

  test("partition keeps each side in loaded order, guards together", () => {
    const jobs = [
      job({ id: "g1", name: "plugin:weather-pro:guard" }),
      job({ id: "a", name: "Résumé du matin" }),
      job({ id: "g2", name: "plugin:stock:guard" }),
      job({ id: "b", name: "Veille prix" }),
    ]
    const { regular, guards } = partitionGuardJobs(jobs)
    expect(regular.map((item) => item.id)).toEqual(["a", "b"])
    expect(guards.map((item) => item.id)).toEqual(["g1", "g2"])
  })

  test("no guards (or nothing but guards) partitions cleanly", () => {
    expect(partitionGuardJobs([job({ id: "a" })]).guards).toEqual([])
    expect(
      partitionGuardJobs([job({ id: "g1", name: "plugin:weather-pro:guard" })])
        .regular,
    ).toEqual([])
    expect(partitionGuardJobs([])).toEqual({ regular: [], guards: [] })
  })
})
