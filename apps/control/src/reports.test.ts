import { describe, expect, test } from "bun:test"
import {
  isReportKind,
  isReportStatus,
  type PluginReport,
  parseReportList,
  setReportStatus,
  summarizeByPlugin,
} from "./reports"

function row(overrides: Partial<PluginReport>): PluginReport {
  return {
    id: "abc123",
    plugin: "weather-pro",
    kind: "bug",
    title: "crashes",
    detail: "d",
    session: null,
    status: "open",
    note: null,
    hits: 1,
    createdAt: 100,
    lastSeenAt: 100,
    ...overrides,
  }
}

describe("parse report list", () => {
  test("parses JSONL and sorts newest first", () => {
    const text = [
      JSON.stringify(row({ id: "old", lastSeenAt: 10 })),
      JSON.stringify(row({ id: "new", lastSeenAt: 20 })),
    ].join("\n")
    const parsed = parseReportList(text)
    expect(parsed.map((item) => item.id)).toEqual(["new", "old"])
  })

  test("skips malformed and incomplete lines", () => {
    const text = [
      "not json",
      JSON.stringify({ id: "x" }),
      JSON.stringify(row({ id: "bad kind", kind: "nope" })),
      JSON.stringify(row({ id: "bad status", status: "archived" })),
      JSON.stringify(row({ id: "", plugin: "" })),
      JSON.stringify(row({ id: "ok" })),
      "",
    ].join("\n")
    const parsed = parseReportList(text)
    expect(parsed.map((item) => item.id)).toEqual(["ok"])
  })

  test("dedupes by id and requires the core fields", () => {
    const text = [
      JSON.stringify(row({ id: "dup" })),
      JSON.stringify(row({ id: "dup", hits: 5 })),
      JSON.stringify({ id: "sparse", plugin: "p", kind: "bug", title: "t" }),
    ].join("\n")
    const parsed = parseReportList(text)
    expect(parsed.map((item) => item.id)).toEqual(["dup"])
    expect(parsed[0]?.hits).toBe(1)
  })

  test("empty output gives no rows", () => {
    expect(parseReportList("")).toEqual([])
  })
})

describe("summarize by plugin", () => {
  test("counts open and total per plugin, sorted by name", () => {
    const reports = [
      row({ id: "1", plugin: "beta", status: "open" }),
      row({ id: "2", plugin: "beta", status: "done" }),
      row({ id: "3", plugin: "alpha", status: "wontfix" }),
      row({ id: "4", plugin: "alpha", status: "open" }),
    ]
    expect(summarizeByPlugin(reports)).toEqual([
      { plugin: "alpha", open: 1, total: 2 },
      { plugin: "beta", open: 1, total: 2 },
    ])
  })

  test("no reports gives no summaries", () => {
    expect(summarizeByPlugin([])).toEqual([])
  })
})

describe("validation", () => {
  test("statuses and kinds", () => {
    expect(isReportStatus("open")).toBe(true)
    expect(isReportStatus("all")).toBe(false)
    expect(isReportKind("friction")).toBe(true)
    expect(isReportKind("enhancement")).toBe(false)
  })

  test("bad report id throws before any exec", async () => {
    expect(
      setReportStatus("user", "../../escape", "done").catch(
        (error: { status?: number }) => error.status,
      ),
    ).resolves.toBe(400)
  })
})
