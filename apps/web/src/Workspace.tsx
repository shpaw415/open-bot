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
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import {
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import Markdown, { type Components, defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  api,
  clientId,
  type DesktopStatus,
  type Me,
  waitForDesktop,
} from "./api"
import { type AppEntry, filterApps } from "./app-launcher"
import type { CronJobInfo } from "./CronView"
import {
  ACTIVITY_LABEL,
  type ChatMessage,
  chatImageUrl,
  eventTouchesSession,
  handoffStamp,
  lastHandoffStamp,
  type MediaMap,
  mediaKey,
  modelActivity,
  nearBottom,
  type PluginCardBlock,
  previewFrameSrc,
  type SendReceipt,
  type SendStatus,
  showLivePreview,
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
import { Hardware } from "./Hardware"
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
  BugReportIcon,
  ChatIcon,
  CheckCircleIcon,
  CloseIcon,
  ComputerIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  MemoryIcon,
  MenuIcon,
  MicIcon,
  MoreVertIcon,
  OpenInNewIcon,
  PauseIcon,
  PhotoLibraryIcon,
  PlayArrowIcon,
  RefreshIcon,
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
import { MediaDownloadButton, MediaFullscreenButton } from "./MediaDownload"
import { MediaVault } from "./MediaVault"
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
  clampPreviewWidth,
  PreviewEmbed,
  PreviewOverlay,
  PreviewPane,
} from "./PreviewView"
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
import { Reports } from "./Reports"
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
type ReportMention = {
  plugin: string
  open: number
  total: number
}
type SessionInfo = {
  id: string
  title?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}
type SessionStatus = { type?: string }

type Phase = "starting" | "running" | "sleeping"
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

function messageKey(
  message: ChatMessage & { sentAt?: number | null },
  index: number,
): string {
  const id = message.info?.id
  if (id) return id
  const role = message.info?.role ?? "m"
  if (message.sentAt != null) return `${index}:${role}:${message.sentAt}`
  return `${index}:${role}:${visibleText(message).slice(0, 48)}`
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

function AppLauncher({
  sessionId,
  disabled,
  onError,
}: {
  sessionId: string
  disabled: boolean
  onError: (message: string) => void
}) {
  const [query, setQuery] = useState("")
  const [apps, setApps] = useState<AppEntry[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const loadedAtRef = useRef(0)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(
    async (force: boolean) => {
      if (!force && Date.now() - loadedAtRef.current < 30_000) return
      try {
        const body = await api<{ apps: AppEntry[] }>("/api/desktop/apps")
        setApps(body.apps)
        loadedAtRef.current = Date.now()
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    },
    [onError],
  )

  const suggestions = useMemo(() => filterApps(apps, query), [apps, query])

  const launch = useCallback(
    async (app: AppEntry) => {
      setOpen(false)
      setBusy(true)
      try {
        await api("/api/desktop/apps/launch", {
          method: "POST",
          body: JSON.stringify({ sessionId, appId: app.id }),
        })
        setQuery("")
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [sessionId, onError],
  )

  return (
    <Box
      ref={anchorRef}
      sx={{ display: "flex", gap: 0.5, alignItems: "center" }}
    >
      <TextField
        placeholder="Open app…"
        aria-label="Open app"
        value={query}
        disabled={disabled || busy}
        sx={{ width: 170 }}
        onFocus={() => {
          setOpen(true)
          void load(false)
        }}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setOpen(true)
          void load(false)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false)
          if (event.key === "ArrowDown") setOpen(true)
          if (event.key === "Enter" && suggestions[0] && !busy) {
            void launch(suggestions[0])
          }
        }}
      />
      <ToolTip
        title={
          suggestions[0]
            ? `Launch ${suggestions[0].name}`
            : "Type to pick an app"
        }
      >
        <Button
          size="small"
          variant="text"
          startIcon={busy ? <CircularProgress size={1} /> : <PlayArrowIcon />}
          disabled={disabled || busy || !suggestions[0]}
          onClick={() => {
            const app = suggestions[0]
            if (app) void launch(app)
          }}
        >
          Launch
        </Button>
      </ToolTip>
      <Menu
        open={open && suggestions.length > 0}
        anchorEl={anchorRef}
        onClose={() => setOpen(false)}
      >
        {suggestions.map((app) => (
          <ListItemButton key={app.id} onClick={() => void launch(app)}>
            <PlayArrowIcon />
            <ListItemText
              primary={app.name}
              secondary={app.name === app.id ? undefined : app.id}
            />
          </ListItemButton>
        ))}
      </Menu>
    </Box>
  )
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
        <div className="ob-media-wrap">
          {/* biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions */}
          <video src={src} controls preload="metadata" />
          <MediaDownloadButton src={src} />
          <MediaFullscreenButton src={src} alt={alt ?? ""} />
        </div>
      )
    }
    if (src.startsWith("/api/workspace/model3d") || /\.glb$/i.test(src)) {
      return <Model3dView src={src} alt={alt ?? ""} />
    }
    return (
      <div className="ob-media-wrap">
        <img src={src} alt={alt ?? ""} />
        <MediaDownloadButton src={src} />
        <MediaFullscreenButton src={src} alt={alt ?? ""} />
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

function Dock({
  target,
  children,
}: {
  target: HTMLElement | null
  children: ReactNode
}) {
  if (target) return createPortal(children, target)
  return children
}

function IdeThreadBar({
  sessions,
  sessionId,
  actionBusy,
  onSelect,
  onCreate,
}: {
  sessions: SessionInfo[]
  sessionId: string
  actionBusy: boolean
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{
        px: 1,
        py: 0.5,
        flexShrink: 0,
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Select
          name="ide-thread"
          label="Thread"
          value={sessionId}
          disabled={actionBusy || sessions.length === 0}
          onSelect={(id) => {
            if (id) onSelect(id)
          }}
        >
          {[
            <option key="none" value="">
              {sessions.length === 0 ? "No threads yet" : "Select a thread"}
            </option>,
            ...sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {threadTitle(item)}
              </option>
            )),
          ]}
        </Select>
      </Box>
      <ToolTip title="New thread">
        <IconButton
          size="small"
          aria-label="New thread"
          disabled={actionBusy}
          onClick={onCreate}
        >
          <AddIcon width={18} height={18} />
        </IconButton>
      </ToolTip>
    </Stack>
  )
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
  onScreenClose: () => void
  onOpenPreview: () => void
  previewLive: boolean
  previewOpened: boolean
  previewSrc: string
  previewError: string
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
  onScreenClose,
  onOpenPreview,
  previewLive,
  previewOpened,
  previewSrc,
  previewError,
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
            <MediaFullscreenButton src={src} />
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
                <Button size="small" variant="text" onClick={onScreenClose}>
                  Close
                </Button>
              </Stack>
            ) : null}
          </div>
        ) : null}
        {message.preview ? (
          <div className="ob-preview-note">
            {!previewLive ? (
              <Typography variant="body2" color="textSecondary">
                Preview is in a later reply.
              </Typography>
            ) : previewOpened ? (
              <Typography variant="body2" color="textSecondary">
                Preview is open.
              </Typography>
            ) : !running ? (
              <Typography variant="body2" color="textSecondary">
                Start the desktop to view this preview.
              </Typography>
            ) : previewSrc ? (
              <PreviewEmbed src={previewSrc} onOpen={onOpenPreview} />
            ) : (
              <Typography variant="body2" color="textSecondary">
                {previewError || "Opening preview…"}
              </Typography>
            )}
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
  reports,
  onEnsureReports,
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
  reports: ReportMention[]
  onEnsureReports: () => void
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
                  path: project.path,
                }),
              ),
            },
          ]
        : []),
      ...(reports.length
        ? [
            {
              key: "reports",
              label: "Plugin reports",
              items: reports.map(
                (report): RefItemView => ({
                  id: report.plugin,
                  name: report.plugin,
                  description:
                    report.open === report.total
                      ? `${report.open} open report${report.open === 1 ? "" : "s"}`
                      : `${report.open} open / ${report.total} total`,
                }),
              ),
            },
          ]
        : []),
    ],
    [baseSections, skillList, projects, reports],
  )
  const mention = useMemo(
    () => detectMention(draft, caret, mentionSections),
    [draft, caret, mentionSections],
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
    const active = detectMention(draftRef.current, pos, mentionSections)
    if (!active) return
    const next =
      draftRef.current.slice(0, active.start) +
      suggestion.complete +
      draftRef.current.slice(pos)
    pendingCaretRef.current = active.start + suggestion.complete.length
    setMentionHidden(false)
    ensureSkills()
    onEnsureProjects()
    onEnsureReports()
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
              sections={mentionSections}
              inputRef={messageInputRef}
            />
            <TextField
              label="Message"
              value={draft}
              multiline
              ref={messageInputRef}
              disabled={!running || sending || stopping}
              onFocus={() => {
                onEnsureProjects()
                onEnsureReports()
              }}
              onChange={(event) => {
                const el = event.currentTarget
                setMentionHidden(false)
                setSlashHidden(false)
                if (slashIndex !== 0) setSlashIndex(0)
                if (mentionIndex !== 0) setMentionIndex(0)
                if (el.value.includes("@")) {
                  ensureSkills()
                  onEnsureProjects()
                  onEnsureReports()
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
  const [threadDock, setThreadDock] = useState<HTMLDivElement | null>(null)
  const onThreadDock = useCallback((el: HTMLDivElement | null) => {
    setThreadDock((current) => (current === el ? current : el))
  }, [])
  const [error, setError] = useState("")
  const [projectList, setProjectList] = useState<ProjectMention[]>([])
  const projectsRequestedRef = useRef(false)
  const [reportList, setReportList] = useState<ReportMention[]>([])
  const reportsRequestedRef = useRef(false)
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
  const [previewMode, setPreviewMode] = useState<"closed" | "pane" | "overlay">(
    "closed",
  )
  const [previewWidth, setPreviewWidth] = useState(() => {
    const raw = Number(sessionStorage.getItem("ob-preview-width"))
    return Number.isFinite(raw) && raw >= 280 ? raw : 520
  })
  const [previewFrame, setPreviewFrame] = useState<{ frameUrl: string } | null>(
    null,
  )
  const [previewError, setPreviewError] = useState("")
  const previewRowRef = useRef<HTMLDivElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(previewWidth)
  const [controlBusy, setControlBusy] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([])
  const mobile = useMobile()

  // projects power @project(s)/ mentions in the composer and chat bubbles
  const ensureProjects = useCallback(() => {
    if (projectsRequestedRef.current) return
    projectsRequestedRef.current = true
    api<{ projects?: ProjectMention[] }>("/api/projects")
      .then((body) => setProjectList(body.projects ?? []))
      .catch(() => setProjectList([]))
  }, [])
  // plugins with reports power @reports/ mentions in the composer
  const ensureReports = useCallback(() => {
    if (reportsRequestedRef.current) return
    reportsRequestedRef.current = true
    api<{ plugins?: ReportMention[] }>("/api/reports?status=all")
      .then((body) => setReportList(body.plugins ?? []))
      .catch(() => setReportList([]))
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

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "projects.changed") return
      projectsRequestedRef.current = true
      api<{ projects?: ProjectMention[] }>("/api/projects")
        .then((body) => setProjectList(body.projects ?? []))
        .catch(() => {})
    })
  }, [subscribe])
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
  const [dismissedTurnId, setDismissedTurnId] = useState("")
  const turnIssueKey = turnIssue ? turnIssue.messageId || turnIssue.detail : ""
  const visibleTurnIssue =
    turnIssue && turnIssueKey !== dismissedTurnId ? turnIssue : null
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
    if (turnIssueKey === dismissedTurnId) return
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
    turnIssueKey,
    dismissedTurnId,
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
  const lastPreview = useMemo(
    () =>
      shown.reduce(
        (at, item, index) => (item.message.preview ? index : at),
        -1,
      ),
    [shown],
  )
  const previewSrc =
    previewFrame && lastPreview >= 0
      ? previewFrameSrc(
          previewFrame.frameUrl,
          shown[lastPreview]?.message.previewPath || "/",
        )
      : ""
  const screenLive = screen?.sessionId === sessionId
  // a draft typed before any thread existed, handed to the composer on mount
  const migrateDraft =
    sessionId && !draftSessionRef.current ? draftRef.current : ""

  // stable identities so memoized bubbles skip re-renders while the
  // underlying handlers stay fresh
  const bubbleActionsRef = useRef({
    takeControl: () => {},
    screenDone: () => {},
    screenClose: () => {},
    openPreview: () => {},
  })
  const bubbleActions = useMemo(
    () => ({
      takeControl: () => bubbleActionsRef.current.takeControl(),
      screenDone: () => bubbleActionsRef.current.screenDone(),
      screenClose: () => bubbleActionsRef.current.screenClose(),
      openPreview: () => bubbleActionsRef.current.openPreview(),
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
    screenDone: () => {
      dismissScreen()
      void prompt("Done on the screen.")
    },
    screenClose: () => dismissScreen(),
    openPreview: () => {
      const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
      const next = clampPreviewWidth(widthRef.current, parent)
      widthRef.current = next
      setPreviewWidth(next)
      setPreviewMode(mobile ? "overlay" : "pane")
    },
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
            : "no providers connected — add one on the Config page"
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
      const payload = JSON.stringify(next)
      if (payload !== messagesJsonRef.current) {
        messagesJsonRef.current = payload
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the pane when the thread changes
  useEffect(() => {
    setPreviewMode("closed")
    setPreviewFrame(null)
    setPreviewError("")
  }, [sessionId])
  useEffect(() => {
    if (previewMode === "pane" && mobile) setPreviewMode("overlay")
    if (previewMode === "overlay" && !mobile) setPreviewMode("pane")
  }, [mobile, previewMode])
  useEffect(() => {
    if (previewMode === "closed") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return
      setPreviewMode("closed")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [previewMode])
  useEffect(() => {
    if (!running || !sessionId || lastPreview < 0) {
      setPreviewFrame(null)
      return
    }
    if (tab !== "chat") return
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const next = await api<{ frameUrl: string }>("/api/preview/frame", {
          method: "POST",
          body: JSON.stringify({ sessionId }),
        })
        if (cancelled) return
        setPreviewFrame(next)
        setPreviewError("")
      } catch (caught) {
        if (cancelled) return
        attempt += 1
        if (attempt < 5) {
          timer = setTimeout(() => void load(), 1000)
          return
        }
        setPreviewFrame(null)
        setPreviewError(
          caught instanceof Error
            ? caught.message
            : "could not open the preview",
        )
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [running, sessionId, lastPreview, tab])
  useEffect(() => {
    if (!previewSrc) return
    const timer = setInterval(() => {
      void fetch(previewSrc, { method: "HEAD" }).catch(() => {})
    }, 60_000)
    return () => clearInterval(timer)
  }, [previewSrc])
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
        const stamp = lastHandoffStamp(shown)
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
    if (turnIssue) setDismissedTurnId(turnIssue.messageId || turnIssue.detail)
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

  function selectThread(id: string) {
    if (id !== sessionId) {
      setSessionId(id)
      setMessages([])
      setMessagesLoading(true)
      localStorage.setItem(THREAD_KEY, id)
    }
    if (mobile) setThreadsOpen(false)
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

  function dismissScreen() {
    if (!sessionId) return
    const stamp = lastHandoffStamp(shown)
    if (!stamp) return
    sessionStorage.setItem(`ob-screen-dismiss:${sessionId}`, stamp)
    setDismissedHandoff(stamp)
  }

  async function releaseControl(notify = true) {
    if (!sessionId || controlBusy) return
    const stamp = lastHandoffStamp(shown)
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
  }, [loadCron, live])

  // @cron composer references stay fresh without the cron view
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "cron.changed") scheduleCron()
    })
  }, [subscribe, scheduleCron])

  // slow safety net while the event stream is down
  useEffect(() => {
    if (!running || live) return
    const timer = setInterval(() => {
      void tick()
      void loadThreads()
      void loadCron()
    }, 30_000)
    return () => clearInterval(timer)
  }, [running, live, tick, loadThreads, loadCron])

  function onPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startW = widthRef.current
    const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
    document.body.classList.add("ob-preview-dragging")
    const move = (next: PointerEvent) => {
      const width = clampPreviewWidth(startW - (next.clientX - startX), parent)
      widthRef.current = width
      setPreviewWidth(width)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("ob-preview-dragging")
      sessionStorage.setItem("ob-preview-width", String(widthRef.current))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function openPreviewFullscreen() {
    const el = previewPaneRef.current
    if (!el?.requestFullscreen) {
      setPreviewMode("overlay")
      return
    }
    void el.requestFullscreen().catch(() => setPreviewMode("overlay"))
  }

  function closePreview() {
    if (document.fullscreenElement) void document.exitFullscreen()
    setPreviewMode("closed")
  }

  const phaseColor = stopping
    ? "warning"
    : phase === "running"
      ? "success"
      : phase === "starting"
        ? "warning"
        : undefined
  const threadBar = useMemo(
    () => (
      <IdeThreadBar
        sessions={sessions}
        sessionId={sessionId}
        actionBusy={actionBusy}
        onSelect={threadActions.select}
        onCreate={threadActions.create}
      />
    ),
    [actionBusy, sessionId, sessions, threadActions],
  )
  const chatDocked = tab === "projects" && threadDock !== null

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
                : tab === "hardware"
                  ? "Hardware"
                  : tab === "projects"
                    ? "Projects"
                    : tab === "media"
                      ? "Media"
                      : "Reports"}
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
            ref={previewRowRef}
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
            <Dock target={chatDocked ? threadDock : null}>
              <Paper
                className={chatDocked ? "ob-chat-docked" : undefined}
                variant="outlined"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  height: chatDocked ? "100%" : undefined,
                  borderRadius: chatDocked ? 0 : undefined,
                  border: chatDocked ? "none" : undefined,
                  display: chatDocked
                    ? "flex"
                    : mobile && running && threadsOpen
                      ? "none"
                      : "flex",
                  flexDirection: "column",
                  overflow: chatDocked ? "hidden" : undefined,
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
                    {activity === "done" ? null : (
                      <CircularProgress size={1.2} />
                    )}
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
                        onScreenClose={bubbleActions.screenClose}
                        onOpenPreview={bubbleActions.openPreview}
                        previewLive={showLivePreview({
                          preview: Boolean(entry.message.preview),
                          isLast: index === lastPreview,
                        })}
                        previewOpened={previewMode !== "closed"}
                        previewSrc={previewSrc}
                        previewError={previewError}
                        onSpeak={speakText}
                        onStopSpeak={stopSpeaking}
                      />
                    ))
                  )}
                </Box>
                {visibleTurnIssue && (tab === "chat" || chatDocked) ? (
                  <Alert
                    severity={visibleTurnIssue.retryable ? "warning" : "error"}
                    sx={{ flexShrink: 0 }}
                    action={
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={sending || stopping}
                          onClick={() => void prompt(RESUME_PROMPT)}
                        >
                          Resume
                        </Button>
                        <IconButton
                          size="small"
                          aria-label="Close"
                          onClick={() => setDismissedTurnId(turnIssueKey)}
                        >
                          <CloseIcon width={18} height={18} />
                        </IconButton>
                      </Stack>
                    }
                  >
                    {visibleTurnIssue.retryable
                      ? "Connection dropped mid-reply. OpenBot will retry automatically; you can also resume now."
                      : `Reply failed: ${visibleTurnIssue.detail}`}
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
                        disabled={
                          !running || sending || stopping || controlBusy
                        }
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
                  reports={reportList}
                  onEnsureReports={ensureReports}
                />
              </Paper>
            </Dock>
            {previewMode === "pane" && previewSrc ? (
              <PreviewPane
                src={previewSrc}
                width={previewWidth}
                paneRef={previewPaneRef}
                onClose={closePreview}
                onFullscreen={openPreviewFullscreen}
                onDrag={onPreviewDrag}
              />
            ) : null}
          </Box>
        </Box>
        {previewMode === "overlay" && previewSrc ? (
          <PreviewOverlay src={previewSrc} onClose={closePreview} />
        ) : null}

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
                <AppLauncher
                  sessionId={sessionId}
                  disabled={!screen || screen.sessionId !== sessionId}
                  onError={setError}
                />
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

        {/* Projects */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: tab === "projects" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <MemoProjects
            subscribe={subscribe}
            threadBar={threadBar}
            onThreadDock={onThreadDock}
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: tab === "media" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <MediaVault subscribe={subscribe} />
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: tab === "hardware" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <Hardware />
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: tab === "reports" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <Reports subscribe={subscribe} />
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
                selected={tab === "hardware"}
                onClick={() => goTab("hardware")}
              >
                <MemoryIcon />
                <ListItemText primary="Hardware" />
              </ListItemButton>
              <ListItemButton
                selected={tab === "projects"}
                onClick={() => goTab("projects")}
              >
                <FolderIcon />
                <ListItemText primary="Projects" />
              </ListItemButton>
              <ListItemButton
                selected={tab === "media"}
                onClick={() => goTab("media")}
              >
                <PhotoLibraryIcon />
                <ListItemText primary="Media" />
              </ListItemButton>
              <ListItemButton
                selected={tab === "reports"}
                onClick={() => goTab("reports")}
              >
                <BugReportIcon />
                <ListItemText primary="Reports" />
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
      </Stack>
    </ProjectRefsContext.Provider>
  )
}
