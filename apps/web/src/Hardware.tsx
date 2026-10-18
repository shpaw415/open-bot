import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { ChartView } from "./ChartView"
import { MemoryIcon, RefreshIcon } from "./icons"
import Stack from "./stack"

type DesktopSample = {
  at: number
  diskUsed: number
  diskTotal: number
  memUsed: number
  memMax: number
  cpuPercent: number
  cpuMaxPercent: number
}

type HardwareStats = {
  phase: "starting" | "running" | "sleeping"
  sample: DesktopSample | null
  diskMaxBytes: number | null
  history: DesktopSample[]
}

const POLL_MS = 10_000

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(0, Math.round(value / 1024))} KB`
}

function formatClock(at: number) {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`
}

function meterColor(percent: number) {
  if (percent >= 90) return "#b3261e"
  if (percent >= 80) return "#9a6c00"
  return "#6750a4"
}

function Meter({
  label,
  percent,
  caption,
}: {
  label: string
  percent: number
  caption: string
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color = meterColor(clamped)
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 200 }}>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {label}
        </Typography>
        <Typography variant="subtitle1">{clamped.toFixed(0)}%</Typography>
      </Stack>
      <Box
        sx={{
          mt: 1,
          height: 8,
          borderRadius: 4,
          bgcolor: "rgba(127,127,127,0.28)",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${clamped}%`,
            borderRadius: 4,
            bgcolor: color,
            transition: "width 0.4s ease, bgcolor 0.4s ease",
          }}
        />
      </Box>
      <Typography variant="caption" color="textSecondary">
        {caption}
      </Typography>
    </Paper>
  )
}

function historyOption(history: DesktopSample[], theme: { text: string }) {
  const labels = history.map((sample) => formatClock(sample.at))
  const axis = {
    axisLabel: { color: theme.text },
    axisLine: { lineStyle: { color: "rgba(127,127,127,0.28)" } },
    splitLine: { lineStyle: { color: "rgba(127,127,127,0.28)" } },
  }
  const series = (name: string, pick: (sample: DesktopSample) => number) => ({
    name,
    type: "line",
    smooth: true,
    showSymbol: false,
    areaStyle: { opacity: 0.15 },
    data: history.map(pick),
  })
  return {
    color: ["#6750a4", "#006a6a", "#8b5000"],
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: theme.text }, top: 0 },
    grid: { left: 40, right: 12, top: 36, bottom: 28 },
    xAxis: { type: "category", data: labels, ...axis },
    yAxis: { type: "value", max: 100, ...axis },
    series: [
      series("Disk %", (sample) => {
        const max = sample.diskTotal || 1
        return Math.min(100, (sample.diskUsed / max) * 100)
      }),
      series("RAM %", (sample) => {
        const max = sample.memMax || 1
        return Math.min(100, (sample.memUsed / max) * 100)
      }),
      series("CPU %", (sample) => {
        const max = sample.cpuMaxPercent || 100
        return Math.min(100, (sample.cpuPercent / max) * 100)
      }),
    ],
  }
}

export function Hardware() {
  const [stats, setStats] = useState<HardwareStats | null>(null)
  const [error, setError] = useState("")
  const themeRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<{ text: string }>({
    text: "#1c1b1f",
  })

  const load = useCallback(() => {
    api<HardwareStats>("/api/hardware")
      .then((body) => {
        setStats(body)
        setError("")
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    const el = themeRef.current
    if (!el) return
    const color = getComputedStyle(el).color
    if (color) setTheme({ text: color })
  }, [])

  const sample = stats?.sample ?? null
  const diskMax = stats?.diskMaxBytes ?? sample?.diskTotal ?? 0
  const diskPercent =
    sample && diskMax > 0 ? (sample.diskUsed / diskMax) * 100 : 0
  const memPercent =
    sample && sample.memMax > 0 ? (sample.memUsed / sample.memMax) * 100 : 0
  const cpuPercent =
    sample && sample.cpuMaxPercent > 0
      ? (sample.cpuPercent / sample.cpuMaxPercent) * 100
      : 0
  const cpus = sample ? sample.cpuMaxPercent / 100 : 0
  const updated = stats?.history.at(-1)?.at ?? sample?.at ?? 0

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, overflowY: "auto", minHeight: 0 }}>
      <div ref={themeRef}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MemoryIcon />
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Hardware
          </Typography>
          <IconButton size="small" onClick={load} aria-label="refresh">
            <RefreshIcon />
          </IconButton>
        </Stack>
      </div>
      <Typography variant="caption" color="textSecondary">
        Live disk, memory, and processor usage for this desktop container. Disk
        is what this desktop wrote: its writable layer plus the /home/agent and
        /usr/local volumes — not the whole host drive. Sampled every 30 seconds;
        history resets when the control plane restarts.
        {updated > 0 ? ` Last sample ${formatClock(updated)}.` : ""}
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {stats === null ? (
        <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
          <CircularProgress size={1.5} />
        </Box>
      ) : sample === null ? (
        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
          {stats.phase === "starting"
            ? "The desktop is starting — numbers appear in a few seconds."
            : "The desktop is asleep. No hardware numbers yet."}
        </Typography>
      ) : (
        <>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: "wrap", rowGap: 1 }}
          >
            <Meter
              label="Disk"
              percent={diskPercent}
              caption={
                diskMax > 0
                  ? `${formatBytes(sample.diskUsed)} of ${formatBytes(diskMax)}`
                  : `${formatBytes(sample.diskUsed)} used by this desktop`
              }
            />
            <Meter
              label="RAM"
              percent={memPercent}
              caption={`${formatBytes(sample.memUsed)} of ${formatBytes(sample.memMax)}`}
            />
            <Meter
              label="Processor"
              percent={cpuPercent}
              caption={`${(sample.cpuPercent / 100).toFixed(2)} cores of ${cpus}`}
            />
          </Stack>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2">Last 30 minutes</Typography>
            {stats.history.length < 2 ? (
              <Typography variant="caption" color="textSecondary">
                Collecting history — the chart fills in as samples arrive.
              </Typography>
            ) : (
              <ChartView
                option={historyOption(stats.history, theme)}
                height={240}
              />
            )}
          </Paper>
        </>
      )}
    </Stack>
  )
}
