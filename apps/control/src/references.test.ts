import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CronJob, openDatabase } from "@open-bot/db"
import {
  extractReferences,
  matchRefItem,
  type RefItem,
  refSections,
  resolveReferenceLine,
} from "./references"

function memoryDb() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function cronRow(overrides: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    userId: "u",
    name: "Morning news",
    message: "brief me",
    kind: "every",
    cronExpr: null,
    everySeconds: 3600,
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
    runKind: "prompt",
    script: null,
    ...overrides,
  }
}

describe("extract references", () => {
  test("finds tokens with section and trimmed query", () => {
    expect(extractReferences("update @personas/Work wife please")).toEqual([
      { section: "personas", query: "Work wife please" },
    ])
  })

  test("finds several and lowercases the section", () => {
    const tokens = extractReferences("@PERSONAS/Al and @cron/Daily run")
    expect(tokens.map((token) => token.section)).toEqual(["personas", "cron"])
    expect(tokens[1]?.query).toBe("Daily run")
  })

  test("ignores emails and unknown sections and empty queries", () => {
    expect(extractReferences("mail me@personas/x or @skills/")).toEqual([])
    expect(extractReferences("@nope/thing")).toEqual([])
  })

  test("requires a word boundary before the at sign", () => {
    expect(extractReferences("word@cron/Daily")).toEqual([])
    expect(extractReferences("start of line\n@cron/Daily")).toEqual([
      { section: "cron", query: "Daily" },
    ])
  })
})

describe("match ref item", () => {
  const items: RefItem[] = [
    { id: "1", name: "Work wife", detail: "", hint: "" },
    { id: "2", name: "daily news", detail: "", hint: "" },
    { id: "3", name: "Designer", detail: "", hint: "" },
  ]

  test("exact match is case-insensitive", () => {
    expect(matchRefItem(items, "daily NEWS")?.status).toBe("found")
    expect(matchRefItem(items, "daily news")).toMatchObject({
      status: "found",
      item: { id: "2" },
    })
  })

  test("unique prefix completes a typed fragment", () => {
    expect(matchRefItem(items, "work")).toMatchObject({
      status: "found",
      item: { id: "1" },
    })
  })

  test("several prefixes are ambiguous", () => {
    const clash: RefItem[] = [
      { id: "1", name: "Work wife", detail: "", hint: "" },
      { id: "4", name: "Workout plan", detail: "", hint: "" },
    ]
    const match = matchRefItem(clash, "work")
    expect(match.status).toBe("ambiguous")
  })

  test("a full name followed by prose resolves by longest boundary match", () => {
    expect(matchRefItem(items, "Work wife, please fix it")).toMatchObject({
      status: "found",
      item: { id: "1" },
    })
  })

  test("unknown names are missing", () => {
    expect(matchRefItem(items, "nosuch").status).toBe("missing")
    expect(matchRefItem(items, "  ").status).toBe("missing")
  })
})

describe("resolve reference line", () => {
  test("no references gives an empty line", async () => {
    const db = memoryDb()
    expect(await resolveReferenceLine(db, { id: "u" } as never, "hello")).toBe(
      "",
    )
  })

  test("resolves custom personas with their id and cli hint", async () => {
    const db = memoryDb()
    db.createPersona({
      id: "p-1",
      userId: "u",
      name: "Chef",
      instruction: "cook simply",
      createdAt: 0,
    })
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "update @personas/Chef",
    )
    expect(line).toContain('persona "Chef" (id p-1)')
    expect(line).toContain("ob-persona update p-1")
    expect(line).toContain("Message references:")
  })

  test("built-in personas are reference only", async () => {
    const db = memoryDb()
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@personas/Designer look",
    )
    expect(line).toContain("reference only")
  })

  test("cron jobs resolve with schedule detail", async () => {
    const db = memoryDb()
    db.createCronJob(
      cronRow({ userId: "u", id: "job-9", name: "Morning news" }),
    )
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@cron/morning news status",
    )
    expect(line).toContain('cron job "Morning news" (id job-9)')
    expect(line).toContain("enabled, every 3600s")
    expect(line).toContain("ob-cron (job id job-9)")
  })

  test("missing and ambiguous names tell the agent", async () => {
    const db = memoryDb()
    db.createPersona({
      id: "p-1",
      userId: "u",
      name: "Work wife",
      instruction: "x",
      createdAt: 0,
    })
    db.createPersona({
      id: "p-2",
      userId: "u",
      name: "Workout plan",
      instruction: "y",
      createdAt: 1,
    })
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@personas/Nosuch and @personas/work",
    )
    expect(line).toContain('no persona named "Nosuch"')
    expect(line).toContain("ambiguous")
    expect(line).toContain("Work wife, Workout plan")
  })

  test("unknown skills report missing without a desktop record", async () => {
    const db = memoryDb()
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@skills/weather",
    )
    expect(line).toContain('no skill named "weather"')
  })

  test("projects resolve with their directory path", async () => {
    const db = memoryDb()
    db.createProject({
      id: "pr-1",
      userId: "u",
      name: "My App",
      path: "/home/agent/workspace/my-app",
      createdAt: 0,
    })
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "work in @projects/my app today",
    )
    expect(line).toContain('project "My App" (id pr-1)')
    expect(line).toContain("/home/agent/workspace/my-app")
  })

  test("a failing section list reports unavailable", async () => {
    const db = memoryDb()
    const original = refSections.skills
    refSections.skills = {
      items: async () => {
        throw new Error("down")
      },
    }
    try {
      const line = await resolveReferenceLine(
        db,
        { id: "u" } as never,
        "@skills/weather",
      )
      expect(line).toContain("list is unavailable")
    } finally {
      refSections.skills = original
    }
  })

  test("duplicate tokens resolve once", async () => {
    const db = memoryDb()
    db.createPersona({
      id: "p-1",
      userId: "u",
      name: "Chef",
      instruction: "cook",
      createdAt: 0,
    })
    const line = await resolveReferenceLine(
      db,
      { id: "u" } as never,
      "@personas/Chef and again @personas/Chef",
    )
    expect(line.match(/id p-1/g)?.length).toBe(1)
  })
})
