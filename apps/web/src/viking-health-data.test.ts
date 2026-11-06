import { describe, expect, test } from "bun:test"
import {
  cellTone,
  isTotalRow,
  normalizeVikingHealthBody,
  numericColumnIndexes,
  paddedRows,
  queueChartOption,
  toNumber,
  vikingdbChartOption,
  type VikingComponentHealth,
} from "./viking-health-data"

const THEME = { text: "#1c1b1f" }

function component(
  partial: Partial<VikingComponentHealth>,
): VikingComponentHealth {
  return {
    name: "test",
    healthy: true,
    hasErrors: false,
    status: "",
    columns: [],
    rows: [],
    ...partial,
  }
}

const QUEUE = component({
  name: "queue",
  columns: ["Queue", "Pending", "In Progress", "Processed", "Errors", "Total"],
  rows: [
    ["Embedding", "0", "0", "10", "0", "10"],
    ["Semantic", "1", "2", "10", "3", "16"],
    ["TOTAL", "1", "2", "20", "3", "26"],
  ],
})

const VIKINGDB = component({
  name: "vikingdb",
  columns: ["Collection", "Index Count", "Vector Count", "Status"],
  rows: [
    ["context", "1", "55", "OK"],
    ["projects", "2", "1,204", "OK"],
    ["TOTAL", "3", "1,259"],
  ],
})

describe("toNumber", () => {
  test("parses plain and comma-separated numbers, rejects text", () => {
    expect(toNumber("42")).toBe(42)
    expect(toNumber("1,204")).toBe(1204)
    expect(toNumber(" 7 ")).toBe(7)
    expect(toNumber("OK")).toBeNull()
    expect(toNumber("")).toBeNull()
    expect(toNumber(undefined)).toBeNull()
  })
})

describe("isTotalRow", () => {
  test("matches TOTAL in any case, not collection names", () => {
    expect(isTotalRow(["TOTAL", "3"])).toBe(true)
    expect(isTotalRow(["total", "3"])).toBe(true)
    expect(isTotalRow(["context", "1"])).toBe(false)
  })
})

describe("paddedRows", () => {
  test("pads short rows and trims long ones to the column count", () => {
    const rows = paddedRows({
      columns: ["A", "B", "C"],
      rows: [
        ["one", "two"],
        ["one", "two", "three", "four"],
      ],
    })
    expect(rows).toEqual([
      ["one", "two", ""],
      ["one", "two", "three"],
    ])
  })
})

describe("numericColumnIndexes", () => {
  test("finds fully numeric non-category columns, skips Status", () => {
    expect(numericColumnIndexes(QUEUE)).toEqual([1, 2, 3, 4, 5])
    expect(numericColumnIndexes(VIKINGDB)).toEqual([1, 2])
  })

  test("falls back to TOTAL rows when only TOTAL exists", () => {
    const only = component({
      columns: ["A", "B"],
      rows: [["TOTAL", "5"]],
    })
    expect(numericColumnIndexes(only)).toEqual([1])
  })
})

describe("vikingdbChartOption", () => {
  test("bars per collection by vector count, TOTAL excluded, commas parsed", () => {
    const option = vikingdbChartOption(VIKINGDB, THEME) as {
      yAxis: { data: string[] }
      series: { name: string; data: number[] }[]
    }
    expect(option.yAxis.data).toEqual(["context", "projects"])
    const vectors = option.series.find((s) => s.name === "Vector Count")
    expect(vectors?.data).toEqual([55, 1204])
    expect(option.series.some((s) => s.name === "Index Count")).toBe(true)
  })

  test("null when there is nothing chartable", () => {
    expect(
      vikingdbChartOption(component({ name: "vikingdb" }), THEME),
    ).toBeNull()
    expect(
      vikingdbChartOption(
        component({ name: "vikingdb", columns: ["A"], rows: [["x"]] }),
        THEME,
      ),
    ).toBeNull()
  })
})

describe("queueChartOption", () => {
  test("groups Pending/In Progress/Processed/Errors per queue, TOTAL excluded", () => {
    const option = queueChartOption(QUEUE, THEME) as {
      xAxis: { data: string[] }
      series: { name: string; data: number[] }[]
    }
    expect(option.xAxis.data).toEqual(["Embedding", "Semantic"])
    expect(option.series.map((s) => s.name)).toEqual([
      "Pending",
      "In Progress",
      "Processed",
      "Errors",
    ])
    const errors = option.series.find((s) => s.name === "Errors")
    expect(errors?.data).toEqual([0, 3])
  })

  test("null without the queue columns", () => {
    expect(
      queueChartOption(
        component({
          name: "queue",
          columns: ["A", "B"],
          rows: [["x", "1"]],
        }),
        THEME,
      ),
    ).toBeNull()
  })
})

describe("cellTone", () => {
  test("green for ok/yes, red for no/fail, null otherwise", () => {
    expect(cellTone("OK")).toBe("success")
    expect(cellTone(" yes ")).toBe("success")
    expect(cellTone("no")).toBe("error")
    expect(cellTone("failed")).toBe("error")
    expect(cellTone("55")).toBeNull()
    expect(cellTone("timeout")).toBeNull()
  })
})

describe("normalizeVikingHealthBody", () => {
  test("passes a well-formed body through untouched", () => {
    const body = normalizeVikingHealthBody({
      status: "healthy",
      detail: "",
      errors: ["a"],
      checkedAt: 123,
      components: [
        {
          name: "queue",
          healthy: true,
          hasErrors: false,
          status: "A  B\n1  2",
          columns: ["A", "B"],
          rows: [["1", "2"]],
        },
      ],
    })
    expect(body).toEqual({
      status: "healthy",
      detail: "",
      errors: ["a"],
      checkedAt: 123,
      components: [
        {
          name: "queue",
          healthy: true,
          hasErrors: false,
          status: "A  B\n1  2",
          columns: ["A", "B"],
          rows: [["1", "2"]],
        },
      ],
    })
  })

  test("fills every gap — the crash regression (reading .length on undefined)", () => {
    // The exact first-deploy shape: no columns/rows at all.
    const legacy = normalizeVikingHealthBody({
      status: "healthy",
      detail: undefined,
      errors: undefined,
      components: [
        { name: "queue", healthy: true, hasErrors: false, status: "A  B" },
        { name: undefined, is_healthy: "yes" },
      ],
      checkedAt: undefined,
    })
    expect(legacy).not.toBeNull()
    expect(legacy?.errors).toEqual([])
    expect(legacy?.detail).toBe("")
    expect(Number.isFinite(legacy?.checkedAt)).toBe(true)
    expect(legacy?.components).toHaveLength(2)
    expect(legacy?.components[0]?.columns).toEqual([])
    expect(legacy?.components[0]?.rows).toEqual([])
    expect(legacy?.components[1]?.name).toBe("component")
    // Reading these never throws, whichever fields were missing.
    expect(legacy?.components.filter((c) => c.columns.length > 1)).toEqual([])
  })

  test("an empty or non-object body is null; unknown status falls back to up", () => {
    expect(normalizeVikingHealthBody(null)).toBeNull()
    expect(normalizeVikingHealthBody("ok")).toBeNull()
    expect(normalizeVikingHealthBody({})?.status).toBe("up")
    expect(normalizeVikingHealthBody({ status: "weird" })?.status).toBe("up")
  })

  test("drops malformed rows and non-string cells instead of crashing", () => {
    const body = normalizeVikingHealthBody({
      status: "healthy",
      components: [
        {
          name: "t",
          healthy: true,
          hasErrors: false,
          status: "",
          columns: ["A", 7, null],
          rows: [["1", "2"], ["3"], "not-a-row", [4, "5"]],
        },
      ],
      errors: ["keep", 42, null],
    })
    expect(body?.errors).toEqual(["keep"])
    expect(body?.components[0]?.columns).toEqual(["A"])
    expect(body?.components[0]?.rows).toEqual([["1", "2"], ["3"]])
  })
})
