// Pure derivation from a parsed OpenViking observer table (columns/rows come
// from the control plane's parseStatusTable) into echarts options and table
// shapes. No React, no fetch — fully unit-testable.

export type VikingComponentHealth = {
  name: string
  healthy: boolean
  hasErrors: boolean
  status: string
  columns: string[]
  rows: string[][]
}

export type ChartTheme = { text: string }

const PALETTE = ["#6750a4", "#006a6a", "#8b5000", "#b3261e"]

export function toNumber(cell: string | undefined): number | null {
  if (!cell) return null
  const value = Number(cell.replace(/[, ]/g, ""))
  return Number.isFinite(value) ? value : null
}

export function isTotalRow(row: string[]): boolean {
  const first = (row[0] ?? "").trim()
  return first.toUpperCase() === "TOTAL" || first === "总览"
}

function columnIndex(columns: string[], matcher: (name: string) => boolean) {
  return columns.findIndex(matcher)
}

function columnIndexMatching(columns: string[], needle: string) {
  return columnIndex(columns, (name) =>
    name.toLowerCase().includes(needle.toLowerCase()),
  )
}

/** Rows padded/truncated to the column count so tables render rectangular. */
export function paddedRows(
  component: Pick<VikingComponentHealth, "columns" | "rows">,
): string[][] {
  const width = Math.max(1, component.columns.length)
  return component.rows.map((row) => {
    const cells = row.slice(0, width)
    while (cells.length < width) cells.push("")
    return cells
  })
}

/** Numeric (non-category) columns: every non-TOTAL row parses as a number. */
export function numericColumnIndexes(
  component: VikingComponentHealth,
): number[] {
  const rows = component.rows.filter((row) => !isTotalRow(row))
  const source = rows.length ? rows : component.rows
  const indexes: number[] = []
  for (let index = 1; index < component.columns.length; index += 1) {
    if (source.length && source.every((row) => toNumber(row[index]) !== null)) {
      indexes.push(index)
    }
  }
  return indexes
}

const AXIS_BASE = (theme: ChartTheme) => ({
  axisLabel: { color: theme.text, fontSize: 11 },
  axisLine: { lineStyle: { color: "rgba(127,127,127,0.4)" } },
  splitLine: { lineStyle: { color: "rgba(127,127,127,0.22)" } },
})

// VikingDB: one horizontal bar per collection sized by its vector count
// (Index Count as a second series when present). TOTAL is excluded — it
// dwarfs the per-collection bars it sums.
export function vikingdbChartOption(
  component: VikingComponentHealth,
  theme: ChartTheme,
): object | null {
  if (!component.columns.length || !component.rows.length) return null
  const vectorIndex = columnIndexMatching(component.columns, "vector")
  const vectorCol =
    vectorIndex >= 1 ? vectorIndex : (numericColumnIndexes(component)[0] ?? -1)
  if (vectorCol < 1) return null
  const indexCol = columnIndexMatching(component.columns, "index")
  const rows = component.rows.filter((row) => !isTotalRow(row))
  const source = rows.length ? rows : component.rows
  const categories = source.map((row) => row[0] ?? "")
  const series = [
    {
      name: component.columns[vectorCol],
      type: "bar" as const,
      data: source.map((row) => toNumber(row[vectorCol]) ?? 0),
      barMaxWidth: 22,
      itemStyle: { borderRadius: 3 },
    },
  ]
  if (indexCol >= 1 && indexCol !== vectorCol) {
    series.push({
      name: component.columns[indexCol],
      type: "bar" as const,
      data: source.map((row) => toNumber(row[indexCol]) ?? 0),
      barMaxWidth: 22,
      itemStyle: { borderRadius: 3 },
    })
  }
  return {
    color: PALETTE,
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { textStyle: { color: theme.text, fontSize: 11 }, top: 0 },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      minInterval: 1,
      ...AXIS_BASE(theme),
      splitLine: { show: true, lineStyle: { color: "rgba(127,127,127,0.22)" } },
    },
    yAxis: {
      type: "category",
      data: categories,
      ...AXIS_BASE(theme),
      splitLine: { show: false },
    },
    series,
  }
}

// Queue: grouped bars per queue across Pending / In Progress / Processed /
// Errors (whichever of those columns exist). TOTAL excluded.
export function queueChartOption(
  component: VikingComponentHealth,
  theme: ChartTheme,
): object | null {
  if (!component.columns.length || !component.rows.length) return null
  const wanted = ["pending", "in progress", "processed", "requeued", "errors"]
  const seriesCols = wanted
    .map((needle) => columnIndexMatching(component.columns, needle))
    .filter((index) => index >= 1)
  if (!seriesCols.length) return null
  const rows = component.rows.filter((row) => !isTotalRow(row))
  const source = rows.length ? rows : component.rows
  return {
    color: PALETTE,
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { textStyle: { color: theme.text, fontSize: 11 }, top: 0 },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: source.map((row) => row[0] ?? ""),
      ...AXIS_BASE(theme),
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      ...AXIS_BASE(theme),
    },
    series: seriesCols.map((index) => ({
      name: component.columns[index],
      type: "bar" as const,
      data: source.map((row) => toNumber(row[index]) ?? 0),
      barMaxWidth: 18,
      itemStyle: { borderRadius: 3 },
    })),
  }
}

/** Cell-level sentiment coloring for OK/yes-style status cells. */
export function cellTone(cell: string): "success" | "error" | null {
  const value = cell.trim().toLowerCase()
  if (["ok", "yes", "healthy", "true", "active"].includes(value))
    return "success"
  if (
    ["no", "error", "errors", "fail", "failed", "false", "down"].includes(value)
  )
    return "error"
  return null
}

export type VikingHealthBody = {
  status: "healthy" | "unhealthy" | "up" | "down" | "asleep" | "starting"
  detail: string
  errors: string[]
  components: VikingComponentHealth[]
  checkedAt: number
}

const HEALTH_STATUSES = new Set([
  "healthy",
  "unhealthy",
  "up",
  "down",
  "asleep",
  "starting",
])

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// Normalizes whatever /api/viking/health returned into the shape the UI
// reads. The dashboard shell and the control plane deploy on different
// schedules (dashboard-only deploys, cached shells, an older control behind
// a new web bundle), so a partial body must degrade to empty data — never a
// TypeError on `.length` mid-render.
export function normalizeVikingHealthBody(
  body: unknown,
): VikingHealthBody | null {
  if (!body || typeof body !== "object") return null
  const raw = body as Record<string, unknown>
  const errors = Array.isArray(raw.errors)
    ? raw.errors.filter((line): line is string => typeof line === "string")
    : []
  const components: VikingComponentHealth[] = Array.isArray(raw.components)
    ? raw.components
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
        )
        .map((entry) => ({
          name: str(entry.name) || "component",
          healthy: entry.healthy === true,
          hasErrors: entry.hasErrors === true,
          status: str(entry.status),
          columns: Array.isArray(entry.columns)
            ? entry.columns.filter(
                (cell): cell is string => typeof cell === "string",
              )
            : [],
          rows: Array.isArray(entry.rows)
            ? entry.rows.filter(
                (row): row is string[] =>
                  Array.isArray(row) &&
                  row.every((cell) => typeof cell === "string"),
              )
            : [],
        }))
    : []
  const checkedAt =
    typeof raw.checkedAt === "number" && Number.isFinite(raw.checkedAt)
      ? raw.checkedAt
      : Date.now()
  const status = raw.status
  return {
    status:
      typeof status === "string" && HEALTH_STATUSES.has(status)
        ? (status as VikingHealthBody["status"])
        : "up",
    detail: str(raw.detail),
    errors,
    components,
    checkedAt,
  }
}
