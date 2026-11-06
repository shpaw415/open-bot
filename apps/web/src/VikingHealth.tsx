import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Divider from "@shpaw415/mui-lite/Divider"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { ChartView } from "./ChartView"
import { ConfigSection, type ConfigStatus } from "./ConfigSection"
import { Chip } from "./chip"
import { MemoryIcon, RefreshIcon } from "./icons"
import Stack from "./stack"
import {
  cellTone,
  isTotalRow,
  normalizeVikingHealthBody,
  paddedRows,
  queueChartOption,
  vikingdbChartOption,
  type VikingComponentHealth,
  type VikingHealthBody,
} from "./viking-health-data"

const STATUS_META: Record<
  VikingHealthBody["status"],
  { label: string; color?: ConfigStatus["color"] }
> = {
  healthy: { label: "Healthy", color: "success" },
  unhealthy: { label: "Unhealthy", color: "error" },
  up: { label: "Running — limited", color: "warning" },
  down: { label: "Unreachable", color: "error" },
  asleep: { label: "Asleep" },
  starting: { label: "Starting", color: "warning" },
}

const TONE_COLOR: Record<"success" | "error", string> = {
  success: "#2e7d32",
  error: "#b3261e",
}

function formatTime(at: number) {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
}

function componentChartOption(
  component: VikingComponentHealth,
  theme: { text: string },
) {
  if (component.name === "vikingdb")
    return vikingdbChartOption(component, theme)
  if (component.name === "queue") return queueChartOption(component, theme)
  return null
}

function ComponentPanel({ component }: { component: VikingComponentHealth }) {
  const rows = paddedRows(component)
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {component.name}
        </Typography>
        <Chip
          size="small"
          color={
            component.healthy
              ? "success"
              : component.hasErrors
                ? "error"
                : "warning"
          }
        >
          {component.healthy
            ? "Healthy"
            : component.hasErrors
              ? "Errors"
              : "Check"}
        </Chip>
      </Stack>
      {rows.length && component.columns.length > 1 ? (
        <Box sx={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {component.columns.map((column) => (
                  <th
                    key={column}
                    style={{
                      textAlign: "left",
                      padding: "4px 10px 4px 0",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const total = isTotalRow(row)
                const rowId = row.join("\u{0}")
                return (
                  <tr key={rowId}>
                    {row.map((cell, index) => {
                      const tone = cellTone(cell)
                      const key = `${component.columns[index] ?? "col"}`
                      return (
                        <td
                          key={`${key}:${cell}`}
                          style={{
                            padding: "3px 10px 3px 0",
                            whiteSpace: index === 0 ? "nowrap" : "normal",
                            fontWeight: total ? 600 : 400,
                            color:
                              tone && index > 0 ? TONE_COLOR[tone] : undefined,
                          }}
                        >
                          {cell}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Box>
      ) : component.status ? (
        // Not a table (free-form detail, "..." placeholder): the full raw
        // text, wrapped and scrollable — never clipped.
        <Box
          sx={{
            maxWidth: "100%",
            maxHeight: 320,
            overflow: "auto",
            bgcolor: "rgba(127,127,127,0.08)",
            borderRadius: 1,
            p: 1,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontFamily: "var(--font-mono, monospace)",
              display: "block",
            }}
          >
            {component.status}
          </Typography>
        </Box>
      ) : (
        <Typography variant="caption" color="textSecondary">
          no detail reported
        </Typography>
      )}
    </Stack>
  )
}

export function VikingHealth() {
  const [health, setHealth] = useState<VikingHealthBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const alive = useRef(true)
  const themeRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<{ text: string }>({ text: "#1c1b1f" })

  const check = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      // Normalize at the boundary: a partial body (older control plane,
      // dashboard-only deploy) degrades to empty data instead of crashing
      // on `.length` mid-render.
      const body = normalizeVikingHealthBody(
        await api<unknown>("/api/viking/health"),
      )
      if (alive.current) setHealth(body)
    } catch (caught: unknown) {
      if (alive.current) {
        setError(
          caught instanceof Error ? caught.message : "health check failed",
        )
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void check()
    return () => {
      alive.current = false
    }
  }, [check])

  // Chart text color follows the page theme, exactly like Hardware's chart
  // (probed once at mount — the hidden div's color is theme-driven, not
  // data-driven).
  useEffect(() => {
    const el = themeRef.current
    if (!el) return
    const color = getComputedStyle(el).color
    if (color) setTheme({ text: color })
  }, [])

  const meta = health ? STATUS_META[health.status] : null
  const healthyCount = health
    ? health.components.filter((component) => component.healthy).length
    : 0
  const charted = health
    ? health.components
        .map((component) => ({
          component,
          option: componentChartOption(component, theme),
        }))
        .filter(
          (entry): entry is {
            component: VikingComponentHealth
            option: object
          } => entry.option !== null,
        )
    : []

  return (
    <ConfigSection
      icon={<MemoryIcon fontSize="small" />}
      title="OpenViking health"
      description="Live status of this user's OpenViking memory instance — a passive check that never wakes a sleeping desktop."
      status={
        loading && !health
          ? null
          : meta
            ? { label: meta.label, color: meta.color }
            : null
      }
    >
      {/* Theme probe for chart text color */}
      <div
        ref={themeRef}
        style={{ position: "absolute", visibility: "hidden" }}
      >
        t
      </div>
      <Stack spacing={1.25}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {health?.detail ? (
          <Typography variant="body2" color="textSecondary">
            {health.detail}
          </Typography>
        ) : null}
        {health?.errors.length ? (
          <Alert severity="error">
            <Stack spacing={0.5}>
              {health.errors.map((line) => (
                <Typography key={line} variant="body2">
                  {line}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}
        {health && health.components.length > 1 ? (
          <Typography variant="body2" color="textSecondary">
            {healthyCount}/{health.components.length} components healthy
          </Typography>
        ) : null}
        {charted.length ? (
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
            {charted.map(({ component, option }) => (
              <Box
                key={component.name}
                data-chart={component.name}
                sx={{ flex: "1 1 300px", minWidth: 260 }}
              >
                <Typography variant="caption" color="textSecondary">
                  {component.name}
                </Typography>
                <ChartView option={option} height={190} />
              </Box>
            ))}
          </Stack>
        ) : null}
        {health?.components.length ? (
          <Stack spacing={2} divider={<Divider />}>
            {health.components.map((component) => (
              <ComponentPanel key={component.name} component={component} />
            ))}
          </Stack>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            disabled={loading}
            onClick={() => void check()}
            startIcon={<RefreshIcon />}
          >
            {loading ? "Checking…" : "Check again"}
          </Button>
          {health ? (
            <Typography variant="caption" color="textSecondary">
              checked at {formatTime(health.checkedAt)}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
