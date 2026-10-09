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
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Markdown, { type Components, defaultUrlTransform } from "react-markdown"
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
  handoffStamp,
  type MediaMap,
  mediaKey,
  modelActivity,
  nearBottom,
  type PluginCardBlock,
  type SendReceipt,
  type SendStatus,
  samePayload,
  showLiveScreen,
  speakableText,
  splitPluginCards,
  type TranscriptEntry,
  transcriptBubbles,
  turnError,
  userMessageCount,
  visibleText,
  vncFrameSrc,
} from "./chat-view"
import { readDraft, writeDraft } from "./draft"
import {
  useDebounced,
  useEventStream,
  useMobile,
  useUnreadThreads,
} from "./hooks"
import {
  AddIcon,
  AttachFileIcon,
  BlockIcon,
  ChatIcon,
  CheckCircleIcon,
  ComputerIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  MenuIcon,
  MicIcon,
  MoreVertIcon,
  OpenInNewIcon,
  PauseIcon,
  PlayArrowIcon,
  RefreshIcon,
  ScheduleIcon,
  SendIcon,
  StopIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "./icons"
import { Projects } from "./ide/Projects"
import {
  type JoinedFile,
  joinedImage,
  joinFileError,
  promptParts,
  readJoinedFile,
} from "./join-file"
import { MediaDownloadButton } from "./MediaDownload"
import { Model3dView } from "./Model3dView"
import { ModelSelect } from "./ModelSelect"
import {
  OPEN_THREAD_EVENT,
  seenThread,
  setNoticeFocus,
  THREAD_KEY,
} from "./notify"
import type { PersonaInfo } from "./Personalities"
import {
  type PluginCardSpec,
  PluginCards,
  useInstalledPlugins,
} from "./plugin-ui"
import {
  ProjectRefLink,
  ProjectRefsContext,
  remarkProjectRefs,
  useProjectRefs,
} from "./project-refs"
import ReferenceOverlay from "./ReferenceOverlay"
import {
  detectMention,
  mentionSuggestions,
  type RefItemView,
  type RefSectionView,
  type SkillSummary,
  type Suggestion,
} from "./references"

// the IDE keeps its own state; memo keeps workspace renders (streaming ticks,
// status polls) from re-rendering its whole tree
const MemoProjects = memo(Projects)

const BUILTIN_PERSONA_NAMES: Record<string, string> = {
  assistant: "Assistant",
  designer: "Designer",
  "political-expert": "Political expert",
  "software-designer": "Software designer",
}

type Model = { providerID: string; modelID: string; name?: string }
type ProjectMention = {
  id: string
  name: string
  path: string
  createdAt?: number
}
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
  runKind?: "prompt" | "script" | "both"
  script?: string | null
}

type CronNotice = {
  id: string
  jobId: string
  jobName: string
  summary: string | null
  createdAt: number
  viewedAt: number | null
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

function clipNoticeLine(text: string | null): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim()
  if (line.length <= 200) return line
  return `${line.slice(0, 199)}…`
}

type VncWindow = Window & {
  UI?: {
    forceSetting?: (name: string, value: boolean) => void
    updateViewOnly?: () => void
  }
}

function lockVnc(win: VncWindow | null, interactive: boolean) {
  try {
    win?.UI?.forceSetting?.("view_only", !interactive)
    win?.UI?.updateViewOnly?.()
  } catch {
    // frame not ready, or the page blocked access
  }
}

function VncFrame({
  path,
  interactive,
  title,
  className,
}: {
  path: string
  interactive: boolean
  title: string
  className?: string
}) {
  return (
    <iframe
      title={title}
      className={className}
      src={vncFrameSrc(path, interactive)}
      onLoad={(event) => {
        const frame = event.currentTarget
        const lock = () =>
          lockVnc(frame.contentWindow as VncWindow | null, interactive)
        lock()
        window.setTimeout(lock, 400)
      }}
    />
  )
}

function openVnc(path: string, interactive: boolean) {
  const pop = window.open(vncFrameSrc(path, interactive), "_blank")
  if (!pop) return
  const lock = () => lockVnc(pop as VncWindow, interactive)
  pop.addEventListener("load", lock)
  window.setTimeout(lock, 800)
}

function chatUrl(url: string, key: string): string {
  if (key === "src") return chatImageUrl(url)
  return defaultUrlTransform(url)
}

// Stable module-level identities so memoized markdown skips re-parsing when
// only surrounding state (e.g. the composer draft) changes.
const markdownPlugins = [remarkGfm]

const markdownComponents: Components = {
  a: ({ href, children, ...rest }) => {
    if (href?.startsWith("#project-ref/"))
      return <ProjectRefLink href={href}>{children}</ProjectRefLink>
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  img: ({ src, alt }) => {
    if (!src) return null
    if (/\.(mp4|webm)$/i.test(src)) {
      return (
        // biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions
        <video src={src} controls preload="metadata" />
      )
    }
    if (src.startsWith("/api/workspace/model3d") || /\.glb$/i.test(src)) {
      return <Model3dView src={src} alt={alt ?? ""} />
    }
    return (
      <div className="ob-media-wrap">
        <img src={src} alt={alt ?? ""} />
        <MediaDownloadButton src={src} />
      </div>
    )
  },
}

const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const refs = useProjectRefs()
  const plugins = useMemo(
    () =>
      refs.length
        ? [...markdownPlugins, () => remarkProjectRefs(refs)]
        : markdownPlugins,
    [refs],
  )
  return (
    <Markdown
      remarkPlugins={plugins}
      urlTransform={chatUrl}
      components={markdownComponents}
    >
      {text}
    </Markdown>
  )
})

type PluginRenderer = { title: string; spec: PluginCardSpec[] }

function PluginCardBlockView({
  block,
  renderers,
}: {
  block: PluginCardBlock
  renderers: Map<string, PluginRenderer>
}) {
  const renderer = renderers.get(block.type)
  if (renderer) {
    return <PluginCards spec={renderer.spec} data={block.data} />
  }
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" color="textSecondary">
        {block.plugin || "plugin"}
        {block.type ? ` · ${block.type}` : ""}
      </Typography>
      <Typography
        variant="body2"
        component="pre"
        sx={{
          whiteSpace: "pre-wrap",
          m: 0,
          fontSize: 13,
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {JSON.stringify(block.data, null, 2).slice(0, 4000)}
      </Typography>
    </Paper>
  )
}

const PluginSegments = memo(function PluginSegments({
  text,
  renderers,
}: {
  text: string
  renderers: Map<string, PluginRenderer>
}) {
  const segments = splitPluginCards(text)
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <ChatMarkdown text={(segments[0].text ?? "").trim()} />
  }
  const parts = segments.map((segment, index) => ({
    id:
      segment.kind === "text"
        ? `text-${index}`
        : `card-${segment.block.plugin}-${segment.block.type}-${index}`,
    segment,
  }))
  return (
    <>
      {parts.map((part) =>
        part.segment.kind === "text" ? (
          part.segment.text.trim() ? (
            <ChatMarkdown key={part.id} text={part.segment.text.trim()} />
          ) : null
        ) : (
          <PluginCardBlockView
            key={part.id}
            block={part.segment.block}
            renderers={renderers}
          />
        ),
      )}
    </>
  )
})

function threadTime(session: SessionInfo): number {
  return session.time?.updated ?? session.time?.created ?? 0
}

function threadCreated(session: SessionInfo): number {
  return session.time?.created ?? 0
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

function cronRunLabel(kind: CronJobInfo["runKind"]): string {
  if (kind === "script") return "script"
  if (kind === "both") return "script + prompt"
  return "prompt"
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

type BubbleViewProps = {
  entry: TranscriptEntry
  index: number
  bubbleKey: string
  speechKey: string | null
  speechLoading: string | null
  lastHandoff: number
  held: boolean
  dismissedHandoff: string
  screenLive: boolean
  screenPath: string
  screenError: string
  running: boolean
  sending: boolean
  stopping: boolean
  controlBusy: boolean
  renderers: Map<string, PluginRenderer>
  onTakeControl: () => void
  onScreenDone: () => void
  onSpeak: (key: string, text: string) => void
  onStopSpeak: () => void
}

const MessageBubble = memo(function MessageBubble({
  entry,
  index,
  bubbleKey,
  speechKey,
  speechLoading,
  lastHandoff,
  held,
  dismissedHandoff,
  screenLive,
  screenPath,
  screenError,
  running,
  sending,
  stopping,
  controlBusy,
  renderers,
  onTakeControl,
  onScreenDone,
  onSpeak,
  onStopSpeak,
}: BubbleViewProps) {
  const message = entry.message
  const role = message.info?.role ?? "message"
  const mine = role === "user"
  const stamp = handoffStamp(message)
  const watching =
    showLiveScreen({
      handoff: Boolean(message.handoff),
      isLast: index === lastHandoff,
      held,
      dismissed: stamp === dismissedHandoff,
    }) && screenLive
  return (
    <Box
      title={mine ? "You" : "Agent"}
      className={`ob-bubble ${mine ? "ob-bubble-user" : "ob-bubble-assistant"}`}
      sx={{
        bgcolor: mine ? "primary.main" : undefined,
        color: mine ? "primary.contrastText" : "text.primary",
        border: mine ? "none" : "1px solid",
        borderColor: mine ? undefined : "divider",
      }}
    >
      {mine && entry.mark ? <SendMark mark={entry.mark} /> : null}
      <div className="ob-md">
        {message.text.trim() ? (
          <PluginSegments text={message.text} renderers={renderers} />
        ) : null}
        {message.images.map((src) => (
          <div key={src} className="ob-media-wrap">
            <img src={src} alt="" />
            <MediaDownloadButton src={src} />
          </div>
        ))}
        {message.handoff ? (
          <div className={watching ? "ob-screen" : undefined}>
            {watching ? (
              <VncFrame
                title="thread screen"
                path={screenPath}
                interactive={false}
              />
            ) : (
              <Typography variant="body2" color="textSecondary">
                {index !== lastHandoff
                  ? "Screen was shared in a later reply."
                  : held
                    ? "You have the screen below."
                    : stamp === dismissedHandoff
                      ? "Screen closed."
                      : screenError || "Opening this screen…"}
              </Typography>
            )}
            {index === lastHandoff && !held && stamp !== dismissedHandoff ? (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!running || sending || stopping || controlBusy}
                  onClick={onTakeControl}
                >
                  Take control
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={!running || sending || stopping}
                  onClick={onScreenDone}
                >
                  Done
                </Button>
              </Stack>
            ) : null}
          </div>
        ) : null}
      </div>
      {!mine && message.text.trim() ? (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ justifyContent: "flex-end", mt: 0.25 }}
        >
          <ToolTip
            title={speechKey === bubbleKey ? "Stop reading" : "Read out loud"}
          >
            <span>
              <IconButton
                size="small"
                aria-label={
                  speechKey === bubbleKey ? "Stop reading" : "Read out loud"
                }
                disabled={
                  sending ||
                  stopping ||
                  (speechLoading !== null && speechLoading !== bubbleKey)
                }
                onClick={() => {
                  if (speechKey === bubbleKey && speechLoading !== bubbleKey) {
                    onStopSpeak()
                    return
                  }
                  onSpeak(bubbleKey, message.text)
                }}
                sx={{ opacity: 0.7 }}
              >
                {speechLoading === bubbleKey ? (
                  <CircularProgress size={1.1} />
                ) : speechKey === bubbleKey ? (
                  <StopIcon width={16} height={16} />
                ) : (
                  <VolumeUpIcon width={16} height={16} />
                )}
              </IconButton>
            </span>
          </ToolTip>
        </Stack>
      ) : null}
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

const ThreadsPanel = memo(function ThreadsPanel({
  sessions,
  sessionId,
  loading,
  mobile,
  open,
  personaLabel,
  busyIds,
  unread,
  actionBusy,
  actions,
}: {
  sessions: SessionInfo[]
  sessionId: string
  loading: boolean
  mobile: boolean
  open: boolean
  personaLabel: (id: string) => string
  busyIds: ReadonlySet<string>
  unread: ReadonlySet<string>
  actionBusy: boolean
  actions: {
    select: (id: string) => void
    menu: (item: SessionInfo, anchor: HTMLElement) => void
    create: () => void
  }
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        width: mobile ? "100%" : 280,
        flexShrink: 0,
        minHeight: 0,
        display: mobile && !open ? "none" : "flex",
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
            onClick={actions.create}
          >
            <AddIcon width={18} height={18} />
          </IconButton>
        </ToolTip>
      </Stack>
      <Divider />
      <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {loading && sessions.length === 0 ? (
          <Stack spacing={1} sx={{ p: 1 }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : sessions.length === 0 ? (
          <Typography variant="body2" color="textSecondary" sx={{ p: 1.5 }}>
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
                  onClick={() => actions.select(item.id)}
                  sx={{ flex: 1, minWidth: 0, pr: 5 }}
                >
                  <ListItemText
                    primary={
                      <span className="ob-thread-label">
                        {unread.has(item.id) &&
                        !(item.id === sessionId && !document.hidden) ? (
                          <span
                            className="ob-unread-dot"
                            role="img"
                            aria-label="Unread"
                          />
                        ) : null}
                        <span className="ob-thread-title">
                          {threadTitle(item)}
                        </span>
                      </span>
                    }
                    secondary={`${personaLabel(item.id)} · ${formatAgo(threadTime(item))}`}
                    SlotProps={{
                      primary: {
                        className: "ob-thread-primary",
                      } as never,
                      secondary: { noWrap: true } as never,
                    }}
                  />
                  {busyIds.has(item.id) ? (
                    <CircularProgress size={1.2} sx={{ mr: 1 }} />
                  ) : null}
                </ListItemButton>
                <IconButton
                  size="small"
                  aria-label={`Actions for ${threadTitle(item)}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.menu(item, event.currentTarget)
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
  )
})

type ComposerCommand = {
  plugin: string
  command: string
  title: string
  template: string
}

type ComposerButton = {
  plugin: string
  id: string
  label: string
  template: string
}

type ComposerValidator = {
  plugin: string
  pattern: string
  message: string
}

const DRAFT_WRITE_DELAY = 400

const READ_ALOUD_KEY = "ob-read-aloud"
// Hold-to-talk limits: recordings below the floor are ignored, and the
// recorder force-stops at the ceiling to stay well under the upload cap.
const MIN_RECORD_MS = 700
const MAX_RECORD_MS = 180_000

// Sent as a normal user turn when a reply died with a provider connection
// error (internet blip). One auto-retry per dead turn; further retries are
// manual via the banner's Resume button.
const RESUME_PROMPT =
  "The connection dropped mid-reply and the response was cut off. Please continue from where you left off."
const RESUME_BLOCK_MS = 3 * 60_000
const RESUME_DELAY_MS = 6_000

// Owns the composer draft and mention/slash popup state so every keystroke
// re-renders only this subtree, not the whole workspace.
function Composer({
  sessionId,
  running,
  sending,
  stopping,
  stopBusy,
  canStop,
  mobile,
  joined,
  rememberJoined,
  onError,
  onSubmit,
  onStop,
  baseSections,
  pluginButtons,
  pluginCommands,
  pluginValidators,
  pluginAccept,
  readAloud,
  onToggleReadAloud,
  sharedDraftRef,
  migrateDraft,
  projects,
  onEnsureProjects,
}: {
  sessionId: string
  running: boolean
  sending: boolean
  stopping: boolean
  stopBusy: boolean
  canStop: boolean
  mobile: boolean
  joined: JoinedFile[]
  rememberJoined: (next: JoinedFile[]) => void
  onError: (message: string) => void
  onSubmit: (text: string, files: JoinedFile[]) => Promise<boolean>
  onStop: () => void
  baseSections: RefSectionView[]
  pluginButtons: ComposerButton[]
  pluginCommands: ComposerCommand[]
  pluginValidators: ComposerValidator[]
  pluginAccept: string
  readAloud: boolean
  onToggleReadAloud: () => void
  sharedDraftRef: { current: string }
  migrateDraft: string
  projects: ProjectMention[]
  onEnsureProjects: () => void
}) {
  const [draft, setDraft] = useState(() => {
    const stored = readDraft(localStorage, sessionId)
    if (stored) return stored
    // adopt a draft typed before this thread existed
    if (sessionId && migrateDraft) {
      writeDraft(localStorage, sessionId, migrateDraft)
      return migrateDraft
    }
    return ""
  })
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionHidden, setMentionHidden] = useState(false)
  const [slashHidden, setSlashHidden] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [skillList, setSkillList] = useState<SkillSummary[]>([])
  const [joinOpen, setJoinOpen] = useState(false)
  const draftRef = useRef(draft)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const joinAnchor = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const skillsRequestedRef = useRef(false)
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordStartRef = useRef(0)

  // release the microphone if the composer goes away mid-recording
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop()
      for (const track of recordStreamRef.current?.getTracks() ?? [])
        track.stop()
    }
  }, [])

  function stopRecording() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setRecording(false)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
    for (const track of recordStreamRef.current?.getTracks() ?? []) track.stop()
    recordStreamRef.current = null
  }

  async function finishRecording() {
    const elapsed = Date.now() - recordStartRef.current
    const chunks = recordChunksRef.current
    const mime = chunks[0]?.type || "audio/webm"
    recorderRef.current = null
    if (elapsed < MIN_RECORD_MS || chunks.length === 0) {
      if (elapsed >= 150) onError("hold the mic while speaking")
      return
    }
    const blob = new Blob(chunks, { type: mime })
    setTranscribing(true)
    try {
      const form = new FormData()
      form.append(
        "audio",
        new File([blob], "speech.webm", { type: blob.type || "audio/webm" }),
      )
      const response = await fetch("/api/stt", { method: "POST", body: form })
      const body = (await response.json().catch(() => ({}))) as {
        text?: string
        error?: string
      }
      if (!response.ok) {
        throw new Error(body.error ?? "transcription failed")
      }
      const transcript = (body.text ?? "").trim()
      if (!transcript) {
        onError("nothing audible was picked up — hold the mic and speak")
        return
      }
      const next = draftRef.current
        ? `${draftRef.current} ${transcript}`
        : transcript
      updateDraft(next)
      messageInputRef.current?.focus()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "transcription failed")
    } finally {
      setTranscribing(false)
    }
  }

  async function startRecording() {
    if (recording || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordStreamRef.current = stream
      recordChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data)
      })
      recorder.addEventListener("stop", () => {
        void finishRecording()
      })
      recorder.start()
      recordStartRef.current = Date.now()
      setRecordMs(0)
      setRecording(true)
      recordTimerRef.current = setInterval(() => {
        const ms = Date.now() - recordStartRef.current
        setRecordMs(ms)
        if (ms >= MAX_RECORD_MS) stopRecording()
      }, 200)
    } catch {
      onError("microphone unavailable — allow mic access for this page")
    }
  }

  function persistDraftNow(text: string) {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current)
      writeTimer.current = null
    }
    writeDraft(localStorage, sessionId, text)
  }

  function updateDraft(text: string) {
    draftRef.current = text
    sharedDraftRef.current = text
    setDraft(text)
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null
      writeDraft(localStorage, sessionId, text)
    }, DRAFT_WRITE_DELAY)
  }

  // flush a pending draft write when leaving the thread or the page
  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current)
        writeTimer.current = null
        writeDraft(localStorage, sessionId, draftRef.current)
      }
    }
  }, [sessionId])

  function ensureSkills() {
    if (skillsRequestedRef.current) return
    skillsRequestedRef.current = true
    api<{ skills?: SkillSummary[] }>("/api/skills")
      .then((body) => setSkillList(body.skills ?? []))
      .catch(() => setSkillList([]))
  }

  const mentionSections = useMemo<RefSectionView[]>(
    () => [
      ...baseSections,
      ...(skillList.length
        ? [
            {
              key: "skills",
              label: "Skills",
              items: skillList.map(
                (skill): RefItemView => ({
                  id: skill.name,
                  name: skill.name,
                  description: skill.description,
                }),
              ),
            },
          ]
        : []),
      ...(projects.length
        ? [
            {
              key: "projects",
              label: "Projects",
              items: projects.map(
                (project): RefItemView => ({
                  id: project.id,
                  name: project.name,
                  description: project.path,
                }),
              ),
            },
          ]
        : []),
    ],
    [baseSections, skillList, projects],
  )
  const mentionKeys = useMemo(
    () => mentionSections.map((section) => section.key),
    [mentionSections],
  )
  const mention = useMemo(
    () => detectMention(draft, caret, mentionKeys),
    [draft, caret, mentionKeys],
  )
  const suggestions = useMemo(
    () => (mention ? mentionSuggestions(mention, mentionSections) : []),
    [mention, mentionSections],
  )
  const slashActive = useMemo(() => {
    if (!draft.startsWith("/") || draft.includes(" ") || draft.includes("\n")) {
      return null
    }
    const typed = draft.slice(1).toLowerCase()
    const matches = pluginCommands.filter((command) =>
      command.command.startsWith(typed),
    )
    return matches.length > 0 ? matches : null
  }, [draft, pluginCommands])

  function rememberDraft(text: string) {
    setMentionIndex(0)
    updateDraft(text)
  }

  function restoreCaret() {
    requestAnimationFrame(() => {
      const pos = pendingCaretRef.current
      if (pos === null) return
      pendingCaretRef.current = null
      const el = messageInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(pos, pos)
      }
      setCaret(pos)
    })
  }

  function acceptSuggestion(suggestion: Suggestion) {
    const el = messageInputRef.current
    const pos = el?.selectionStart ?? draftRef.current.length
    const active = detectMention(draftRef.current, pos, mentionKeys)
    if (!active) return
    const next =
      draftRef.current.slice(0, active.start) +
      suggestion.complete +
      draftRef.current.slice(pos)
    pendingCaretRef.current = active.start + suggestion.complete.length
    setMentionHidden(false)
    ensureSkills()
    onEnsureProjects()
    rememberDraft(next)
    restoreCaret()
  }

  function acceptCommand(command: {
    command: string
    title: string
    template: string
  }) {
    setSlashHidden(false)
    const marker = "{input}"
    const at = command.template.indexOf(marker)
    if (at === -1) {
      rememberDraft("")
      persistDraftNow("")
      void submitFlow(command.template)
      return
    }
    const rendered = command.template.replace(marker, "")
    rememberDraft(rendered)
    pendingCaretRef.current = at
    restoreCaret()
  }

  async function submitFlow(textOverride?: string) {
    const text = (textOverride ?? draft).trim()
    if (!text && joined.length === 0) return
    for (const validator of pluginValidators) {
      try {
        if (new RegExp(validator.pattern).test(text)) {
          onError(validator.message)
          return
        }
      } catch {
        // ignore malformed plugin patterns
      }
    }
    const sentText = text
    rememberDraft("")
    persistDraftNow("")
    const accepted = await onSubmit(sentText, joined)
    if (!accepted) {
      rememberDraft(sentText)
      persistDraftNow(sentText)
    }
  }

  async function addJoined(list: FileList | null) {
    if (!list?.length) return
    const next = [...joined]
    for (const file of list) {
      const problem = joinFileError(file, next.length)
      if (problem) {
        onError(problem)
        break
      }
      try {
        next.push(await readJoinedFile(file))
      } catch (caught) {
        onError(
          caught instanceof Error ? caught.message : "could not read that file",
        )
        break
      }
    }
    rememberJoined(next)
  }

  return (
    <>
      <Stack spacing={1} className="ob-input-row" sx={{ p: mobile ? 0.75 : 1 }}>
        {joined.length ? (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: "wrap", rowGap: 0.5 }}
          >
            {joined.map((file) => {
              const image = joinedImage(file)
              return (
                <Chip
                  key={file.id}
                  className={
                    image ? "ob-join-chip ob-join-chip-image" : "ob-join-chip"
                  }
                  title={file.name}
                  aria-label={file.name}
                  avatar={
                    image ? (
                      <img className="ob-join-thumb" src={file.url} alt="" />
                    ) : undefined
                  }
                  onDelete={() =>
                    rememberJoined(joined.filter((item) => item.id !== file.id))
                  }
                >
                  {image ? null : file.name}
                </Chip>
              )
            })}
          </Stack>
        ) : null}
        {pluginButtons.length > 0 && running && !sending ? (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: "wrap", rowGap: 0.5 }}
          >
            {pluginButtons.map((button) => (
              <Chip
                key={`${button.plugin}:${button.id}`}
                label={button.label}
                size="small"
                variant="outlined"
                disabled={!running || sending || stopping}
                onClick={() => {
                  const template = button.template.replace(/\{input\}/g, "")
                  void submitFlow(template)
                }}
              />
            ))}
          </Stack>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <IconButton
            size="medium"
            aria-label="Attach file"
            disabled={!running || sending || stopping}
            onClick={(event) => {
              joinAnchor.current = event.currentTarget
              setJoinOpen(true)
            }}
            sx={{ flexShrink: 0 }}
          >
            <AttachFileIcon />
          </IconButton>
          <ToolTip
            title={recording ? "Release to transcribe" : "Hold to speak"}
          >
            <IconButton
              size="medium"
              aria-label={recording ? "Release to transcribe" : "Hold to speak"}
              disabled={!running || sending || stopping || transcribing}
              sx={{
                flexShrink: 0,
                touchAction: "none",
                ...(recording
                  ? {
                      bgcolor: "error.main",
                      color: "error.contrastText",
                      animation: "ob-pulse 1.2s ease-in-out infinite",
                    }
                  : {}),
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                void startRecording()
              }}
              onPointerUp={(event) => {
                event.preventDefault()
                if (recording) stopRecording()
              }}
              onPointerLeave={() => {
                if (recording) stopRecording()
              }}
              onPointerCancel={() => {
                if (recording) stopRecording()
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {transcribing ? (
                <CircularProgress size={1.1} />
              ) : recording ? (
                <StopIcon />
              ) : (
                <MicIcon />
              )}
            </IconButton>
          </ToolTip>
          {recording ? (
            <Typography
              variant="caption"
              color="error"
              sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {Math.floor(recordMs / 1000)}s
            </Typography>
          ) : null}
          <ToolTip
            title={
              readAloud
                ? "Read replies out loud: on"
                : "Read replies out loud: off"
            }
          >
            <IconButton
              size="medium"
              aria-label="Read replies out loud"
              aria-pressed={readAloud}
              disabled={!running && !readAloud}
              onClick={() => {
                onToggleReadAloud()
              }}
              sx={{
                flexShrink: 0,
                ...(readAloud
                  ? { bgcolor: "primary.main", color: "primary.contrastText" }
                  : {}),
              }}
            >
              {readAloud ? <VolumeUpIcon /> : <VolumeOffIcon />}
            </IconButton>
          </ToolTip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={pluginAccept || undefined}
            onChange={(event) => {
              void addJoined(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
          />
          <Box sx={{ position: "relative", flex: 1, minWidth: 0 }}>
            <ReferenceOverlay
              text={draft}
              projects={projects}
              inputRef={messageInputRef}
            />
            <TextField
              label="Message"
              value={draft}
              multiline
              ref={messageInputRef}
              disabled={!running || sending || stopping}
              onFocus={() => onEnsureProjects()}
              onChange={(event) => {
                const el = event.currentTarget
                setMentionHidden(false)
                setSlashHidden(false)
                if (slashIndex !== 0) setSlashIndex(0)
                if (mentionIndex !== 0) setMentionIndex(0)
                if (el.value.includes("@")) {
                  ensureSkills()
                  onEnsureProjects()
                }
                rememberDraft(el.value)
                setCaret(el.selectionStart ?? el.value.length)
              }}
              onClick={(event) =>
                setCaret(event.currentTarget.selectionStart ?? 0)
              }
              onKeyUp={(event) =>
                setCaret(event.currentTarget.selectionStart ?? 0)
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (slashActive && !slashHidden) {
                  const last = slashActive.length - 1
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setSlashIndex((index) => (index + 1 > last ? 0 : index + 1))
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    setSlashIndex((index) => (index - 1 < 0 ? last : index - 1))
                    return
                  }
                  if (event.key === "Tab" || event.key === "Enter") {
                    event.preventDefault()
                    const picked = slashActive[Math.min(slashIndex, last)]
                    if (picked) acceptCommand(picked)
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setSlashHidden(true)
                    return
                  }
                }
                if (mention && !mentionHidden && suggestions.length) {
                  const last = suggestions.length - 1
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setMentionIndex((index) =>
                      index + 1 > last ? 0 : index + 1,
                    )
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    setMentionIndex((index) =>
                      index - 1 < 0 ? last : index - 1,
                    )
                    return
                  }
                  if (event.key === "Tab" || event.key === "Enter") {
                    event.preventDefault()
                    const picked = suggestions[Math.min(mentionIndex, last)]
                    if (picked) acceptSuggestion(picked)
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setMentionHidden(true)
                    return
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  if (canStop) onStop()
                  else void submitFlow()
                }
              }}
              sx={{ flex: 1 }}
            />
            {mention && !mentionHidden && !sending && !stopping ? (
              <Paper
                elevation={8}
                sx={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  right: 0,
                  maxHeight: 264,
                  overflowY: "auto",
                  zIndex: 3,
                }}
              >
                <List dense disablePadding>
                  {suggestions.length ? (
                    suggestions.map((suggestion, index) => (
                      <ListItemButton
                        key={suggestion.key}
                        selected={index === mentionIndex}
                        onClick={() => acceptSuggestion(suggestion)}
                      >
                        <ListItemText
                          primary={suggestion.primary}
                          secondary={suggestion.secondary}
                        />
                      </ListItemButton>
                    ))
                  ) : (
                    <ListItemButton disabled>
                      <ListItemText
                        primary={
                          mention.stage === "name"
                            ? `No ${mention.section} match`
                            : "No section match"
                        }
                      />
                    </ListItemButton>
                  )}
                </List>
              </Paper>
            ) : null}
            {slashActive && !slashHidden && !sending && !stopping ? (
              <Paper
                elevation={8}
                sx={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  right: 0,
                  maxHeight: 264,
                  overflowY: "auto",
                  zIndex: 3,
                }}
              >
                <List dense disablePadding>
                  {slashActive.map((command, index) => (
                    <ListItemButton
                      key={`${command.plugin}:${command.command}`}
                      selected={index === slashIndex}
                      onClick={() => acceptCommand(command)}
                    >
                      <ListItemText
                        primary={`/${command.command}`}
                        secondary={`${command.title} — ${command.plugin}`}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>
            ) : null}
          </Box>
          {canStop ? (
            mobile ? (
              <IconButton
                size="medium"
                aria-label="Stop"
                disabled={stopping || stopBusy}
                onClick={onStop}
                sx={{
                  flexShrink: 0,
                  bgcolor: "error.main",
                  color: "error.contrastText",
                }}
              >
                <StopIcon />
              </IconButton>
            ) : (
              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                disabled={stopping || stopBusy}
                onClick={onStop}
              >
                Stop
              </Button>
            )
          ) : mobile ? (
            <IconButton
              size="medium"
              aria-label="Send message"
              disabled={
                !running ||
                sending ||
                stopping ||
                (!draft.trim() && joined.length === 0)
              }
              onClick={() => void submitFlow()}
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
              onClick={() => void submitFlow()}
              disabled={
                !running ||
                sending ||
                stopping ||
                (!draft.trim() && joined.length === 0)
              }
            >
              {sending ? "…" : "Send"}
            </Button>
          )}
        </Stack>
      </Stack>
      <Menu
        open={joinOpen}
        anchorEl={joinAnchor}
        onClose={() => setJoinOpen(false)}
      >
        <ListItemButton
          onClick={() => {
            setJoinOpen(false)
            fileInputRef.current?.click()
          }}
        >
          <AttachFileIcon />
          <ListItemText primary="Join a file" />
        </ListItemButton>
      </Menu>
    </>
  )
}

export function Workspace({ me }: { me: Me }) {
  const [phase, setPhase] = useState<Phase>(me.desktop ?? "sleeping")
  const [stopping, setStopping] = useState(false)
  const [tab, setTab] = useState("chat")
  const [error, setError] = useState("")
  const [projectList, setProjectList] = useState<ProjectMention[]>([])
  const projectsRequestedRef = useRef(false)
  const [sessionId, setSessionId] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [mediaMap, setMediaMap] = useState<MediaMap>(new Map())
  const draftRef = useRef("")
  const draftSessionRef = useRef("")
  const joinedStore = useRef(new Map<string, JoinedFile[]>())
  const joinedSessionRef = useRef("")
  const joinedRef = useRef<JoinedFile[]>([])
  const [joined, setJoined] = useState<JoinedFile[]>([])
  const [sending, setSending] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)
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
  const [held, setHeld] = useState(false)
  const [holdOrigin, setHoldOrigin] = useState<"desktop" | "chat">("chat")
  const [dismissedHandoff, setDismissedHandoff] = useState("")
  const [controlBusy, setControlBusy] = useState(false)
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
  const [cronRunKind, setCronRunKind] = useState<"prompt" | "script" | "both">(
    "prompt",
  )
  const [cronScript, setCronScript] = useState("")
  const [cronEditId, setCronEditId] = useState<string | null>(null)
  const [notices, setNotices] = useState<CronNotice[]>([])
  const [cronResult, setCronResult] = useState<CronNotice | null>(null)
  const mobile = useMobile()

  // projects power @project(s)/ mentions in the composer and chat bubbles
  const ensureProjects = useCallback(() => {
    if (projectsRequestedRef.current) return
    projectsRequestedRef.current = true
    api<{ projects?: ProjectMention[] }>("/api/projects")
      .then((body) => setProjectList(body.projects ?? []))
      .catch(() => setProjectList([]))
  }, [])
  const { plugins: installedPlugins } = useInstalledPlugins()
  const pluginRenderers = useMemo(() => {
    const map = new Map<string, PluginRenderer>()
    for (const plugin of installedPlugins) {
      if (!plugin.enabled) continue
      for (const renderer of plugin.manifest.textbox?.renderers ?? []) {
        map.set(renderer.type, { title: renderer.title, spec: renderer.spec })
      }
    }
    return map
  }, [installedPlugins])
  const pluginCommands = useMemo(
    () =>
      installedPlugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          (plugin.manifest.textbox?.commands ?? []).map((command) => ({
            plugin: plugin.pluginId,
            ...command,
          })),
        ),
    [installedPlugins],
  )
  const pluginButtons = useMemo(
    () =>
      installedPlugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          (plugin.manifest.textbox?.buttons ?? []).map((button) => ({
            plugin: plugin.pluginId,
            ...button,
          })),
        ),
    [installedPlugins],
  )
  const pluginValidators = useMemo(
    () =>
      installedPlugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          (plugin.manifest.textbox?.validators ?? []).map((validator) => ({
            plugin: plugin.pluginId,
            ...validator,
          })),
        ),
    [installedPlugins],
  )
  const pluginAccept = useMemo(() => {
    for (const plugin of installedPlugins) {
      if (!plugin.enabled) continue
      const accept = plugin.manifest.textbox?.attachments?.accept ?? []
      if (accept.length > 0) return accept.join(",")
    }
    return ""
  }, [installedPlugins])
  const unread = useUnreadThreads()
  const outputRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messagesJsonRef = useRef("")
  const menuAnchor = useRef<HTMLElement | null>(null)
  const restoredRef = useRef(false)
  const stoppingRef = useRef(false)

  const running = phase === "running"
  const { live, subscribe } = useEventStream(running)
  const baseSections = useMemo<RefSectionView[]>(
    () => [
      {
        key: "personas",
        label: "Personas",
        items: personas.map(
          (persona): RefItemView => ({
            id: persona.id,
            name: persona.name,
            description: persona.builtin
              ? "built-in persona"
              : "custom persona",
          }),
        ),
      },
      {
        key: "cron",
        label: "Cron jobs",
        items: cronJobs.map(
          (job): RefItemView => ({
            id: job.id,
            name: job.name,
            description: `${job.enabled ? "" : "paused · "}${cronSchedule(job)}`,
          }),
        ),
      },
    ],
    [personas, cronJobs],
  )
  const activeThread = sessions.find((item) => item.id === sessionId)
  const unreadNotices = useMemo(
    () => notices.filter((notice) => !notice.viewedAt),
    [notices],
  )
  const showUnread = (id: string) =>
    unread.has(id) && !(tab === "chat" && id === sessionId && !document.hidden)
  const shown = useMemo(
    () =>
      transcriptBubbles(
        messages,
        receipts.filter((item) => item.sessionId === sessionId),
        mediaMap,
      ),
    [messages, receipts, sessionId, mediaMap],
  )
  const turnIssue = useMemo(() => turnError(messages), [messages])
  const activity = modelActivity({
    phase: stopping ? "sleeping" : phase,
    sending,
    status: sessionId ? sessionStatus[sessionId] : undefined,
    messages,
  })

  // Read-aloud: the browser fetches synthesized speech from the control plane
  // and plays it locally; the desktop never hears any of this.
  const [readAloud, setReadAloud] = useState(
    () => localStorage.getItem(READ_ALOUD_KEY) === "1",
  )
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)
  const [speechLoadingKey, setSpeechLoadingKey] = useState<string | null>(null)
  const speechInFlightRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      if (audio.src) URL.revokeObjectURL(audio.src)
      audioRef.current = null
    }
    setSpeakingKey(null)
  }, [])
  const speakText = useCallback(
    async (key: string, rawText: string) => {
      if (speechInFlightRef.current) return
      const text = speakableText(rawText).slice(0, 4000)
      if (!text) return
      stopSpeaking()
      speechInFlightRef.current = true
      setSpeechLoadingKey(key)
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? "read-aloud failed")
        }
        const blob = await response.blob()
        const audio = new Audio(URL.createObjectURL(blob))
        audioRef.current = audio
        audio.addEventListener("ended", () => {
          if (audioRef.current !== audio) return
          URL.revokeObjectURL(audio.src)
          audioRef.current = null
          setSpeakingKey(null)
        })
        setSpeakingKey(key)
        await audio.play()
      } catch (caught) {
        stopSpeaking()
        setError(caught instanceof Error ? caught.message : "read-aloud failed")
      } finally {
        speechInFlightRef.current = false
        setSpeechLoadingKey(null)
      }
    },
    [stopSpeaking],
  )
  const toggleReadAloud = useCallback(() => {
    setReadAloud((current) => {
      const next = !current
      localStorage.setItem(READ_ALOUD_KEY, next ? "1" : "0")
      if (!next) stopSpeaking()
      return next
    })
  }, [stopSpeaking])
  const lastSpokenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!readAloud) return
    let found: { id: string; text: string; completed: number } | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if ((message.info?.role ?? "") !== "assistant") continue
      const completed = message.info?.time?.completed
      if (!completed) continue
      found = {
        id: message.info?.id ?? `i${i}`,
        text: visibleText(message),
        completed,
      }
      break
    }
    if (!found) return
    if (lastSpokenRef.current === found.id) return
    lastSpokenRef.current = found.id
    // opening an old thread must not replay history
    if (Date.now() - found.completed > 30_000) return
    void speakText(found.id, found.text)
  }, [messages, readAloud, speakText])

  const threadBusy = useCallback(
    (id: string) => {
      const status = sessionStatus[id]
      return Boolean(status && status.type !== "idle")
    },
    [sessionStatus],
  )
  const canStop = Boolean(
    sessionId && running && !stopping && (sending || threadBusy(sessionId)),
  )
  // Auto-resume: only when a turn dies from a dropped connection. Provider
  // rejections (quota, spend caps) stay on the banner with their own text.
  // One automatic attempt per dead turn, throttled so a long outage cannot
  // create a retry loop; the banner keeps a manual Resume button.
  const resumeTriedRef = useRef<string | null>(null)
  const resumeBlockRef = useRef(0)
  const resumePromptRef = useRef<((text: string) => Promise<boolean>) | null>(
    null,
  )
  useEffect(() => {
    if (!turnIssue?.retryable || !turnIssue.messageId) return
    if (!sessionId || !running || sending || stopping) return
    if (threadBusy(sessionId)) return
    if (resumeTriedRef.current === turnIssue.messageId) return
    resumeTriedRef.current = turnIssue.messageId
    if (Date.now() < resumeBlockRef.current) return
    resumeBlockRef.current = Date.now() + RESUME_BLOCK_MS
    const timer = setTimeout(
      () => void resumePromptRef.current?.(RESUME_PROMPT),
      RESUME_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [
    turnIssue?.messageId,
    turnIssue?.retryable,
    sessionId,
    running,
    sending,
    stopping,
    threadBusy,
  ])
  const busyIds = useMemo(() => {
    const set = new Set<string>()
    for (const item of sessions) {
      if (threadBusy(item.id)) set.add(item.id)
    }
    return set
  }, [sessions, threadBusy])
  const personaLabel = useCallback(
    (id: string) => {
      const pid = threadPersona[id]
      if (!pid || pid === "assistant") return "Assistant"
      return (
        personas.find((item) => item.id === pid)?.name ??
        BUILTIN_PERSONA_NAMES[pid] ??
        pid
      )
    },
    [threadPersona, personas],
  )
  const bubbleKeys = useMemo(
    () =>
      shown.map(
        (entry, index) => entry.pendingId ?? messageKey(entry.message, index),
      ),
    [shown],
  )
  const lastHandoff = useMemo(
    () =>
      shown.reduce(
        (at, item, index) => (item.message.handoff ? index : at),
        -1,
      ),
    [shown],
  )
  const screenLive = screen?.sessionId === sessionId
  // a draft typed before any thread existed, handed to the composer on mount
  const migrateDraft =
    sessionId && !draftSessionRef.current ? draftRef.current : ""

  // stable identities so memoized bubbles skip re-renders while the
  // underlying handlers stay fresh
  const bubbleActionsRef = useRef({
    takeControl: () => {},
    screenDone: () => {},
  })
  const bubbleActions = useMemo(
    () => ({
      takeControl: () => bubbleActionsRef.current.takeControl(),
      screenDone: () => bubbleActionsRef.current.screenDone(),
    }),
    [],
  )
  const threadActionsRef = useRef({
    select: (_id: string) => {},
    menu: (_item: SessionInfo, _anchor: HTMLElement) => {},
    create: () => {},
  })
  const threadActions = useMemo(
    () => ({
      select: (id: string) => threadActionsRef.current.select(id),
      menu: (item: SessionInfo, anchor: HTMLElement) =>
        threadActionsRef.current.menu(item, anchor),
      create: () => threadActionsRef.current.create(),
    }),
    [],
  )
  bubbleActionsRef.current = {
    takeControl: () => void takeControl(),
    screenDone: () => void prompt("Done on the screen."),
  }
  threadActionsRef.current = {
    select: selectThread,
    menu: (item, anchor) => {
      menuAnchor.current = anchor
      setMenuThread(item)
    },
    create: () => {
      setNewPersonaId("assistant")
      setNewThreadOpen(true)
    },
  }

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
            (item) =>
              !item.parentID &&
              !item.title?.startsWith("cron-run:") &&
              !item.title?.startsWith("worker:"),
          )
          .sort((a, b) => threadCreated(b) - threadCreated(a)),
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
    if (phase === "running") return
    // Poll while starting, and on the Projects tab where IDE API calls wake
    // the desktop behind our back and the stream needs to catch up.
    if (phase !== "starting" && tab !== "projects") return
    const timer = setInterval(() => {
      void api<DesktopStatus>("/api/desktop")
        .then((status) => {
          if (status.error) {
            if (phase === "starting") {
              setPhase("sleeping")
              setError(status.error)
            }
          } else if (status.phase !== phase) {
            setPhase(status.phase)
          }
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [phase, tab])

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
    setMediaMap(new Map())
  }, [sessionId, running])

  const loadMedia = useCallback(async () => {
    if (!sessionId || !running) {
      setMediaMap(new Map())
      return
    }
    try {
      const res = await fetch(
        `/api/workspace/snapshots?sessionId=${encodeURIComponent(sessionId)}`,
      )
      if (!res.ok) return
      const body = (await res.json()) as {
        media?: { messageId: string; path: string; url: string }[]
      }
      const next = new Map<string, string>()
      for (const row of body.media ?? [])
        next.set(mediaKey(row.messageId, row.path), row.url)
      setMediaMap(next)
    } catch {
      // keep the previous map; live paths still render
    }
  }, [sessionId, running])

  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    void loadMedia()
  }, [loadMedia, live])

  const scheduleMediaLoad = useDebounced(() => void loadMedia(), 500)

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
    } finally {
      setMessagesLoading(false)
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

  const scheduleTick = useDebounced(() => void tick(), 250)

  useEffect(() => {
    if (!running) return
    return subscribe((event) => {
      const type = event.type ?? ""
      if (type === "session.stuck") {
        const props = event.properties as
          | { sessionID?: unknown; message?: unknown }
          | undefined
        const id = typeof props?.sessionID === "string" ? props.sessionID : ""
        if (id && id === sessionId) {
          setError(
            typeof props?.message === "string"
              ? props.message
              : "stopped a stuck command; the agent will wrap up.",
          )
        }
        return
      }
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
        writeDraft(localStorage, sessionId, "")
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
      if (type === "session.idle" && eventTouchesSession(event, sessionId)) {
        scheduleMediaLoad()
      }
    })
  }, [running, subscribe, sessionId, scheduleTick, scheduleMediaLoad])

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
      if (type === "session.deleted") {
        const props = event.properties as
          | { sessionID?: unknown; info?: { id?: unknown } }
          | undefined
        const id =
          typeof props?.info?.id === "string"
            ? props.info.id
            : typeof props?.sessionID === "string"
              ? props.sessionID
              : ""
        if (id) writeDraft(localStorage, id, "")
      }
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
      setMessagesLoading(true)
    }
  }, [running, sessions, sessionsLoading, sessionId])

  useEffect(() => {
    setNoticeFocus({ tab, sessionId })
  }, [tab, sessionId])

  useEffect(() => {
    const markSeen = () => {
      if (tab !== "chat" || !sessionId || document.hidden) return
      seenThread(sessionId)
    }
    markSeen()
    document.addEventListener("visibilitychange", markSeen)
    return () => document.removeEventListener("visibilitychange", markSeen)
  }, [tab, sessionId])

  useEffect(() => {
    return () => setNoticeFocus({ tab: "", sessionId: "" })
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ sessionId?: string }>).detail
        ?.sessionId
      if (!id) return
      setSessionId(id)
      setMessages([])
      setMessagesLoading(true)
      setTab("chat")
      if (mobile) setThreadsOpen(false)
    }
    window.addEventListener(OPEN_THREAD_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_THREAD_EVENT, onOpen)
  }, [mobile])

  // the composer owns the draft text; track which thread it belongs to so a
  // draft typed before a thread exists can migrate to the first thread
  useEffect(() => {
    draftSessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (joinedSessionRef.current === sessionId) return
    const previous = joinedSessionRef.current
    joinedSessionRef.current = sessionId
    joinedStore.current.set(previous, joinedRef.current)
    if (
      !previous &&
      sessionId &&
      joinedRef.current.length > 0 &&
      !joinedStore.current.has(sessionId)
    ) {
      joinedStore.current.set(sessionId, joinedRef.current)
      joinedStore.current.delete("")
      return
    }
    const next = joinedStore.current.get(sessionId) ?? []
    joinedRef.current = next
    setJoined(next)
  }, [sessionId])

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

  useEffect(() => {
    setHeld(false)
    setDismissedHandoff(
      sessionId
        ? (sessionStorage.getItem(`ob-screen-dismiss:${sessionId}`) ?? "")
        : "",
    )
    if (!running || !sessionId) return
    let cancelled = false
    void (async () => {
      try {
        const body = await api<{ held: boolean }>(
          `/api/desktop/screen/hold?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (cancelled || !body.held) return
        setHeld(true)
        const next = await api<{ sessionId: string; path: string }>(
          "/api/desktop/screen",
          {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          },
        )
        if (!cancelled) setScreen(next)
      } catch {
        // desktop may still be opening
      }
    })()
    return () => {
      cancelled = true
    }
  }, [running, sessionId])

  // A Desktop-tab hold ends on its own: leaving the tab or switching threads
  // hands the screen back silently, without a message to the thread.
  useEffect(() => {
    if (!held || holdOrigin !== "desktop" || controlBusy) return
    const holdSession = screen?.sessionId
    if (!holdSession) return
    if (tab === "desktop" && holdSession === sessionId) return
    let cancelled = false
    void (async () => {
      try {
        await api("/api/desktop/screen/hold", {
          method: "DELETE",
          body: JSON.stringify({ sessionId: holdSession }),
        })
      } catch {
        // control plane may be restarting; local state still resets below
      }
      if (cancelled) return
      setHeld(false)
      if (holdSession === sessionId) {
        const last = [...shown].reverse().find((entry) => entry.message.handoff)
        const stamp = last ? handoffStamp(last.message) : ""
        if (stamp) {
          sessionStorage.setItem(`ob-screen-dismiss:${sessionId}`, stamp)
          setDismissedHandoff(stamp)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, held, holdOrigin, sessionId, screen, shown, controlBusy])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shown, tab])

  function rememberJoined(next: JoinedFile[]) {
    joinedRef.current = next
    joinedStore.current.set(draftSessionRef.current, next)
    setJoined(next)
  }

  async function prompt(text: string, files: JoinedFile[] = []) {
    if ((!text && files.length === 0) || sending) return false
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
        files: files.map((file) => file.name),
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
        draftSessionRef.current = id
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
          parts: promptParts(text, files),
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
  resumePromptRef.current = prompt

  // sends one message; the composer owns draft/joined restore on failure
  async function submit(text: string, files: JoinedFile[]): Promise<boolean> {
    rememberJoined([])
    const accepted = await prompt(text, files)
    if (!accepted) rememberJoined(files)
    return accepted
  }

  function viewJobThreadNotices(id: string) {
    const job = cronJobs.find((item) => item.sessionId === id)
    if (!job) return
    for (const notice of notices) {
      if (notice.jobId === job.id && !notice.viewedAt)
        void markNoticesViewed({ id: notice.id })
    }
  }

  function selectThread(id: string) {
    if (id !== sessionId) {
      setSessionId(id)
      setMessages([])
      setMessagesLoading(true)
      localStorage.setItem(THREAD_KEY, id)
    }
    if (mobile) setThreadsOpen(false)
    viewJobThreadNotices(id)
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
      viewJobThreadNotices(target.id)
      writeDraft(localStorage, target.id, "")
      joinedStore.current.delete(target.id)
      seenThread(target.id)
      if (target.id === sessionId) {
        setSessionId("")
        setMessages([])
        setMessagesLoading(false)
        localStorage.removeItem(THREAD_KEY)
      }
      await loadThreads()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setActionBusy(false)
    }
  }

  async function stopThread() {
    if (!sessionId || stopBusy) return
    setStopBusy(true)
    setError("")
    try {
      await api(`/api/opencode/session/${sessionId}/abort`, { method: "POST" })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "stop failed")
    } finally {
      setStopBusy(false)
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

  async function takeControl() {
    if (!sessionId || !running || stopping || controlBusy || held) return
    setControlBusy(true)
    setError("")
    try {
      const next = await api<{ sessionId: string; path: string }>(
        "/api/desktop/screen/hold",
        {
          method: "POST",
          body: JSON.stringify({ sessionId }),
        },
      )
      setScreen(next)
      setHoldOrigin(tab === "desktop" ? "desktop" : "chat")
      setHeld(true)
      await api(`/api/opencode/session/${sessionId}/abort`, {
        method: "POST",
      }).catch(() => {})
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "could not take control",
      )
    } finally {
      setControlBusy(false)
    }
  }

  async function releaseControl(notify = true) {
    if (!sessionId || controlBusy) return
    const last = [...shown].reverse().find((entry) => entry.message.handoff)
    const stamp = last ? handoffStamp(last.message) : ""
    setControlBusy(true)
    setError("")
    try {
      await api("/api/desktop/screen/hold", {
        method: "DELETE",
        body: JSON.stringify({ sessionId }),
      })
      setHeld(false)
      if (stamp) {
        sessionStorage.setItem(`ob-screen-dismiss:${sessionId}`, stamp)
        setDismissedHandoff(stamp)
      }
      if (notify) {
        void prompt("Done on the screen. You have the desktop again.")
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "could not return control",
      )
    } finally {
      setControlBusy(false)
    }
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
    void loadCron()
    if (tab !== "cron") return
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
    async (body: { id: string }) => {
      setNotices((current) =>
        current.map((notice) =>
          notice.id === body.id && !notice.viewedAt
            ? { ...notice, viewedAt: Date.now() }
            : notice,
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

  function openNotice(notice: CronNotice) {
    void markNoticesViewed({ id: notice.id })
    setCronResult(notice)
  }

  function openJobResult(job: CronJobInfo) {
    const notice = notices.find((item) => item.jobId === job.id)
    if (notice) openNotice(notice)
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
    setCronRunKind(job?.runKind ?? "prompt")
    setCronScript(job?.script ?? "")
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
      script: cronScript.trim() || null,
      runKind: cronRunKind,
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

  const phaseColor = stopping
    ? "warning"
    : phase === "running"
      ? "success"
      : phase === "starting"
        ? "warning"
        : undefined

  return (
    <ProjectRefsContext.Provider value={projectList}>
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
        {unreadNotices[0] ? (
          <Alert
            severity="info"
            onClose={() =>
              void markNoticesViewed({ id: unreadNotices[0]?.id ?? "" })
            }
          >
            {unreadNotices.length > 1
              ? `${unreadNotices.length} cron jobs published results. Latest: ${unreadNotices[0].jobName}. `
              : `${unreadNotices[0].jobName} published results. `}
            {clipNoticeLine(unreadNotices[0].summary)}{" "}
            <Button size="small" onClick={() => openNotice(unreadNotices[0])}>
              View result
            </Button>
          </Alert>
        ) : null}

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          className="ob-mobile-bar ob-workspace-top"
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
                : tab === "projects"
                  ? "Projects"
                  : `Cron${unreadNotices.length ? ` (${unreadNotices.length})` : ""}`}
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
              {!threadsOpen && sessions.some((item) => showUnread(item.id)) ? (
                <span
                  className="ob-unread-dot"
                  role="img"
                  aria-label="Unread"
                />
              ) : null}
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
              <ThreadsPanel
                sessions={sessions}
                sessionId={sessionId}
                loading={sessionsLoading}
                mobile={mobile}
                open={threadsOpen}
                personaLabel={personaLabel}
                busyIds={busyIds}
                unread={unread}
                actionBusy={actionBusy}
                actions={threadActions}
              />
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
                  {canStop ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<StopIcon width={16} height={16} />}
                      disabled={stopBusy}
                      onClick={() => void stopThread()}
                      sx={{ ml: "auto" }}
                    >
                      Stop
                    </Button>
                  ) : null}
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
                    <Typography variant="subtitle1">
                      Desktop is asleep
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Start the desktop to chat with OpenCode.
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={<PlayArrowIcon />}
                      onClick={() => void start()}
                      sx={{ mt: 1 }}
                    >
                      Start desktop
                    </Button>
                  </Stack>
                ) : messagesLoading && shown.length === 0 ? (
                  <Stack
                    alignItems="center"
                    justifyContent="center"
                    sx={{ flex: 1, minHeight: 160 }}
                    spacing={1}
                  >
                    <Stack spacing={1} sx={{ width: "min(620px, 100%)" }}>
                      <Skeleton
                        key="bubble-user-0"
                        variant="rounded"
                        height={44}
                        width="42%"
                        sx={{ alignSelf: "flex-end" }}
                      />
                      <Skeleton
                        key="bubble-assistant-0"
                        variant="rounded"
                        height={72}
                        width="78%"
                      />
                      <Skeleton
                        key="bubble-user-1"
                        variant="rounded"
                        height={44}
                        width="30%"
                        sx={{ alignSelf: "flex-end" }}
                      />
                      <Skeleton
                        key="bubble-assistant-1"
                        variant="rounded"
                        height={56}
                        width="64%"
                      />
                      <Skeleton
                        key="bubble-assistant-2"
                        variant="rounded"
                        height={48}
                        width="56%"
                      />
                    </Stack>
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
                  shown.map((entry, index) => (
                    <MessageBubble
                      key={bubbleKeys[index]}
                      entry={entry}
                      index={index}
                      bubbleKey={bubbleKeys[index] ?? ""}
                      speechKey={speakingKey}
                      speechLoading={speechLoadingKey}
                      lastHandoff={lastHandoff}
                      held={held}
                      dismissedHandoff={dismissedHandoff}
                      screenLive={screenLive}
                      screenPath={screen?.path ?? ""}
                      screenError={screenError}
                      running={running}
                      sending={sending}
                      stopping={stopping}
                      controlBusy={controlBusy}
                      renderers={pluginRenderers}
                      onTakeControl={bubbleActions.takeControl}
                      onScreenDone={bubbleActions.screenDone}
                      onSpeak={speakText}
                      onStopSpeak={stopSpeaking}
                    />
                  ))
                )}
              </Box>
              {turnIssue && tab === "chat" ? (
                <Alert
                  severity={turnIssue.retryable ? "warning" : "error"}
                  sx={{ flexShrink: 0 }}
                  action={
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={sending || stopping}
                      onClick={() => void prompt(RESUME_PROMPT)}
                    >
                      Resume
                    </Button>
                  }
                >
                  {turnIssue.retryable
                    ? "Connection dropped mid-reply. OpenBot will retry automatically; you can also resume now."
                    : `Reply failed: ${turnIssue.detail}`}
                </Alert>
              ) : null}
              {held &&
              holdOrigin === "chat" &&
              screen?.sessionId === sessionId ? (
                <div className="ob-takeover">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" sx={{ flex: 1 }}>
                      You have the desktop
                    </Typography>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!running || sending || stopping || controlBusy}
                      onClick={() => void releaseControl()}
                    >
                      Done
                    </Button>
                  </Stack>
                  <VncFrame
                    title="your screen"
                    path={screen.path}
                    interactive
                  />
                </div>
              ) : null}
              <Divider />
              <Composer
                key={sessionId}
                sessionId={sessionId}
                running={running}
                sending={sending}
                stopping={stopping}
                stopBusy={stopBusy}
                canStop={canStop}
                mobile={mobile}
                joined={joined}
                rememberJoined={rememberJoined}
                onError={setError}
                onSubmit={submit}
                onStop={() => void stopThread()}
                baseSections={baseSections}
                pluginButtons={pluginButtons}
                pluginCommands={pluginCommands}
                pluginValidators={pluginValidators}
                pluginAccept={pluginAccept}
                readAloud={readAloud}
                onToggleReadAloud={toggleReadAloud}
                sharedDraftRef={draftRef}
                migrateDraft={migrateDraft}
                projects={projectList}
                onEnsureProjects={ensureProjects}
              />
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
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ flexWrap: "wrap", rowGap: 1 }}
              >
                <Typography
                  variant="caption"
                  color="textSecondary"
                  sx={{ flex: 1 }}
                >
                  {stopping
                    ? "Stopping the desktop…"
                    : held
                      ? "You have this screen. The agent is paused."
                      : `Screen for ${
                          sessions.find((item) => item.id === sessionId)
                            ?.title || "this thread"
                        }. View only until you take control.`}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!running || stopping || controlBusy}
                  onClick={() =>
                    void (held ? releaseControl(false) : takeControl())
                  }
                >
                  {held ? "Done" : "Take control"}
                </Button>
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
                    disabled={!screen || screen.sessionId !== sessionId || held}
                    onClick={() => {
                      if (!screen || screen.sessionId !== sessionId || held)
                        return
                      openVnc(screen.path, false)
                    }}
                  >
                    Pop out
                  </Button>
                </ToolTip>
              </Stack>
              {screen?.sessionId === sessionId ? (
                <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                  <VncFrame
                    key={`${screen.sessionId}-${desktopKey}-${held ? "held" : "view"}`}
                    title="desktop"
                    path={screen.path}
                    interactive={held}
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

        {/* Cron — mounted only while visible; jobs live in workspace state */}
        {tab === "cron" ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ flex: 1 }}
              >
                Prompt runs the agent. Script posts command output. Script then
                prompt gives that output to the agent.
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
                    Add one here, or ask the agent to schedule work with
                    ob-cron.
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
                        label={cronRunLabel(job.runKind)}
                      />
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
                      {notices.some(
                        (notice) => notice.jobId === job.id && !notice.viewedAt,
                      ) ? (
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
                      {job.runKind === "script" ? job.script : job.message}
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
                      {notices.some((notice) => notice.jobId === job.id) ? (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<ChatIcon />}
                          disabled={Boolean(cronBusyId)}
                          onClick={() => openJobResult(job)}
                        >
                          Result
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
        ) : null}

        {/* Projects */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: tab === "projects" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <MemoProjects subscribe={subscribe} />
        </Box>

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
                  primary={`Cron${unreadNotices.length ? ` (${unreadNotices.length})` : ""}`}
                />
              </ListItemButton>
              <ListItemButton
                selected={tab === "projects"}
                onClick={() => goTab("projects")}
              >
                <FolderIcon />
                <ListItemText primary="Projects" />
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
              <ModelSelect
                name="model-drawer"
                label={running ? "Model" : "Model (start desktop)"}
                models={models}
                value={model}
                disabled={!running || models.length === 0}
                userId={me.id}
                onSelect={selectModel}
              />
            )}
            {modelsError ? (
              <ToolTip title={modelsError}>
                <Chip size="small" color="error" variant="outlined">
                  {modelsError}
                </Chip>
              </ToolTip>
            ) : null}
            {running && !modelsLoading ? (
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={() => void loadModels()}
              >
                Reload model list
              </Button>
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

        {newThreadOpen ? (
          <Dialog open onClose={() => setNewThreadOpen(false)}>
            <DialogTitle>New thread</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                The personality stays for this thread. It cannot be changed
                later.
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
        ) : null}

        {renameTarget ? (
          <Dialog open onClose={() => setRenameTarget(null)}>
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
        ) : null}

        {deleteTarget ? (
          <Dialog open onClose={() => setDeleteTarget(null)}>
            <DialogTitle>Delete thread?</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                Deletes “{deleteTarget ? threadTitle(deleteTarget) : ""}” and
                all of its messages. This cannot be undone.
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
        ) : null}

        {cronAddOpen ? (
          <Dialog open onClose={() => setCronAddOpen(false)}>
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
                <Select
                  name="run"
                  label="Run as"
                  value={cronRunKind}
                  onSelect={(value) =>
                    setCronRunKind(value as "prompt" | "script" | "both")
                  }
                >
                  <option value="prompt">Prompt</option>
                  <option value="script">Script</option>
                  <option value="both">Script then prompt</option>
                </Select>
                {cronRunKind !== "script" ? (
                  <TextField
                    label="Message sent to the agent"
                    value={cronMessage}
                    multiline
                    rows={3}
                    onChange={(event) =>
                      setCronMessage(event.currentTarget.value)
                    }
                  />
                ) : null}
                {cronRunKind !== "prompt" ? (
                  <TextField
                    label="Script"
                    value={cronScript}
                    multiline
                    rows={4}
                    placeholder="bash /home/agent/workspace/check.sh"
                    onChange={(event) =>
                      setCronScript(event.currentTarget.value)
                    }
                  />
                ) : null}
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
                        onChange={(event) =>
                          setCronExpr(event.currentTarget.value)
                        }
                      />
                    ) : (
                      <TextField
                        label="Run at"
                        value={cronAt}
                        type="datetime-local"
                        onChange={(event) =>
                          setCronAt(event.currentTarget.value)
                        }
                      />
                    )}
                  </>
                )}
                {cronRunKind !== "script" ? (
                  <ModelSelect
                    name="cron-model"
                    label="Model"
                    models={models}
                    value={cronModel}
                    disabled={!running && models.length === 0 && !cronModel}
                    userId={me.id}
                    leading={{ id: "", title: "Desktop default" }}
                    onSelect={setCronModel}
                  />
                ) : null}
                {cronRunKind !== "script" ? (
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
                ) : null}
                <Typography variant="caption" color="textSecondary">
                  {cronRunKind === "script"
                    ? "Runs on the desktop in /home/agent/workspace. Output is posted to this job's thread."
                    : cronRunKind === "both"
                      ? "The script runs first. Its output is added to the prompt. The agent's result is posted to this job's thread."
                      : "The model and personality run the temporary session. The result is still posted to this job's thread."}
                  {cronRunKind !== "script" && !running
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
                  (cronRunKind !== "script" && !cronMessage.trim()) ||
                  (cronRunKind !== "prompt" && !cronScript.trim()) ||
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
        ) : null}

        {cronDeleteTarget ? (
          <Dialog open onClose={() => setCronDeleteTarget(null)}>
            <DialogTitle>Delete cron job?</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                Deletes “{cronDeleteTarget?.name ?? ""}” and its past results.
                It will never run again. This cannot be undone.
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
        ) : null}

        {cronResult ? (
          <Dialog open onClose={() => setCronResult(null)}>
            <DialogTitle>{cronResult.jobName ?? ""}</DialogTitle>
            <DialogContent>
              {cronResult.summary?.trim() ? (
                <div className="ob-md">
                  <ChatMarkdown text={cronResult.summary} />
                </div>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  No output.
                </Typography>
              )}
            </DialogContent>
            <DialogActions>
              <Button variant="text" onClick={() => setCronResult(null)}>
                Close
              </Button>
            </DialogActions>
          </Dialog>
        ) : null}
      </Stack>
    </ProjectRefsContext.Provider>
  )
}
