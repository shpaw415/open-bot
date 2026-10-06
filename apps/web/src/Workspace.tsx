import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Menu from "@shpaw415/mui-lite/Menu"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type DesktopStatus, type Me, waitForDesktop } from "./api"
import {
  ACTIVITY_LABEL,
  type ChatMessage,
  modelActivity,
  nearBottom,
  samePayload,
  threadBubbles,
  visibleText,
} from "./chat-view"
import { useMobile } from "./hooks"
import {
  AddIcon,
  ChatIcon,
  CodeIcon,
  ComputerIcon,
  ContentCopyIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  MoreVertIcon,
  OpenInNewIcon,
  PauseIcon,
  PlayArrowIcon,
  RefreshIcon,
  ScheduleIcon,
  SendIcon,
  StopIcon,
  TerminalIcon,
} from "./icons"
import type { PersonaInfo } from "./Personalities"

const THREAD_KEY = "ob-thread"

type Model = { providerID: string; modelID: string; name?: string }
type SessionInfo = {
  id: string
  title?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}
type SessionStatus = { type?: string }

type CronJobInfo = {
  id: string
  name: string
  message: string
  kind: "cron" | "every" | "at"
  cronExpr: string | null
  everySeconds: number | null
  atMs: number | null
  enabled: boolean
  sessionId: string | null
  createdAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  lastError: string | null
}

type Phase = "starting" | "running" | "sleeping"
type CronKind = "every" | "cron" | "at"

function messageKey(message: ChatMessage, index: number): string {
  return `${index}:${message.info?.role ?? "m"}:${visibleText(message).slice(0, 48)}`
}

function threadTime(session: SessionInfo): number {
  return session.time?.updated ?? session.time?.created ?? 0
}

function threadTitle(session: SessionInfo): string {
  return session.title?.trim() || "New thread"
}

function formatAgo(ts: number): string {
  if (!ts) return ""
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatWhen(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function cronSchedule(job: CronJobInfo): string {
  if (job.kind === "cron") return job.cronExpr ?? ""
  if (job.kind === "every") {
    const seconds = job.everySeconds ?? 0
    if (seconds >= 86400 && seconds % 86400 === 0)
      return `every ${seconds / 86400}d`
    if (seconds >= 3600 && seconds % 3600 === 0)
      return `every ${seconds / 3600}h`
    if (seconds >= 60 && seconds % 60 === 0) return `every ${seconds / 60}m`
    return `every ${seconds}s`
  }
  return `once at ${formatWhen(job.atMs)}`
}

export function Workspace({ me }: { me: Me }) {
  const [phase, setPhase] = useState<Phase>(me.desktop ?? "sleeping")
  const [stopping, setStopping] = useState(false)
  const [tab, setTab] = useState("chat")
  const [error, setError] = useState("")
  const [sessionId, setSessionId] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<
    Record<string, SessionStatus>
  >({})
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [threadPersona, setThreadPersona] = useState<Record<string, string>>({})
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newPersonaId, setNewPersonaId] = useState("assistant")
  const [menuThread, setMenuThread] = useState<SessionInfo | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionInfo | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState("")
  const [model, setModel] = useState(
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : "",
  )
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState("")
  const [file, setFile] = useState("")
  const [fileLoading, setFileLoading] = useState(false)
  const [desktopKey, setDesktopKey] = useState(0)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([])
  const [cronBusyId, setCronBusyId] = useState("")
  const [cronAddOpen, setCronAddOpen] = useState(false)
  const [cronSaving, setCronSaving] = useState(false)
  const [cronDeleteTarget, setCronDeleteTarget] = useState<CronJobInfo | null>(
    null,
  )
  const [cronName, setCronName] = useState("")
  const [cronMessage, setCronMessage] = useState("")
  const [cronKind, setCronKind] = useState<CronKind>("every")
  const [cronEvery, setCronEvery] = useState("3600")
  const [cronExpr, setCronExpr] = useState("0 9 * * *")
  const [cronAt, setCronAt] = useState("")
  const mobile = useMobile()
  const outputRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messagesJsonRef = useRef("")
  const menuAnchor = useRef<HTMLElement | null>(null)
  const restoredRef = useRef(false)
  const stoppingRef = useRef(false)

  const running = phase === "running"
  const activeThread = sessions.find((item) => item.id === sessionId)
  const shown = useMemo(() => threadBubbles(messages), [messages])
  const activity = modelActivity({
    phase: stopping ? "sleeping" : phase,
    sending,
    status: sessionId ? sessionStatus[sessionId] : undefined,
    messages,
  })
  const modelOptions = useMemo(
    () =>
      models.map((item) => (
        <option
          key={`${item.providerID}/${item.modelID}`}
          value={`${item.providerID}/${item.modelID}`}
        >
          {item.name
            ? `${item.name} (${item.providerID})`
            : `${item.providerID}/${item.modelID}`}
        </option>
      )),
    [models],
  )

  const threadBusy = useCallback(
    (id: string) => {
      const status = sessionStatus[id]
      return Boolean(status && status.type !== "idle")
    },
    [sessionStatus],
  )

  const loadThreads = useCallback(async () => {
    try {
      const [list, status, personaBody, assignmentBody] = await Promise.all([
        fetch("/api/opencode/session").then((res) => res.json()),
        fetch("/api/opencode/session/status").then((res) => res.json()),
        api<{ personas?: PersonaInfo[] }>("/api/personas").catch(() => ({
          personas: [],
        })),
        api<{ threads?: { sessionId: string; personaId: string }[] }>(
          "/api/personas/threads",
        ).catch(() => ({ threads: [] })),
      ])
      setSessions(
        (Array.isArray(list) ? (list as SessionInfo[]) : [])
          .filter((item) => !item.parentID)
          .sort((a, b) => threadTime(b) - threadTime(a)),
      )
      setSessionStatus(
        status && typeof status === "object"
          ? (status as Record<string, SessionStatus>)
          : {},
      )
      setPersonas(personaBody.personas ?? [])
      const assigned: Record<string, string> = {}
      for (const row of assignmentBody.threads ?? []) {
        if (row.sessionId && row.personaId)
          assigned[row.sessionId] = row.personaId
      }
      setThreadPersona(assigned)
    } catch {
      // desktop may have gone to sleep; the next tick retries
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  async function start() {
    setError("")
    setPhase("starting")
    try {
      await api("/api/desktop/start", { method: "POST" })
      await waitForDesktop()
      setPhase("running")
    } catch (caught) {
      setPhase("sleeping")
      setError(caught instanceof Error ? caught.message : "start failed")
    }
  }

  async function sleep() {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setError("")
    try {
      await api("/api/desktop/stop", { method: "POST" })
      setPhase("sleeping")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "stop failed")
    } finally {
      stoppingRef.current = false
      setStopping(false)
    }
  }

  useEffect(() => {
    if (phase !== "starting") return
    const timer = setInterval(() => {
      void api<DesktopStatus>("/api/desktop")
        .then((status) => {
          if (status.error) {
            setPhase("sleeping")
            setError(status.error)
          } else if (status.phase !== "starting") {
            setPhase(status.phase)
          }
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [phase])

  const loadModels = useCallback(async () => {
    if (!running) return
    setModelsLoading(true)
    try {
      const body = await api<{
        models?: Model[]
        connected?: string[]
      }>("/api/models")
      const next = (body.models ?? []).filter(
        (item) => item.providerID && item.modelID,
      )
      setModels(next)
      setModelsError(
        next.length === 0
          ? body.connected?.length
            ? "no models available — retrying"
            : "no providers connected — add one on the Providers page"
          : "",
      )
    } catch (caught) {
      setModels([])
      setModelsError(
        caught instanceof Error ? caught.message : "failed to load models",
      )
    } finally {
      setModelsLoading(false)
    }
  }, [running])

  useEffect(() => {
    if (!running) {
      setModels([])
      setModelsError("")
      return
    }
    void loadModels()
  }, [running, loadModels])

  // retry while the list is empty: opencode restarts after a provider login,
  // so the first fetch can land mid-restart
  useEffect(() => {
    if (!running || models.length > 0 || modelsLoading) return
    const timer = setInterval(() => void loadModels(), 5000)
    return () => clearInterval(timer)
  }, [running, models.length, modelsLoading, loadModels])

  useEffect(() => {
    messagesJsonRef.current = ""
    stickRef.current = true
    if (!sessionId || !running) return
    let cancelled = false
    async function tick() {
      try {
        const messageRes = await fetch(
          `/api/opencode/session/${sessionId}/message`,
        )
        const body = await messageRes.json()
        if (cancelled) return
        const next = Array.isArray(body) ? body : []
        if (!samePayload(messagesJsonRef.current, next)) {
          messagesJsonRef.current = JSON.stringify(next)
          setMessages(next)
        }
      } catch {
        return
      }
      try {
        const statusRes = await fetch("/api/opencode/session/status")
        const status = await statusRes.json()
        if (cancelled || !status || typeof status !== "object") return
        setSessionStatus(status as Record<string, SessionStatus>)
      } catch {
        return
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, running])

  useEffect(() => {
    if (!running) {
      restoredRef.current = false
      setThreadsOpen(false)
      return
    }
    setSessionsLoading(true)
    void loadThreads()
    const timer = setInterval(() => void loadThreads(), 5000)
    return () => clearInterval(timer)
  }, [running, loadThreads])

  useEffect(() => {
    if (!running || restoredRef.current || sessionsLoading) return
    restoredRef.current = true
    const stored = localStorage.getItem(THREAD_KEY)
    if (stored && !sessionId && sessions.some((item) => item.id === stored)) {
      setSessionId(stored)
    }
  }, [running, sessions, sessionsLoading, sessionId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, tab])

  async function send() {
    const text = draft.trim()
    if (!text || sending || !running || stopping) return
    setError("")
    stickRef.current = true
    setSending(true)
    try {
      let id = sessionId
      if (!id) {
        const created = await api<{ id: string }>("/api/opencode/session", {
          method: "POST",
          body: JSON.stringify({}),
        })
        id = created.id
        setSessionId(id)
        localStorage.setItem(THREAD_KEY, id)
        void loadThreads()
      }
      const split = model.indexOf("/")
      const providerID = split > 0 ? model.slice(0, split) : ""
      const modelID = split > 0 ? model.slice(split + 1) : ""
      await api(`/api/opencode/session/${id}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: providerID && modelID ? { providerID, modelID } : undefined,
          parts: [{ type: "text", text }],
        }),
      })
      setDraft("")
      setTimeout(() => void loadThreads(), 800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "send failed")
    } finally {
      setSending(false)
    }
  }

  function selectThread(id: string) {
    if (id !== sessionId) {
      setSessionId(id)
      setMessages([])
      localStorage.setItem(THREAD_KEY, id)
    }
    if (mobile) setThreadsOpen(false)
  }

  function personaName(id: string | undefined): string {
    if (!id || id === "assistant") return "Assistant"
    return personas.find((item) => item.id === id)?.name ?? "Assistant"
  }

  async function newThread() {
    if (!running || actionBusy) return
    setError("")
    setActionBusy(true)
    try {
      const created = await api<SessionInfo>("/api/opencode/session", {
        method: "POST",
        body: JSON.stringify({ personaId: newPersonaId || "assistant" }),
      })
      setSessionId(created.id)
      setMessages([])
      localStorage.setItem(THREAD_KEY, created.id)
      setThreadsOpen(false)
      setNewThreadOpen(false)
      await loadThreads()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "new thread failed")
    } finally {
      setActionBusy(false)
    }
  }

  async function saveRename() {
    const target = renameTarget
    const title = renameTitle.trim()
    if (!target || !title || actionBusy) return
    setActionBusy(true)
    try {
      await api(`/api/opencode/session/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      })
      setRenameTarget(null)
      await loadThreads()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "rename failed")
    } finally {
      setActionBusy(false)
    }
  }

  async function deleteThread() {
    const target = deleteTarget
    if (!target || actionBusy) return
    setActionBusy(true)
    try {
      await api(`/api/opencode/session/${target.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      if (target.id === sessionId) {
        setSessionId("")
        setMessages([])
        localStorage.removeItem(THREAD_KEY)
      }
      await loadThreads()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setActionBusy(false)
    }
  }

  async function abortThread(id: string) {
    setMenuThread(null)
    setError("")
    try {
      await api(`/api/opencode/session/${id}/abort`, { method: "POST" })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "abort failed")
    }
    setTimeout(() => void loadThreads(), 600)
  }

  const loadCron = useCallback(async () => {
    try {
      const body = await api<CronJobInfo[]>("/api/cron")
      setCronJobs(Array.isArray(body) ? body : [])
    } catch {
      // transient — the next poll retries
    }
  }, [])

  useEffect(() => {
    if (tab !== "cron") return
    void loadCron()
    const timer = setInterval(() => void loadCron(), 10_000)
    return () => clearInterval(timer)
  }, [tab, loadCron])

  async function addCronJob() {
    if (cronSaving) return
    setError("")
    const body = {
      name: cronName.trim(),
      message: cronMessage.trim(),
      kind: cronKind,
      ...(cronKind === "every"
        ? { everySeconds: Number(cronEvery) }
        : cronKind === "cron"
          ? { cronExpr: cronExpr.trim() }
          : { atMs: new Date(cronAt).getTime() }),
    }
    setCronSaving(true)
    try {
      await api("/api/cron", { method: "POST", body: JSON.stringify(body) })
      setCronAddOpen(false)
      setCronName("")
      setCronMessage("")
      setCronKind("every")
      setCronEvery("3600")
      setCronExpr("0 9 * * *")
      setCronAt("")
      await loadCron()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "job create failed")
    } finally {
      setCronSaving(false)
    }
  }

  async function toggleCronJob(job: CronJobInfo) {
    if (cronBusyId) return
    setCronBusyId(job.id)
    try {
      await api(`/api/cron/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      await loadCron()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "update failed")
    } finally {
      setCronBusyId("")
    }
  }

  async function runCronJob(job: CronJobInfo) {
    if (cronBusyId) return
    setError("")
    setCronBusyId(job.id)
    try {
      await api(`/api/cron/${job.id}/run`, { method: "POST" })
      await loadCron()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "run failed")
    } finally {
      setCronBusyId("")
    }
  }

  async function removeCronJob() {
    const target = cronDeleteTarget
    if (!target || cronBusyId) return
    setCronBusyId(target.id)
    try {
      await api(`/api/cron/${target.id}`, { method: "DELETE" })
      setCronDeleteTarget(null)
      await loadCron()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setCronBusyId("")
    }
  }

  function openCronThread(job: CronJobInfo) {
    if (!job.sessionId || !running) return
    setSessionId(job.sessionId)
    setMessages([])
    localStorage.setItem(THREAD_KEY, job.sessionId)
    setTab("chat")
  }

  async function loadFiles() {
    if (!running) return
    setFilesLoading(true)
    try {
      const body = (await fetch(
        "/api/opencode/file?path=/home/agent/workspace",
      ).then((res) => res.json())) as { path?: string; name?: string }[]
      setFiles(
        Array.isArray(body)
          ? body.map((item) => item.path ?? item.name ?? "").filter(Boolean)
          : [],
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "file list failed")
    } finally {
      setFilesLoading(false)
    }
  }

  async function openFile(path: string) {
    setSelectedPath(path)
    setFileLoading(true)
    if (mobile) setExplorerOpen(false)
    try {
      const body = (await fetch(
        `/api/opencode/file/content?path=${encodeURIComponent(path)}`,
      ).then((res) => res.json())) as { content?: string }
      setFile(body.content ?? "")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "file open failed")
    } finally {
      setFileLoading(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per tab/phase, not on files change
  useEffect(() => {
    if (tab === "code" && running && files.length === 0 && !filesLoading) {
      void loadFiles()
    }
  }, [tab, running])

  const phaseColor = stopping
    ? "warning"
    : phase === "running"
      ? "success"
      : phase === "starting"
        ? "warning"
        : undefined

  return (
    <Stack
      sx={{ height: "100%", minHeight: 0, p: mobile ? 0.75 : 1 }}
      spacing={0.75}
    >
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        className="ob-workspace-bar"
        sx={{
          flexWrap: "nowrap",
          overflow: "hidden",
          minHeight: 40,
        }}
      >
        <Chip size="small" color={phaseColor} sx={{ flexShrink: 0 }}>
          {stopping ? "stopping…" : phase === "starting" ? "starting…" : phase}
        </Chip>
        {phase === "starting" || stopping ? (
          <CircularProgress size={1.2} />
        ) : null}
        {running ? (
          mobile ? (
            <ToolTip title={stopping ? "Stopping desktop…" : "Sleep desktop"}>
              <IconButton
                size="small"
                aria-label="Sleep desktop"
                aria-busy={stopping}
                disabled={stopping}
                onClick={() => void sleep()}
              >
                {stopping ? <CircularProgress size={1.2} /> : <PauseIcon />}
              </IconButton>
            </ToolTip>
          ) : (
            <Button
              size="small"
              variant="outlined"
              startIcon={
                stopping ? <CircularProgress size={1.2} /> : <PauseIcon />
              }
              onClick={() => void sleep()}
              disabled={stopping}
              aria-busy={stopping}
              sx={{ flexShrink: 0 }}
            >
              {stopping ? "Stopping…" : "Sleep"}
            </Button>
          )
        ) : mobile ? (
          <ToolTip title="Start desktop">
            <IconButton
              size="small"
              aria-label="Start desktop"
              onClick={() => void start()}
              disabled={phase === "starting"}
            >
              <PlayArrowIcon />
            </IconButton>
          </ToolTip>
        ) : (
          <Button
            size="small"
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={() => void start()}
            disabled={phase === "starting"}
            sx={{ flexShrink: 0 }}
          >
            Start
          </Button>
        )}
        {tab === "chat" && running ? (
          mobile ? (
            <ToolTip title="New thread">
              <IconButton
                size="small"
                aria-label="New thread"
                disabled={actionBusy}
                onClick={() => void newThread()}
              >
                <AddIcon />
              </IconButton>
            </ToolTip>
          ) : (
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              disabled={actionBusy}
              onClick={() => void newThread()}
              sx={{ flexShrink: 0 }}
            >
              New thread
            </Button>
          )
        ) : null}
        {tab === "cron" ? (
          mobile ? (
            <ToolTip title="Add job">
              <IconButton
                size="small"
                aria-label="Add job"
                onClick={() => setCronAddOpen(true)}
              >
                <AddIcon />
              </IconButton>
            </ToolTip>
          ) : (
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              onClick={() => setCronAddOpen(true)}
              sx={{ flexShrink: 0 }}
            >
              Add job
            </Button>
          )
        ) : null}
        {modelsLoading && models.length === 0 ? (
          <Skeleton width={mobile ? 120 : 160} height={32} />
        ) : (
          <Select
            name="model"
            label={running ? "Model" : "Model (start desktop)"}
            value={model}
            disabled={!running || models.length === 0}
            className="ob-model-select"
            sx={{
              flex: 1,
              minWidth: 0,
              maxWidth: mobile ? 160 : 240,
            }}
            onSelect={(value) => {
              setModel(value)
              const split = value.indexOf("/")
              const providerID = split > 0 ? value.slice(0, split) : ""
              const modelID = split > 0 ? value.slice(split + 1) : ""
              if (providerID && modelID) {
                void api("/api/model", {
                  method: "PUT",
                  body: JSON.stringify({ providerID, modelID }),
                }).catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "model save failed",
                  ),
                )
              }
            }}
          >
            {modelOptions}
          </Select>
        )}
        {modelsError ? (
          <ToolTip title={modelsError}>
            <Chip
              size="small"
              color="error"
              variant="outlined"
              sx={{ flexShrink: 0 }}
            >
              model !
            </Chip>
          </ToolTip>
        ) : null}
        {running && !modelsLoading ? (
          <ToolTip title="Reload model list">
            <IconButton
              size="small"
              aria-label="Reload model list"
              onClick={() => void loadModels()}
              sx={{ flexShrink: 0 }}
            >
              <RefreshIcon />
            </IconButton>
          </ToolTip>
        ) : null}
      </Stack>

      <Tabs value={tab} onChange={(_event, value) => setTab(String(value))}>
        <Tab
          label={`Chat${shown.length ? ` (${shown.length})` : ""}`}
          value="chat"
          icon={<ChatIcon />}
        />
        <Tab label="Desktop" value="desktop" icon={<ComputerIcon />} />
        <Tab label="Code" value="code" icon={<CodeIcon />} />
        <Tab label="Cron" value="cron" icon={<ScheduleIcon />} />
      </Tabs>

      {/* Chat */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tab === "chat" ? "flex" : "none",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {running && mobile ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              startIcon={<ChatIcon />}
              onClick={() => setThreadsOpen((open) => !open)}
            >
              {threadsOpen ? "Hide threads" : "Threads"}
            </Button>
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeThread
                ? `${threadTitle(activeThread)} · ${personaName(threadPersona[activeThread.id])}`
                : sessionId
                  ? "New thread"
                  : "No thread selected"}
            </Typography>
          </Stack>
        ) : null}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "row",
            gap: 1,
          }}
        >
          {running ? (
            <Paper
              variant="outlined"
              sx={{
                width: mobile ? "100%" : 280,
                flexShrink: 0,
                minHeight: 0,
                display: mobile && !threadsOpen ? "none" : "flex",
                flexDirection: "column",
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 1.5, py: 0.75 }}
              >
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Threads
                </Typography>
                <ToolTip title="New thread">
                  <IconButton
                    size="small"
                    aria-label="New thread"
                    disabled={actionBusy}
                    onClick={() => {
                      setNewPersonaId("assistant")
                      setNewThreadOpen(true)
                    }}
                  >
                    <AddIcon width={18} height={18} />
                  </IconButton>
                </ToolTip>
              </Stack>
              <Divider />
              <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                {sessionsLoading && sessions.length === 0 ? (
                  <Stack spacing={1} sx={{ p: 1 }}>
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                  </Stack>
                ) : sessions.length === 0 ? (
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ p: 1.5 }}
                  >
                    No threads yet — send a message or press +.
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {sessions.map((item) => (
                      <Box
                        key={item.id}
                        sx={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <ListItemButton
                          selected={item.id === sessionId}
                          onClick={() => selectThread(item.id)}
                          sx={{ flex: 1, minWidth: 0, pr: 5 }}
                        >
                          <ListItemText
                            primary={threadTitle(item)}
                            secondary={`${personaName(threadPersona[item.id])} · ${formatAgo(threadTime(item))}`}
                            SlotProps={{
                              primary: { noWrap: true } as never,
                              secondary: { noWrap: true } as never,
                            }}
                          />
                          {threadBusy(item.id) ? (
                            <CircularProgress size={1.2} sx={{ mr: 1 }} />
                          ) : null}
                        </ListItemButton>
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${threadTitle(item)}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            menuAnchor.current = event.currentTarget
                            setMenuThread(item)
                          }}
                          sx={{
                            position: "absolute",
                            right: 4,
                            top: "50%",
                            transform: "translateY(-50%)",
                          }}
                        >
                          <MoreVertIcon width={18} height={18} />
                        </IconButton>
                      </Box>
                    ))}
                  </List>
                )}
              </Box>
            </Paper>
          ) : null}
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: mobile && running && threadsOpen ? "none" : "flex",
              flexDirection: "column",
            }}
          >
            {sessionId ? (
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ px: 1.5, pt: 0.75 }}
              >
                {personaName(threadPersona[sessionId])}
              </Typography>
            ) : null}
            {stopping ? (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 1.5, py: 0.75 }}
              >
                <CircularProgress size={1.2} />
                <Typography variant="caption" color="textSecondary">
                  Stopping the desktop…
                </Typography>
              </Stack>
            ) : activity ? (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 1.5, py: 0.75 }}
              >
                <Typography variant="caption" color="textSecondary">
                  Model
                </Typography>
                <Chip
                  size="small"
                  color={
                    activity === "done"
                      ? "success"
                      : activity === "initialize"
                        ? "warning"
                        : "primary"
                  }
                >
                  {ACTIVITY_LABEL[activity]}
                </Chip>
                {activity === "done" ? null : <CircularProgress size={1.2} />}
              </Stack>
            ) : null}
            {stopping || activity ? <Divider /> : null}
            <Box
              className="ob-chat-log"
              ref={outputRef}
              onScroll={() => {
                const el = outputRef.current
                if (!el) return
                stickRef.current = nearBottom(
                  el.scrollHeight,
                  el.scrollTop,
                  el.clientHeight,
                )
              }}
            >
              {phase === "sleeping" ? (
                <Stack
                  alignItems="center"
                  justifyContent="center"
                  sx={{ flex: 1, minHeight: 160, textAlign: "center" }}
                  spacing={1}
                >
                  <Typography variant="subtitle1">Desktop is asleep</Typography>
                  <Typography variant="body2" color="textSecondary">
                    Start the desktop to chat with OpenCode.
                  </Typography>
                </Stack>
              ) : shown.length === 0 ? (
                <Stack
                  alignItems="center"
                  justifyContent="center"
                  sx={{ flex: 1, minHeight: 160, textAlign: "center" }}
                  spacing={1}
                >
                  <Typography variant="subtitle1">
                    {phase === "starting"
                      ? "Opening the desktop"
                      : "No messages yet"}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {phase === "starting"
                      ? "The model is not ready until the desktop is up."
                      : model
                        ? `Using ${model}. Ask anything.`
                        : "Pick a model, then ask anything."}
                  </Typography>
                </Stack>
              ) : (
                shown.map((message, index) => {
                  const role = message.info?.role ?? "message"
                  const mine = role === "user"
                  return (
                    <Box
                      key={messageKey(message, index)}
                      title={mine ? "You" : "Agent"}
                      className={`ob-bubble ${mine ? "ob-bubble-user" : "ob-bubble-assistant"}`}
                      sx={{
                        bgcolor: mine ? "primary.main" : "action.hover",
                        color: mine ? "primary.contrastText" : "text.primary",
                      }}
                    >
                      <div className="ob-md">
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {message.text}
                        </Markdown>
                      </div>
                    </Box>
                  )
                })
              )}
            </Box>
            <Divider />
            <Stack
              direction="row"
              spacing={1}
              alignItems="flex-end"
              sx={{ p: 1 }}
            >
              <TextField
                label="Message"
                value={draft}
                multiline
                disabled={!running || sending || stopping}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                startIcon={<SendIcon />}
                onClick={() => void send()}
                disabled={!running || sending || stopping || !draft.trim()}
              >
                {sending ? "…" : "Send"}
              </Button>
            </Stack>
          </Paper>
        </Box>
      </Box>

      {/* Desktop — keep alive while running so VNC state survives tab switches */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tab === "desktop" ? "flex" : "none",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {!running ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="subtitle1">Desktop is asleep</Typography>
            <Typography variant="body2" color="textSecondary">
              Start the desktop to view VNC and terminal.
            </Typography>
          </Paper>
        ) : (
          <>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ flex: 1 }}
              >
                {stopping
                  ? "Stopping the desktop…"
                  : "VNC session — kept alive when you switch tabs."}
              </Typography>
              <ToolTip title="Reload VNC">
                <Button
                  size="small"
                  variant="text"
                  startIcon={<RefreshIcon />}
                  onClick={() => setDesktopKey((key) => key + 1)}
                >
                  Reload
                </Button>
              </ToolTip>
              <ToolTip title="Open VNC in a new tab">
                <Button
                  size="small"
                  variant="text"
                  startIcon={<OpenInNewIcon />}
                  onClick={() =>
                    window.open(
                      "/desktop/view/vnc.html?autoconnect=1&resize=scale&path=desktop/view/websockify",
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  Pop out
                </Button>
              </ToolTip>
            </Stack>
            <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
              <iframe
                key={desktopKey}
                title="desktop"
                src="/desktop/view/vnc.html?autoconnect=1&resize=scale&path=desktop/view/websockify"
                className="ob-frame"
              />
            </Box>
          </>
        )}
      </Box>

      {/* Code */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tab === "code" ? "flex" : "none",
          flexDirection: mobile ? "column" : "row",
          gap: 1,
        }}
      >
        {!running ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: "center", flex: 1 }}>
            <Typography variant="subtitle1">Desktop is asleep</Typography>
            <Typography variant="body2" color="textSecondary">
              Start the desktop to browse workspace files.
            </Typography>
          </Paper>
        ) : (
          <>
            {mobile ? (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FolderIcon />}
                  onClick={() => setExplorerOpen((open) => !open)}
                >
                  {explorerOpen ? "Hide files" : "Files"}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<RefreshIcon />}
                  onClick={() => void loadFiles()}
                >
                  Refresh
                </Button>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  sx={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    alignSelf: "center",
                  }}
                >
                  {selectedPath || `${files.length} files`}
                </Typography>
              </Stack>
            ) : null}
            <Paper
              variant="outlined"
              sx={{
                width: mobile ? "100%" : 280,
                maxHeight: mobile ? (explorerOpen ? 220 : 0) : "100%",
                overflow: mobile && !explorerOpen ? "hidden" : "auto",
                display: mobile && !explorerOpen ? "none" : "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {!mobile ? (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ p: 1 }}
                >
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>
                    Files
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<RefreshIcon />}
                    onClick={() => void loadFiles()}
                  >
                    Refresh
                  </Button>
                </Stack>
              ) : null}
              <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                {filesLoading ? (
                  <Stack spacing={1} sx={{ p: 1 }}>
                    <Skeleton height={28} />
                    <Skeleton height={28} />
                    <Skeleton height={28} />
                  </Stack>
                ) : files.length === 0 ? (
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ p: 1.5 }}
                  >
                    No files yet — press Refresh.
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {files.map((path) => (
                      <ListItemButton
                        key={path}
                        selected={path === selectedPath}
                        onClick={() => void openFile(path)}
                      >
                        <ListItemText
                          primary={path}
                          SlotProps={{
                            primary: { noWrap: true } as never,
                          }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </Box>
            </Paper>
            <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }} spacing={1}>
              <Paper
                variant="outlined"
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 1.5, py: 0.5 }}
                >
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    sx={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedPath || "Select a file"}
                  </Typography>
                  {file ? (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<ContentCopyIcon />}
                      onClick={() => void navigator.clipboard?.writeText(file)}
                    >
                      Copy
                    </Button>
                  ) : null}
                </Stack>
                <Divider />
                {fileLoading ? (
                  <Stack spacing={1} sx={{ p: 1.5, flex: 1 }}>
                    <Skeleton height={18} />
                    <Skeleton height={18} width="80%" />
                    <Skeleton height={18} width="60%" />
                  </Stack>
                ) : (
                  <pre className="ob-code-pre">{file || "// empty"}</pre>
                )}
              </Paper>
              <Paper
                variant="outlined"
                sx={{
                  height: mobile ? 180 : 220,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{ px: 1.5, py: 0.5 }}
                >
                  <TerminalIcon width={14} height={14} />
                  <Typography variant="caption" color="textSecondary">
                    Terminal
                  </Typography>
                </Stack>
                <Divider />
                <iframe
                  title="terminal"
                  src="/desktop/term/"
                  className="ob-frame"
                />
              </Paper>
            </Stack>
          </>
        )}
      </Box>

      {/* Cron */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tab === "cron" ? "flex" : "none",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            Scheduled jobs run even when the desktop sleeps — they wake it, then
            prompt the agent in a dedicated thread.
          </Typography>
          <ToolTip title="Reload jobs">
            <IconButton
              size="small"
              aria-label="Reload jobs"
              onClick={() => void loadCron()}
            >
              <RefreshIcon />
            </IconButton>
          </ToolTip>
        </Stack>
        <Box className="ob-cron-list" sx={{ flex: 1, minHeight: 0 }}>
          {cronJobs.length === 0 ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ flex: 1, minHeight: 160, textAlign: "center" }}
              spacing={1}
            >
              <Typography variant="subtitle1">No scheduled jobs</Typography>
              <Typography variant="body2" color="textSecondary">
                Add one here, or ask the agent to schedule work with ob-cron.
              </Typography>
            </Stack>
          ) : (
            cronJobs.map((job) => (
              <Paper key={job.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ flexWrap: "wrap", rowGap: 1 }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {job.name}
                  </Typography>
                  <Chip size="small" label={cronSchedule(job)} />
                  <Box sx={{ flex: 1 }} />
                  {cronBusyId === job.id ? (
                    <CircularProgress size={1.2} />
                  ) : (
                    <Switch
                      size="small"
                      checked={job.enabled}
                      aria-label={`Toggle ${job.name}`}
                      onChange={() => void toggleCronJob(job)}
                    />
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{
                    mt: 0.5,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {job.message}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    label={
                      job.enabled
                        ? `next ${formatWhen(job.nextRunAt)}`
                        : "paused"
                    }
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    color={
                      job.lastError
                        ? "error"
                        : job.lastRunAt
                          ? "success"
                          : undefined
                    }
                    label={
                      job.lastError
                        ? "error"
                        : job.lastRunAt
                          ? `ran ${formatAgo(job.lastRunAt)}`
                          : "never ran"
                    }
                  />
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<PlayArrowIcon />}
                    disabled={Boolean(cronBusyId)}
                    onClick={() => void runCronJob(job)}
                  >
                    Run now
                  </Button>
                  {job.sessionId && running ? (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<ChatIcon />}
                      onClick={() => openCronThread(job)}
                    >
                      Thread
                    </Button>
                  ) : null}
                  <IconButton
                    size="small"
                    aria-label={`Delete ${job.name}`}
                    disabled={Boolean(cronBusyId)}
                    onClick={() => setCronDeleteTarget(job)}
                  >
                    <DeleteIcon width={18} height={18} />
                  </IconButton>
                </Stack>
                {job.lastError ? (
                  <Typography
                    variant="caption"
                    color="error"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    {job.lastError}
                  </Typography>
                ) : null}
              </Paper>
            ))
          )}
        </Box>
      </Box>

      <Menu
        open={Boolean(menuThread)}
        anchorEl={menuAnchor}
        onClose={() => setMenuThread(null)}
      >
        {menuThread ? (
          <>
            <ListItemButton
              onClick={() => {
                setRenameTarget(menuThread)
                setRenameTitle(threadTitle(menuThread))
                setMenuThread(null)
              }}
            >
              <EditIcon />
              <ListItemText primary="Rename" />
            </ListItemButton>
            {threadBusy(menuThread.id) ? (
              <ListItemButton onClick={() => void abortThread(menuThread.id)}>
                <StopIcon />
                <ListItemText primary="Abort" />
              </ListItemButton>
            ) : null}
            <ListItemButton
              onClick={() => {
                setDeleteTarget(menuThread)
                setMenuThread(null)
              }}
            >
              <DeleteIcon />
              <ListItemText primary="Delete" />
            </ListItemButton>
          </>
        ) : null}
      </Menu>

      <Dialog open={newThreadOpen} onClose={() => setNewThreadOpen(false)}>
        <DialogTitle>New thread</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            The personality stays for this thread. It cannot be changed later.
          </Typography>
          <Select
            name="persona"
            label="Personality"
            value={newPersonaId}
            disabled={actionBusy}
            sx={{ width: "100%", mt: 1 }}
            onSelect={setNewPersonaId}
          >
            {(personas.length
              ? personas
              : [
                  {
                    id: "assistant",
                    name: "Assistant",
                    instruction: "",
                    builtin: true,
                  },
                ]
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setNewThreadOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={actionBusy}
            onClick={() => void newThread()}
          >
            Start
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
      >
        <DialogTitle>Rename thread</DialogTitle>
        <DialogContent>
          <TextField
            label="Title"
            value={renameTitle}
            autoFocus
            sx={{ width: "100%", mt: 1 }}
            disabled={actionBusy}
            onChange={(event) => setRenameTitle(event.currentTarget.value)}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveRename()
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={actionBusy || !renameTitle.trim()}
            onClick={() => void saveRename()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      >
        <DialogTitle>Delete thread?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Deletes “{deleteTarget ? threadTitle(deleteTarget) : ""}” and all of
            its messages. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={actionBusy}
            startIcon={<DeleteIcon />}
            onClick={() => void deleteThread()}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cronAddOpen} onClose={() => setCronAddOpen(false)}>
        <DialogTitle>Add cron job</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1, minWidth: mobile ? 260 : 380 }}>
            <TextField
              label="Name"
              value={cronName}
              autoFocus
              onChange={(event) => setCronName(event.currentTarget.value)}
            />
            <TextField
              label="Message sent to the agent"
              value={cronMessage}
              multiline
              rows={3}
              onChange={(event) => setCronMessage(event.currentTarget.value)}
            />
            <Select
              name="schedule"
              label="Schedule"
              value={cronKind}
              onSelect={(value) => setCronKind(value as CronKind)}
            >
              <option value="every">Interval</option>
              <option value="cron">Cron expression (UTC)</option>
              <option value="at">One time</option>
            </Select>
            {cronKind === "every" ? (
              <TextField
                label="Every (seconds, min 60)"
                value={cronEvery}
                inputMode="numeric"
                onChange={(event) => setCronEvery(event.currentTarget.value)}
              />
            ) : cronKind === "cron" ? (
              <TextField
                label="Cron expression"
                value={cronExpr}
                placeholder="0 9 * * 1-5"
                onChange={(event) => setCronExpr(event.currentTarget.value)}
              />
            ) : (
              <TextField
                label="Run at"
                value={cronAt}
                type="datetime-local"
                onChange={(event) => setCronAt(event.currentTarget.value)}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setCronAddOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              cronSaving ||
              !cronName.trim() ||
              !cronMessage.trim() ||
              (cronKind === "every" && !(Number(cronEvery) >= 60)) ||
              (cronKind === "cron" &&
                cronExpr.trim().split(/\s+/).length !== 5) ||
              (cronKind === "at" && !cronAt)
            }
            onClick={() => void addCronJob()}
          >
            {cronSaving ? "…" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(cronDeleteTarget)}
        onClose={() => setCronDeleteTarget(null)}
      >
        <DialogTitle>Delete cron job?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Deletes “{cronDeleteTarget?.name ?? ""}”. Its thread stays, but it
            will never run again. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setCronDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={Boolean(cronBusyId)}
            startIcon={<DeleteIcon />}
            onClick={() => void removeCronJob()}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
