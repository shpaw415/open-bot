import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { Chip } from "./chip"
import type { EventStream } from "./hooks"
import { useEventStream } from "./hooks"
import { ProcessesIcon, RefreshIcon, StopIcon } from "./icons"
import Stack from "./stack"

type DesktopProcess = {
  id: string
  name: string
  session: string
  cmd: string
  pid: number
  startedAt: number
  uptimeSeconds: number
  cpuPercent: number | null
  rssBytes: number | null
}

const POLL_MS = 10_000

function formatBytes(value: number | null) {
  if (value === null) return "—"
  if (value >= 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} Go`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} Mo`
  return `${Math.max(0, Math.round(value / 1024))} Ko`
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)} h ${String(
      Math.floor((seconds % 3600) / 60),
    ).padStart(2, "0")}`
  return `${Math.floor(seconds / 86400)} j ${Math.floor(
    (seconds % 86400) / 3600,
  )} h`
}

function formatCpu(percent: number | null) {
  return percent === null ? "—" : `${percent.toFixed(1)} %`
}

function shortSession(session: string) {
  return session.length > 12 ? `${session.slice(0, 12)}…` : session
}

export function Processes({
  subscribe,
}: {
  subscribe?: EventStream["subscribe"]
}) {
  const [processes, setProcesses] = useState<DesktopProcess[] | null>(null)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState("")
  const [confirmId, setConfirmId] = useState("")
  const confirmTimer = useRef<number | null>(null)

  // Standalone mounts (Config tab) attach to the shared event stream directly;
  // Workspace keeps passing its own subscribe so nothing changes there.
  const { subscribe: streamSubscribe } = useEventStream(true)
  const stream = subscribe ?? streamSubscribe

  const load = useCallback(() => {
    api<{ processes: DesktopProcess[] }>("/api/processes")
      .then((body) => {
        setProcesses(body.processes ?? [])
        setError("")
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    return stream((event) => {
      if (event.type !== "processes.changed") return
      load()
    })
  }, [stream, load])

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    },
    [],
  )

  async function kill(process: DesktopProcess) {
    if (confirmId !== process.id) {
      setConfirmId(process.id)
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmId(""), 4000)
      return
    }
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    setConfirmId("")
    setBusyId(process.id)
    setError("")
    try {
      await api(`/api/processes/${encodeURIComponent(process.id)}`, {
        method: "DELETE",
      })
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setBusyId("")
    }
  }

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, overflowY: "auto", minHeight: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <ProcessesIcon />
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Processus
        </Typography>
        <IconButton size="small" onClick={load} aria-label="refresh">
          <RefreshIcon />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="textSecondary">
        Tâches de fond lancées par l’assistant avec ob-process — serveurs,
        veilles, travaux longs. Arrêter un processus coupe tout son groupe.
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {processes === null ? (
        <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
          <CircularProgress size={1.5} />
        </Box>
      ) : processes.length === 0 ? (
        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
          Aucun processus géré pour l’instant. Quand l’assistant lance une tâche
          de fond avec ob-process, elle apparaît ici avec sa consommation et un
          bouton d’arrêt.
        </Typography>
      ) : (
        processes.map((process) => (
          <Paper key={process.id} variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {process.name}
                </Typography>
                <Typography variant="caption" color="textSecondary" noWrap>
                  {process.cmd || process.id}
                </Typography>
              </Stack>
              <Chip size="small" label={formatCpu(process.cpuPercent)} />
              <Chip size="small" label={formatBytes(process.rssBytes)} />
              <Chip size="small" label={formatUptime(process.uptimeSeconds)} />
              <IconButton
                size="small"
                color={confirmId === process.id ? "primary" : undefined}
                disabled={busyId === process.id}
                onClick={() => void kill(process)}
                aria-label={
                  confirmId === process.id
                    ? `confirmer l’arrêt de ${process.name}`
                    : `arrêter ${process.name}`
                }
                title={
                  confirmId === process.id
                    ? "Confirmer l’arrêt"
                    : `Arrêter ${process.name}`
                }
              >
                {busyId === process.id ? (
                  <CircularProgress size={1.2} />
                ) : (
                  <StopIcon />
                )}
              </IconButton>
            </Stack>
            <Typography variant="caption" color="textSecondary">
              pid {process.pid} · thread {shortSession(process.session)} ·{" "}
              {process.id}
            </Typography>
          </Paper>
        ))
      )}
    </Stack>
  )
}
