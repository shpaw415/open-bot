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
import Drawer from "@shpaw415/mui-lite/Drawer"
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
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  api,
  clientId,
  type DesktopStatus,
  type Me,
  waitForDesktop,
} from "./api"
import {
  ACTIVITY_LABEL,
  type ChatMessage,
  chatImageUrl,
  eventTouchesSession,
  modelActivity,
  nearBottom,
  type SendReceipt,
  type SendStatus,
  samePayload,
  transcriptBubbles,
  userMessageCount,
  visibleText,
} from "./chat-view"
import { useDebounced, useEventStream, useMobile } from "./hooks"
import {
  AddIcon,
  BlockIcon,
  ChatIcon,
  CheckCircleIcon,
  ComputerIcon,
  DeleteIcon,
  EditIcon,
  MenuIcon,
  MoreVertIcon,
  OpenInNewIcon,
  PauseIcon,
  PlayArrowIcon,
  RefreshIcon,
  ScheduleIcon,
  SendIcon,
  StopIcon,
} from "./icons"
import type { PersonaInfo } from "./Personalities"

const THREAD_KEY = "ob-thread"
const BUILTIN_PERSONA_NAMES: Record<string, string> = {
  assistant: "Assistant",
  designer: "Designer",
  "political-expert": "Political expert",
  "software-designer": "Software designer",
}

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
  providerId: string | null
  modelId: string | null
  personaId: string | null
}

type CronNotice = {
  id: string
  jobId: string
  jobName: string
  sessionId: string
  summary: string | null
  createdAt: number
}

type Phase = "starting" | "running" | "sleeping"
type CronKind = "every" | "cron" | "at"
type LocalReceipt = SendReceipt & { sessionId: string }

function SendMark({ mark }: { mark: SendStatus }) {
  const label =
    mark === "sending" ? "Sending" : mark === "sent" ? "Sent" : "Not sent"
  return (
    <span
      className={`ob-send-mark${mark === "sent" ? " ob-send-mark-sent" : ""}${mark === "failed" ? " ob-send-mark-failed" : ""}`}
      role="img"
      title={label}
      aria-label={label}
    >
      {mark === "sending" ? (
        <CircularProgress size={1} />
      ) : mark === "sent" ? (
        <CheckCircleIcon width={16} height={16} />
      ) : (
        <BlockIcon width={16} height={16} />
      )}
    </span>
  )
}

function messageKey(message: ChatMessage, index: number): string {
  return `${index}:${message.info?.role ?? "m"}:${visibleText(message).slice(0, 48)}`
}

function chatUrl(url: string, key: string): string {
  if (key === "src") return chatImageUrl(url)
  return defaultUrlTransform(url)
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

function cronModelValue(job: {
  providerId: string | null
  modelId: string | null
}): string {
  return job.providerId && job.modelId ? `${job.providerId}/${job.modelId}` : ""
}

function cronModelLabel(job: CronJobInfo, models: Model[]): string {
  if (!job.providerId || !job.modelId) return "default model"
  const match = models.find(
    (item) =>
      item.providerID === job.providerId && item.modelID === job.modelId,
  )
  return match?.name ?? `${job.providerId}/${job.modelId}`
}

function editingSchedule(jobs: CronJobInfo[], id: string): string {
  const job = jobs.find((item) => item.id === id)
  return job ? cronSchedule(job) : "as created"
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
  const [receipts, setReceipts] = useState<LocalReceipt[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<
    Record<string, SessionStatus>
  >({})
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
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
  const [desktopKey, setDesktopKey] = useState(0)
  const [screen, setScreen] = useState<{
    sessionId: string
    path: string
  } | null>(null)
  const [screenError, setScreenError] = useState("")
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
  const [cronModel, setCronModel] = useState("")
  const [cronPersona, setCronPersona] = useState("assistant")
  const [cronEditId, setCronEditId] = useState<string | null>(null)
  const [notices, setNotices] = useState<CronNotice[]>([])
  const mobile = useMobile()
  const outputRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messagesJsonRef = useRef("")
  const menuAnchor = useRef<HTMLElement | null>(null)
  const restoredRef = useRef(false)
  const stoppingRef = useRef(false)

  const running = phase === "running"
  const { live, subscribe } = useEventStream(running)
  const activeThread = sessions.find((item) => item.id === sessionId)
  const shown = useMemo(
    () =>
      transcriptBubbles(
        messages,
        receipts.filter((item) => item.sessionId === sessionId),
      ),
    [messages, receipts, sessionId],
  )
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
          .filter(
            (item) => !item.parentID && !item.title?.startsWith("cron-run:"),
          )
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

  // event-driven refresh: the socket announces changes, we refetch lazily
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs reset when the thread or desktop changes
  useEffect(() => {
    messagesJsonRef.current = ""
    stickRef.current = true
  }, [sessionId, running])

  const tick = useCallback(async () => {
    if (!sessionId || !running) return
    try {
      const messageRes = await fetch(
        `/api/opencode/session/${sessionId}/message`,
      )
      const body = await messageRes.json()
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
      if (!status || typeof status !== "object") return
      setSessionStatus(status as Record<string, SessionStatus>)
    } catch {
      return
    }
  }, [sessionId, running])

  // initial load plus catch-up whenever the stream comes back
  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    void tick()
  }, [tick, live])

  const scheduleTick = useDebounced(() => void tick(), 150)

  useEffect(() => {
    if (!running) return
    return subscribe((event) => {
      const type = event.type ?? ""
      if (type === "session.status") {
        const props = event.properties as
          | { sessionID?: unknown; status?: unknown }
          | undefined
        const id = typeof props?.sessionID === "string" ? props.sessionID : ""
        if (
          id &&
          props?.status &&
          typeof props.status === "object" &&
          !Array.isArray(props.status)
        ) {
          setSessionStatus((prev) => ({
            ...prev,
            [id]: props.status as SessionStatus,
          }))
        }
        return
      }
      if (type === "session.deleted" && eventTouchesSession(event, sessionId)) {
        setSessionId("")
        setMessages([])
        localStorage.removeItem(THREAD_KEY)
        return
      }
      if (
        (type === "message.updated" ||
          type === "message.removed" ||
          type === "message.part.updated") &&
        eventTouchesSession(event, sessionId)
      ) {
        scheduleTick()
      }
    })
  }, [running, subscribe, sessionId, scheduleTick])

  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    if (!running) {
      restoredRef.current = false
      setThreadsOpen(false)
      return
    }
    setSessionsLoading(true)
    void loadThreads()
  }, [running, loadThreads, live])

  const scheduleThreads = useDebounced(() => void loadThreads(), 300)

  useEffect(() => {
    if (!running) return
    return subscribe((event) => {
      const type = event.type ?? ""
      if (
        type === "session.created" ||
        type === "session.updated" ||
        type === "session.deleted"
      ) {
        scheduleThreads()
      }
    })
  }, [running, subscribe, scheduleThreads])

  useEffect(() => {
    if (!running || restoredRef.current || sessionsLoading) return
    restoredRef.current = true
    const stored = localStorage.getItem(THREAD_KEY)
    if (stored && !sessionId && sessions.some((item) => item.id === stored)) {
      setSessionId(stored)
    }
  }, [running, sessions, sessionsLoading, sessionId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: desktopKey reloads the screen
  useEffect(() => {
    if (tab !== "desktop" || !running || !sessionId) return
    let cancelled = false
    const load = async (quiet: boolean) => {
      if (!quiet) setScreenError("")
      try {
        const next = await api<{ sessionId: string; path: string }>(
          "/api/desktop/screen",
          {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          },
        )
        if (cancelled) return
        setScreen(next)
        setScreenError("")
      } catch (caught) {
        if (cancelled || quiet) return
        setScreen(null)
        setScreenError(
          caught instanceof Error
            ? caught.message
            : "could not open the screen",
        )
      }
    }
    void load(false)
    const timer = setInterval(() => void load(true), 15000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [tab, running, sessionId, desktopKey])

  const needsScreen = shown.some((entry) => entry.message.handoff)
  useEffect(() => {
    if (tab === "desktop" || !running || !sessionId || !needsScreen) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await api<{ sessionId: string; path: string }>(
          "/api/desktop/screen",
          {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          },
        )
        if (cancelled) return
        setScreen(next)
        setScreenError("")
      } catch (caught) {
        if (cancelled) return
        setScreenError(
          caught instanceof Error
            ? caught.message
            : "could not open the screen",
        )
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tab, running, sessionId, needsScreen])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shown, tab])

  async function prompt(text: string) {
    if (!text || sending) return false
    if (!running || stopping) {
      setError(
        stopping
          ? "Desktop is stopping. Wait, then send again."
          : "Desktop is not ready. Wait until it is running, then send again.",
      )
      return false
    }
    const receiptId = clientId()
    let id = sessionId
    setReceipts((prev) => [
      ...prev,
      {
        id: receiptId,
        sessionId: id,
        text,
        status: "sending",
        sentAt: Date.now(),
        baseline: userMessageCount(messages),
      },
    ])
    setError("")
    stickRef.current = true
    setSending(true)
    try {
      if (!id) {
        const created = await api<{ id: string }>("/api/opencode/session", {
          method: "POST",
          body: JSON.stringify({}),
        })
        id = created.id
        setSessionId(id)
        localStorage.setItem(THREAD_KEY, id)
        setReceipts((prev) =>
          prev.map((item) =>
            item.id === receiptId ? { ...item, sessionId: id } : item,
          ),
        )
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
      setReceipts((prev) =>
        prev.map((item) =>
          item.id === receiptId
            ? { ...item, status: "sent", sessionId: id }
            : item,
        ),
      )
      const title = text
        .split("\n")
        .map((item) => item.trim())
        .find(Boolean)
      if (title) {
        setSessions((prev) =>
          prev.map((item) =>
            item.id === id &&
            (!item.title?.trim() || /^New session\b/i.test(item.title))
              ? { ...item, title: title.slice(0, 80) }
              : item,
          ),
        )
      }
      setTimeout(() => void loadThreads(), 800)
      return true
    } catch (caught) {
      setReceipts((prev) =>
        prev.map((item) =>
          item.id === receiptId ? { ...item, status: "failed" } : item,
        ),
      )
      setError(caught instanceof Error ? caught.message : "send failed")
      return false
    } finally {
      setSending(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text) return
    if (!running || stopping || sending) {
      setError(
        stopping
          ? "Desktop is stopping. Wait, then send again."
          : sending
            ? "Still sending the previous message."
            : "Desktop is not ready. Wait until it is running, then send again.",
      )
      return
    }
    setDraft("")
    try {
      const accepted = await prompt(text)
      if (!accepted) setDraft(text)
    } catch (caught) {
      setDraft(text)
      setError(caught instanceof Error ? caught.message : "send failed")
    }
  }

  function selectThread(id: string) {
    if (id !== sessionId) {
      setSessionId(id)
      setMessages([])
      localStorage.setItem(THREAD_KEY, id)
    }
    if (mobile) setThreadsOpen(false)
    if (notices.some((notice) => notice.sessionId === id))
      void markNoticesViewed({ sessionId: id })
  }

  function goTab(next: string) {
    setTab(next)
    setDrawerOpen(false)
  }

  function selectModel(value: string) {
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
          caught instanceof Error ? caught.message : "model save failed",
        ),
      )
    }
  }

  function personaName(id: string | undefined): string {
    if (!id || id === "assistant") return "Assistant"
    return (
      personas.find((item) => item.id === id)?.name ??
      BUILTIN_PERSONA_NAMES[id] ??
      id
    )
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
      if (notices.some((notice) => notice.sessionId === target.id))
        void markNoticesViewed({ sessionId: target.id })
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

  const scheduleCron = useDebounced(() => void loadCron(), 300)

  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    if (tab !== "cron") return
    void loadCron()
    void api<{ personas?: PersonaInfo[] }>("/api/personas")
      .then((body) => {
        if (body.personas?.length) setPersonas(body.personas)
      })
      .catch(() => {})
  }, [tab, loadCron, live])

  useEffect(() => {
    if (tab !== "cron") return
    return subscribe((event) => {
      if (event.type === "cron.changed") scheduleCron()
    })
  }, [tab, subscribe, scheduleCron])

  const loadNotices = useCallback(async () => {
    try {
      const body = await api<CronNotice[]>("/api/cron/notices")
      setNotices(Array.isArray(body) ? body : [])
    } catch {
      return
    }
  }, [])

  const markNoticesViewed = useCallback(
    async (body: { id?: string; sessionId?: string }) => {
      setNotices((current) =>
        current.filter((notice) =>
          body.id ? notice.id !== body.id : notice.sessionId !== body.sessionId,
        ),
      )
      try {
        await api("/api/cron/notices/view", {
          method: "POST",
          body: JSON.stringify(body),
        })
      } catch {
        void loadNotices()
      }
    },
    [loadNotices],
  )

  const scheduleNotices = useDebounced(() => void loadNotices(), 300)

  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    void loadNotices()
  }, [loadNotices, live])

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "cron.notices") scheduleNotices()
    })
  }, [subscribe, scheduleNotices])

  // slow safety net while the event stream is down
  useEffect(() => {
    if (!running || live) return
    const timer = setInterval(() => {
      void tick()
      void loadThreads()
      void loadNotices()
      if (tab === "cron") void loadCron()
    }, 30_000)
    return () => clearInterval(timer)
  }, [running, live, tick, loadThreads, loadNotices, loadCron, tab])

  useEffect(() => {
    if (tab !== "chat" || !sessionId) return
    if (!notices.some((notice) => notice.sessionId === sessionId)) return
    void markNoticesViewed({ sessionId })
  }, [tab, sessionId, notices, markNoticesViewed])

  async function openNotice(notice: CronNotice) {
    await markNoticesViewed({ id: notice.id })
    if (phase !== "running") {
      setError("")
      setPhase("starting")
      try {
        await api("/api/desktop/start", { method: "POST" })
        await waitForDesktop()
        setPhase("running")
      } catch (caught) {
        setPhase("sleeping")
        setError(caught instanceof Error ? caught.message : "start failed")
        return
      }
    }
    setSessionId(notice.sessionId)
    setMessages([])
    localStorage.setItem(THREAD_KEY, notice.sessionId)
    setTab("chat")
    if (mobile) setThreadsOpen(false)
  }

  function openCronForm(job?: CronJobInfo) {
    setCronEditId(job?.id ?? null)
    setCronName(job?.name ?? "")
    setCronMessage(job?.message ?? "")
    setCronKind(job?.kind ?? "every")
    setCronEvery(String(job?.everySeconds ?? 3600))
    setCronExpr(job?.cronExpr ?? "0 9 * * *")
    setCronAt("")
    setCronModel(job ? cronModelValue(job) : "")
    setCronPersona(job?.personaId || "assistant")
    setCronAddOpen(true)
    void api<{ personas?: PersonaInfo[] }>("/api/personas")
      .then((body) => setPersonas(body.personas ?? []))
      .catch(() => {})
  }

  async function saveCronJob() {
    if (cronSaving) return
    setError("")
    const split = cronModel.indexOf("/")
    const providerID = split > 0 ? cronModel.slice(0, split) : null
    const modelID = split > 0 ? cronModel.slice(split + 1) : null
    const personaId = cronPersona || "assistant"
    const fields = {
      name: cronName.trim(),
      message: cronMessage.trim(),
      providerID,
      modelID,
      personaId,
    }
    setCronSaving(true)
    try {
      if (cronEditId) {
        await api(`/api/cron/${cronEditId}`, {
          method: "PATCH",
          body: JSON.stringify(fields),
        })
      } else {
        await api("/api/cron", {
          method: "POST",
          body: JSON.stringify({
            ...fields,
            kind: cronKind,
            ...(cronKind === "every"
              ? { everySeconds: Number(cronEvery) }
              : cronKind === "cron"
                ? { cronExpr: cronExpr.trim() }
                : { atMs: new Date(cronAt).getTime() }),
          }),
        })
      }
      setCronAddOpen(false)
      await loadCron()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : cronEditId
            ? "job update failed"
            : "job create failed",
      )
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
    if (notices.some((notice) => notice.sessionId === job.sessionId))
      void markNoticesViewed({ sessionId: job.sessionId })
  }

  const phaseColor = stopping
    ? "warning"
    : phase === "running"
      ? "success"
      : phase === "starting"
        ? "warning"
        : undefined

  return (
    <Stack
      className="ob-workspace"
      sx={{ height: "100%", minHeight: 0, p: mobile ? 0.5 : 1 }}
      spacing={mobile ? 0.5 : 0.75}
    >
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {notices[0] ? (
        <Alert
          severity="info"
          onClose={() => void markNoticesViewed({ id: notices[0]?.id })}
        >
          {notices.length > 1
            ? `${notices.length} cron jobs published results. Latest: ${notices[0].jobName}. `
            : `${notices[0].jobName} published results. `}
          {notices[0].summary}{" "}
          <Button size="small" onClick={() => void openNotice(notices[0])}>
            Open thread
          </Button>
        </Alert>
      ) : null}

      {mobile ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          className="ob-mobile-bar"
          sx={{ minHeight: 40, flexShrink: 0 }}
        >
          <IconButton
            size="small"
            aria-label="Open workspace menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="subtitle2"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tab === "chat"
              ? activeThread
                ? threadTitle(activeThread)
                : sessionId
                  ? "New thread"
                  : "Chat"
              : tab === "desktop"
                ? "Desktop"
                : `Cron${notices.length ? ` (${notices.length})` : ""}`}
          </Typography>
          <Chip size="small" color={phaseColor} sx={{ flexShrink: 0 }}>
            {stopping
              ? "stopping…"
              : phase === "starting"
                ? "starting…"
                : phase}
          </Chip>
          {phase === "starting" || stopping ? (
            <CircularProgress size={1.2} />
          ) : null}
        </Stack>
      ) : (
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
            {stopping
              ? "stopping…"
              : phase === "starting"
                ? "starting…"
                : phase}
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
                  onClick={() => openCronForm()}
                >
                  <AddIcon />
                </IconButton>
              </ToolTip>
            ) : (
              <Button
                size="small"
                variant="text"
                startIcon={<AddIcon />}
                onClick={() => openCronForm()}
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
              onSelect={(value) => selectModel(value)}
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
            mobile ? null : (
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
            )
          ) : null}
        </Stack>
      )}

      {mobile ? null : (
        <Tabs value={tab} onChange={(_event, value) => setTab(String(value))}>
          <Tab
            label={`Chat${shown.length ? ` (${shown.length})` : ""}`}
            value="chat"
            icon={<ChatIcon />}
          />
          <Tab label="Desktop" value="desktop" icon={<ComputerIcon />} />
          <Tab
            label={`Cron${notices.length ? ` (${notices.length})` : ""}`}
            value="cron"
            icon={<ScheduleIcon />}
          />
        </Tabs>
      )}

      {/* Chat */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: tab === "chat" ? "flex" : "none",
          flexDirection: "column",
          gap: mobile ? 0.5 : 1,
        }}
      >
        {running && mobile ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            className="ob-threads-bar"
            sx={{ px: 0.25 }}
          >
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
                          ) : notices.some(
                              (notice) => notice.sessionId === item.id,
                            ) ? (
                            <Chip
                              size="small"
                              color="primary"
                              label="new"
                              sx={{ mr: 1 }}
                            />
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
            {sessionId && !mobile ? (
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
                className="ob-status-row"
                sx={{ px: mobile ? 1 : 1.5, py: mobile ? 0.25 : 0.75 }}
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
                className="ob-status-row"
                sx={{ px: mobile ? 1 : 1.5, py: mobile ? 0.25 : 0.75 }}
              >
                {mobile ? null : (
                  <Typography variant="caption" color="textSecondary">
                    Model
                  </Typography>
                )}
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
                shown.map((entry, index) => {
                  const message = entry.message
                  const role = message.info?.role ?? "message"
                  const mine = role === "user"
                  const lastHandoff = shown.reduce(
                    (at, item, itemIndex) =>
                      item.message.handoff ? itemIndex : at,
                    -1,
                  )
                  const liveScreen =
                    message.handoff &&
                    index === lastHandoff &&
                    screen?.sessionId === sessionId
                  return (
                    <Box
                      key={entry.pendingId ?? messageKey(message, index)}
                      title={mine ? "You" : "Agent"}
                      className={`ob-bubble ${mine ? "ob-bubble-user" : "ob-bubble-assistant"}`}
                      sx={{
                        bgcolor: mine ? "primary.main" : undefined,
                        color: mine ? "primary.contrastText" : "text.primary",
                        border: mine ? "none" : "1px solid",
                        borderColor: mine ? undefined : "divider",
                      }}
                    >
                      {mine && entry.mark ? (
                        <SendMark mark={entry.mark} />
                      ) : null}
                      <div className="ob-md">
                        {message.text.trim() ? (
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            urlTransform={chatUrl}
                            components={{
                              img: ({ src, alt }) =>
                                src ? <img src={src} alt={alt ?? ""} /> : null,
                            }}
                          >
                            {message.text}
                          </Markdown>
                        ) : null}
                        {message.images.map((src) => (
                          <img key={src} src={src} alt="" />
                        ))}
                        {message.handoff ? (
                          <div className="ob-screen">
                            {liveScreen ? (
                              <iframe
                                title="thread screen"
                                src={`/desktop/view/vnc.html?autoconnect=1&resize=scale&path=${encodeURIComponent(screen.path)}`}
                              />
                            ) : (
                              <Typography variant="body2" color="textSecondary">
                                {index === lastHandoff
                                  ? screenError || "Opening this screen…"
                                  : "Screen was shared in a later reply."}
                              </Typography>
                            )}
                            {index === lastHandoff ? (
                              <Button
                                size="small"
                                variant="contained"
                                disabled={!running || sending || stopping}
                                onClick={() =>
                                  void prompt("Done on the screen.")
                                }
                              >
                                Done
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {message.sentAt ? (
                        <time
                          className="ob-bubble-time"
                          dateTime={new Date(message.sentAt).toISOString()}
                        >
                          {formatWhen(message.sentAt)}
                        </time>
                      ) : null}
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
              className="ob-input-row"
              sx={{ p: mobile ? 0.75 : 1 }}
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
              {mobile ? (
                <IconButton
                  size="medium"
                  aria-label="Send message"
                  disabled={!running || sending || stopping || !draft.trim()}
                  onClick={() => void send()}
                  sx={{
                    flexShrink: 0,
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                  }}
                >
                  {sending ? "…" : <SendIcon />}
                </IconButton>
              ) : (
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={() => void send()}
                  disabled={!running || sending || stopping || !draft.trim()}
                >
                  {sending ? "…" : "Send"}
                </Button>
              )}
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
              Start the desktop to view a thread screen.
            </Typography>
          </Paper>
        ) : !sessionId ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="subtitle1">No thread selected</Typography>
            <Typography variant="body2" color="textSecondary">
              Select a thread to open its screen.
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
                  : `Screen for ${
                      sessions.find((item) => item.id === sessionId)?.title ||
                      "this thread"
                    }. Switching threads switches screens.`}
              </Typography>
              <ToolTip title="Reload VNC">
                <Button
                  size="small"
                  variant="text"
                  startIcon={<RefreshIcon />}
                  onClick={() => setDesktopKey((key) => key + 1)}
                  disabled={!screen || screen.sessionId !== sessionId}
                >
                  Reload
                </Button>
              </ToolTip>
              <ToolTip title="Open VNC in a new tab">
                <Button
                  size="small"
                  variant="text"
                  startIcon={<OpenInNewIcon />}
                  disabled={!screen || screen.sessionId !== sessionId}
                  onClick={() => {
                    if (!screen || screen.sessionId !== sessionId) return
                    const path = encodeURIComponent(screen.path)
                    window.open(
                      `/desktop/view/vnc.html?autoconnect=1&resize=scale&path=${path}`,
                      "_blank",
                      "noopener",
                    )
                  }}
                >
                  Pop out
                </Button>
              </ToolTip>
            </Stack>
            {screen?.sessionId === sessionId ? (
              <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                <iframe
                  key={`${screen.sessionId}-${desktopKey}`}
                  title="desktop"
                  src={`/desktop/view/vnc.html?autoconnect=1&resize=scale&path=${encodeURIComponent(screen.path)}`}
                  className="ob-frame"
                />
              </Box>
            ) : (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="subtitle1">
                  {screenError ? "Screen unavailable" : "Opening screen"}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {screenError || "Opening this thread's screen…"}
                </Typography>
              </Paper>
            )}
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
            Each run works in a temporary session, posts the result to this
            job's thread, then deletes that session.
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
                  <Chip
                    size="small"
                    variant="outlined"
                    label={cronModelLabel(job, models)}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={personaName(job.personaId ?? undefined)}
                  />
                  {notices.some((notice) => notice.jobId === job.id) ? (
                    <Chip size="small" color="primary" label="new result" />
                  ) : null}
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
                    startIcon={<EditIcon />}
                    disabled={Boolean(cronBusyId)}
                    onClick={() => openCronForm(job)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<PlayArrowIcon />}
                    disabled={Boolean(cronBusyId)}
                    onClick={() => void runCronJob(job)}
                  >
                    Run now
                  </Button>
                  {job.sessionId &&
                  (running ||
                    notices.some((notice) => notice.jobId === job.id)) ? (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<ChatIcon />}
                      onClick={() => {
                        const notice = notices.find(
                          (item) => item.jobId === job.id,
                        )
                        if (notice) void openNotice(notice)
                        else openCronThread(job)
                      }}
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

      {mobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          variant="temporary"
          anchor="left"
          width={300}
        >
          <Box
            sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
          >
            <Typography variant="subtitle2">Views</Typography>
            <List dense disablePadding>
              <ListItemButton
                selected={tab === "chat"}
                onClick={() => goTab("chat")}
              >
                <ChatIcon />
                <ListItemText
                  primary={`Chat${shown.length ? ` (${shown.length})` : ""}`}
                />
              </ListItemButton>
              <ListItemButton
                selected={tab === "desktop"}
                onClick={() => goTab("desktop")}
              >
                <ComputerIcon />
                <ListItemText primary="Desktop" />
              </ListItemButton>
              <ListItemButton
                selected={tab === "cron"}
                onClick={() => goTab("cron")}
              >
                <ScheduleIcon />
                <ListItemText
                  primary={`Cron${notices.length ? ` (${notices.length})` : ""}`}
                />
              </ListItemButton>
            </List>
            <Divider />
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                Desktop
              </Typography>
              <Chip size="small" color={phaseColor}>
                {stopping
                  ? "stopping…"
                  : phase === "starting"
                    ? "starting…"
                    : phase}
              </Chip>
            </Stack>
            {running ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={
                  stopping ? <CircularProgress size={1.2} /> : <PauseIcon />
                }
                onClick={() => void sleep()}
                disabled={stopping}
                aria-busy={stopping}
              >
                {stopping ? "Stopping…" : "Sleep"}
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={() => void start()}
                disabled={phase === "starting"}
              >
                Start
              </Button>
            )}
            <Divider />
            <Typography variant="subtitle2">Model</Typography>
            {modelsLoading && models.length === 0 ? (
              <Skeleton width="100%" height={40} />
            ) : (
              <Select
                name="model-drawer"
                label={running ? "Model" : "Model (start desktop)"}
                value={model}
                disabled={!running || models.length === 0}
                sx={{ width: "100%" }}
                onSelect={(value) => selectModel(value)}
              >
                {modelOptions}
              </Select>
            )}
            {modelsError ? (
              <Chip size="small" color="error" variant="outlined">
                {modelsError}
              </Chip>
            ) : null}
            <Divider />
            {running ? (
              <Button
                size="small"
                variant="text"
                startIcon={<AddIcon />}
                disabled={actionBusy}
                onClick={() => {
                  setNewPersonaId("assistant")
                  setNewThreadOpen(true)
                  setDrawerOpen(false)
                }}
              >
                New thread
              </Button>
            ) : null}
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              onClick={() => {
                goTab("cron")
                openCronForm()
              }}
            >
              Add job
            </Button>
          </Box>
        </Drawer>
      ) : null}

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
        <DialogTitle>
          {cronEditId ? "Edit cron job" : "Add cron job"}
        </DialogTitle>
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
            {cronEditId ? (
              <Typography variant="caption" color="textSecondary">
                Schedule stays {editingSchedule(cronJobs, cronEditId)}.
              </Typography>
            ) : (
              <>
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
                    onChange={(event) =>
                      setCronEvery(event.currentTarget.value)
                    }
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
              </>
            )}
            <Select
              name="cron-model"
              label="Model"
              value={cronModel}
              disabled={!running && models.length === 0 && !cronModel}
              onSelect={setCronModel}
            >
              {[
                <option key="default" value="">
                  Desktop default
                </option>,
                ...(cronModel &&
                !models.some(
                  (item) => `${item.providerID}/${item.modelID}` === cronModel,
                )
                  ? [
                      <option key={cronModel} value={cronModel}>
                        {cronModel}
                      </option>,
                    ]
                  : []),
                ...modelOptions,
              ]}
            </Select>
            <Select
              name="cron-persona"
              label="Personality"
              value={cronPersona}
              onSelect={setCronPersona}
            >
              {[
                ...(personas.length
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
                )),
                ...(cronPersona &&
                !personas.some((item) => item.id === cronPersona) &&
                cronPersona !== "assistant"
                  ? [
                      <option key={cronPersona} value={cronPersona}>
                        {personaName(cronPersona)}
                      </option>,
                    ]
                  : []),
              ]}
            </Select>
            <Typography variant="caption" color="textSecondary">
              The model and personality run the temporary session. The result is
              still posted to this job's thread.
              {!running
                ? " Start the desktop to choose a model other than the desktop default."
                : ""}
            </Typography>
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
              (!cronEditId &&
                ((cronKind === "every" && !(Number(cronEvery) >= 60)) ||
                  (cronKind === "cron" &&
                    cronExpr.trim().split(/\s+/).length !== 5) ||
                  (cronKind === "at" && !cronAt)))
            }
            onClick={() => void saveCronJob()}
          >
            {cronSaving ? "…" : cronEditId ? "Save" : "Add"}
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
