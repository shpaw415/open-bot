import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { Chip } from "./chip"
import type { EventStream } from "./hooks"
import { useEventStream } from "./hooks"
import {
  BugReportIcon,
  ChevronDownIcon,
  ContentCopyIcon,
  RefreshIcon,
} from "./icons"
import Stack from "./stack"

type ReportStatus = "open" | "done" | "wontfix"

type PluginReport = {
  id: string
  plugin: string
  kind: string
  title: string
  detail: string
  session: string | null
  status: ReportStatus
  note: string | null
  hits: number
  createdAt: number
  lastSeenAt: number
}

type ReportSummary = {
  plugin: string
  open: number
  total: number
}

const KIND_COLOR: Record<string, "primary" | "error" | "warning" | "success"> =
  {
    bug: "error",
    friction: "warning",
    feature: "success",
  }

function formatAgo(ts: number) {
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const h = Math.round(minutes / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function Reports({
  subscribe,
}: {
  subscribe?: EventStream["subscribe"]
}) {
  const [reports, setReports] = useState<PluginReport[] | null>(null)
  const [plugins, setPlugins] = useState<ReportSummary[]>([])
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("open")
  const [pluginFilter, setPluginFilter] = useState("")
  const [expandedId, setExpandedId] = useState("")
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState("")
  const [copied, setCopied] = useState("")

  // Standalone mounts (Config tab) attach to the shared event stream directly;
  // Workspace keeps passing its own subscribe so nothing changes there.
  const { subscribe: streamSubscribe } = useEventStream(true)
  const stream = subscribe ?? streamSubscribe

  const load = useCallback(() => {
    api<{ reports: PluginReport[]; plugins: ReportSummary[] }>(
      "/api/reports?status=all",
    )
      .then((body) => {
        setReports(body.reports ?? [])
        setPlugins(body.plugins ?? [])
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return stream((event) => {
      if (event.type !== "reports.changed") return
      load()
    })
  }, [stream, load])

  const shown = useMemo(
    () =>
      (reports ?? []).filter(
        (report) =>
          (statusFilter === "all" || report.status === statusFilter) &&
          (!pluginFilter || report.plugin === pluginFilter),
      ),
    [reports, statusFilter, pluginFilter],
  )

  async function setStatus(report: PluginReport, status: ReportStatus) {
    setBusyId(report.id)
    setError("")
    try {
      await api(`/api/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setBusyId("")
    }
  }

  function copyMention(plugin: string) {
    const text = `@reports/${plugin}`
    void navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(plugin)
    setTimeout(() => setCopied(""), 1500)
  }

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, overflowY: "auto", minHeight: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <BugReportIcon />
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Plugin reports
        </Typography>
        <IconButton size="small" onClick={load} aria-label="refresh">
          <RefreshIcon />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="textSecondary">
        Findings the agent filed on this desktop while building or testing
        plugins. Mention a plugin in any thread with @reports/&lt;slug&gt;.
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", rowGap: 1 }}
      >
        {(["open", "done", "wontfix", "all"] as const).map((value) => (
          <Button
            key={value}
            size="small"
            variant={statusFilter === value ? "contained" : "outlined"}
            onClick={() => setStatusFilter(value)}
          >
            {value === "wontfix"
              ? "Won't fix"
              : value[0]?.toUpperCase() + value.slice(1)}
          </Button>
        ))}
        {plugins.length ? (
          <Select
            name="plugin"
            value={pluginFilter}
            sx={{ minWidth: 180 }}
            onSelect={(next) => setPluginFilter(next)}
          >
            {[
              <option key="all" value="">
                All plugins
              </option>,
              ...plugins.map((summary) => (
                <option key={summary.plugin} value={summary.plugin}>
                  {summary.plugin} ({summary.open} open / {summary.total})
                </option>
              )),
            ]}
          </Select>
        ) : null}
      </Stack>
      {reports === null ? (
        <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
          <CircularProgress size={1.5} />
        </Box>
      ) : shown.length === 0 ? (
        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
          No plugin reports here yet. When the agent finds a defect while
          stress-testing a plugin, it files it with ob-report and it lands in
          this list.
        </Typography>
      ) : (
        shown.map((report) => {
          const expanded = expandedId === report.id
          return (
            <Paper key={report.id} variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  color={KIND_COLOR[report.kind] ?? "default"}
                  label={report.kind}
                />
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {report.title}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    @reports/
                    <span style={{ fontWeight: 700 }}>{report.plugin}</span>
                    {" · "}
                    {report.hits} {report.hits === 1 ? "hit" : "hits"} ·{" "}
                    {formatAgo(report.lastSeenAt)}
                    {report.status !== "open" ? ` · ${report.status}` : ""}
                  </Typography>
                </Stack>
                <IconButton
                  size="small"
                  onClick={() => copyMention(report.plugin)}
                  aria-label={`copy @reports/${report.plugin}`}
                  title={
                    copied === report.plugin
                      ? "Copied"
                      : `Copy @reports/${report.plugin}`
                  }
                >
                  <ContentCopyIcon />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setExpandedId(expanded ? "" : report.id)}
                  aria-label={expanded ? "collapse" : "expand"}
                  aria-expanded={expanded}
                >
                  <Box
                    sx={{
                      transform: expanded ? "rotate(180deg)" : undefined,
                      display: "flex",
                    }}
                  >
                    <ChevronDownIcon />
                  </Box>
                </IconButton>
              </Stack>
              {expanded ? (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {report.detail}
                  </Typography>
                  {report.session ? (
                    <Typography variant="caption" color="textSecondary">
                      session {report.session}
                    </Typography>
                  ) : null}
                  {report.note ? (
                    <Typography variant="caption" color="textSecondary">
                      note {report.note}
                    </Typography>
                  ) : null}
                  <Stack direction="row" spacing={1}>
                    {report.status === "open" ? (
                      <>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busyId === report.id}
                          startIcon={
                            busyId === report.id ? (
                              <CircularProgress size={1.2} />
                            ) : undefined
                          }
                          onClick={() => void setStatus(report, "done")}
                        >
                          Done
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={busyId === report.id}
                          onClick={() => void setStatus(report, "wontfix")}
                        >
                          Won't fix
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busyId === report.id}
                        onClick={() => void setStatus(report, "open")}
                      >
                        Reopen
                      </Button>
                    )}
                  </Stack>
                </Stack>
              ) : null}
            </Paper>
          )
        })
      )}
    </Stack>
  )
}
