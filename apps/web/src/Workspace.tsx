import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Divider from "@shpaw415/mui-lite/Divider"
import Drawer from "@shpaw415/mui-lite/Drawer"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Menu from "@shpaw415/mui-lite/Menu"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import {
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import Markdown, { type Components, defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import AgentOrb from "./AgentOrb"
import {
  api,
  clientId,
  type DesktopStatus,
  isTeamLockedError,
  type Me,
  waitForDesktop,
} from "./api"
import { type AppEntry, filterApps } from "./app-launcher"
import {
  type CouncilData,
  CouncilOverlay,
  CouncilPane,
  clampCouncilWidth,
} from "./CouncilView"
import type { CronJobInfo } from "./CronView"
import { orbState } from "./chat-controls"
import { ChatLink } from "./chat-link"
import {
  ACTIVITY_LABEL,
  applyMessageDelta,
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
import { Chip } from "./chip"
import { MarkdownCodeBlock } from "./code-copy"
import { ComposerPickers } from "./composer-controls"
import {
  clearComposerSeed,
  consumeComposerSeed,
  formatFrAgo,
  peekComposerSeed,
} from "./dashboard-data"
import { useOverlayA11y } from "./dialog-a11y"
import {
  blankDraftKey,
  clearBlankDraft,
  readBlankDraft,
  readDraft,
  writeBlankDraft,
  writeDraft,
} from "./draft"
import {
  useDebounced,
  useEventStream,
  useMobile,
  useUnreadThreads,
  useViewportBelow,
} from "./hooks"
import {
  AddIcon,
  AttachFileIcon,
  BlockIcon,
  BoltIcon,
  ChatIcon,
  CheckCircleIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ComputerIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  MicIcon,
  MoreVertIcon,
  OpenInNewIcon,
  PauseIcon,
  PlayArrowIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
  TimerIcon,
  TuneIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "./icons"
import { Projects } from "./ide/Projects"
import {
  type JoinedFile,
  joinedImage,
  pickJoinableFiles,
  promptParts,
  readJoinedFile,
} from "./join-file"
import { createLatestGuard } from "./latest-guard"
import { MediaDownloadButton, MediaFullscreenButton } from "./MediaDownload"
import { MediaVault } from "./MediaVault"
import { Model3dView } from "./Model3dView"
import {
  dropCachedMessages,
  getCachedMessages,
  putCachedMessages,
} from "./message-cache"
import {
  dropQueuedHead,
  enqueueQueued,
  MAX_QUEUED_MESSAGES,
  promoteQueued,
  type QueuedMessage,
  removeQueuedItem,
} from "./message-queue"
import {
  createSettingsSaver,
  type MeLike,
  type SettingsSaver,
} from "./model-effort"
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
import { type PluginCardSpec, PluginCards, usePlugins } from "./plugin-ui"
import {
  ProjectRefLink,
  ProjectRefsContext,
  remarkProjectRefs,
  useProjectRefs,
} from "./project-refs"
import ReferenceOverlay from "./ReferenceOverlay"
import {
  collectPluginMentionSources,
  detectMention,
  mentionSuggestions,
  type PluginMentionSource,
  type RefItemView,
  type RefSectionView,
  type SkillSummary,
  type Suggestion,
} from "./references"
import type { WorkspaceTab } from "./routes"
import Stack from "./stack"
import { Tip } from "./Tip"
import { STATES, THREAD, THREADS_UI } from "./texts"
import { expandFolder, parseCollapsedFolders } from "./thread-folders"

// the IDE keeps its own state; memo keeps workspace renders (streaming ticks,
// status polls) from re-rendering its whole tree
const MemoProjects = memo(Projects)

const BUILTIN_PERSONA_NAMES: Record<string, string> = {
  assistant: "Assistant",
  designer: "Designer",
  "political-expert": "Political expert",
  "software-designer": "Software designer",
}

type Model = {
  providerID: string
  modelID: string
  name?: string
  variants?: string[]
}
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
type PluginMention = {
  pluginId: string
  name: string
  description: string
  enabled: boolean
}
type SessionInfo = {
  id: string
  title?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}
type ThreadDirInfo = {
  id: string
  name: string
  createdAt: number
}
type SessionStatus = { type?: string }

const FOLDERS_COLLAPSED_KEY = "ob-thread-folders-collapsed"

type Phase = "starting" | "running" | "sleeping"
type LocalReceipt = SendReceipt & { sessionId: string }

function SendMark({ mark }: { mark: SendStatus }) {
  const label =
    mark === "sending"
      ? "Sending"
      : mark === "sent"
        ? "Sent"
        : mark === "queued"
          ? THREADS_UI.queued
          : "Not sent"
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
      ) : mark === "queued" ? (
        <TimerIcon width={16} height={16} />
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
        placeholder="Ouvrir une application…"
        aria-label="Ouvrir l’application"
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
      <Tip
        title={
          suggestions[0]
            ? `Launch ${suggestions[0].name}`
            : "Tapez pour choisir une application"
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
      </Tip>
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
  pre: MarkdownCodeBlock,
  a: ({ href, children, ...rest }) => {
    if (href?.startsWith("#project-ref/"))
      return <ProjectRefLink href={href}>{children}</ProjectRefLink>
    return (
      <ChatLink href={href} {...rest}>
        {children}
      </ChatLink>
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
  return session.title?.trim() || "Nouvelle conversation"
}

/** Sleep ends the whole environment; name the cost before cutting live work. */
function sleepBusyConfirmText(count: number): string {
  return `L’environnement complet sera mis en veille. ${count} conversation${
    count > 1 ? "s sont" : " est"
  } en cours de traitement — mettre en veille quand même?`
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
              {sessions.length === 0
                ? "Aucune conversation pour l’instant"
                : "Choisissez une conversation"}
            </option>,
            ...sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {threadTitle(item)}
              </option>
            )),
          ]}
        </Select>
      </Box>
      <Tip title="Nouvelle conversation">
        <IconButton
          size="small"
          aria-label="Nouvelle conversation"
          disabled={actionBusy}
          onClick={onCreate}
        >
          <AddIcon width={18} height={18} />
        </IconButton>
      </Tip>
    </Stack>
  )
}

/** fr-CA relative time via the shared Intl formatter (was EN "25h ago"). */
function formatAgo(ts: number): string {
  return formatFrAgo(ts)
}

function formatWhen(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("fr-CA", {
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
      return `tous les ${seconds / 86400} j`
    if (seconds >= 3600 && seconds % 3600 === 0)
      return `toutes les ${seconds / 3600} h`
    if (seconds >= 60 && seconds % 60 === 0)
      return `toutes les ${seconds / 60} min`
    return `toutes les ${seconds} s`
  }
  return `une fois, le ${formatWhen(job.atMs)}`
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
  onOpenCouncil: (name: string) => void
  onQueuedForce: (pendingId: string) => void
  onQueuedRemove: (pendingId: string) => void
  previewLive: boolean
  previewOpened: boolean
  previewSrc: string
  previewError: string
  councilOpened: boolean
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
  onOpenCouncil,
  onQueuedForce,
  onQueuedRemove,
  previewLive,
  previewOpened,
  previewSrc,
  previewError,
  councilOpened,
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
        // Geometry lives in app.css; only the user pill's theme tint is set
        // here so light/dark follow the palette in one place. Assistant
        // answers stay flat on the conversation surface.
        bgcolor: mine ? "primary.main" : undefined,
        color: mine ? "primary.contrastText" : "text.primary",
      }}
    >
      {mine && entry.mark ? <SendMark mark={entry.mark} /> : null}
      {mine && entry.mark === "queued" && entry.pendingId ? (
        <span className="ob-queued-actions">
          <Tip title={THREADS_UI.forceSend}>
            <IconButton
              size="small"
              aria-label={THREADS_UI.forceSend}
              onClick={() => onQueuedForce(entry.pendingId as string)}
              sx={{ color: "inherit" }}
            >
              <BoltIcon width={16} height={16} />
            </IconButton>
          </Tip>
          <Tip title={THREADS_UI.removeQueued}>
            <IconButton
              size="small"
              aria-label={THREADS_UI.removeQueued}
              onClick={() => onQueuedRemove(entry.pendingId as string)}
              sx={{ color: "inherit" }}
            >
              <CloseIcon width={16} height={16} />
            </IconButton>
          </Tip>
        </span>
      ) : null}
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
                      : screenError || "Ouverture de l’écran…"}
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
                  {THREADS_UI.takeControl}
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
        {message.council ? (
          <div className="ob-preview-note">
            {councilOpened ? (
              <Typography variant="body2" color="textSecondary">
                Council is open.
              </Typography>
            ) : !running ? (
              <Typography variant="body2" color="textSecondary">
                Start the desktop to view this council.
              </Typography>
            ) : (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onOpenCouncil(message.council)}
              >
                Open council
              </Button>
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
          <Tip
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
          </Tip>
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
  loadError,
  onRetryLoad,
  mobile,
  mid,
  open,
  personaLabel,
  busyIds,
  unread,
  actionBusy,
  selectMode,
  selectedIds,
  dirs,
  threadDirMap,
  notifyFocus,
  actions,
}: {
  sessions: SessionInfo[]
  sessionId: string
  loading: boolean
  /** Last load failure; a failed load never renders as "no threads". */
  loadError: string
  onRetryLoad: () => void
  /** Phone: the history takes the full width. */
  mobile: boolean
  /** Mid-width desktop: overlay panel with a capped width. */
  mid?: boolean
  open: boolean
  personaLabel: (id: string) => string
  busyIds: ReadonlySet<string>
  unread: ReadonlySet<string>
  actionBusy: boolean
  selectMode: boolean
  selectedIds: ReadonlySet<string>
  dirs: ThreadDirInfo[]
  threadDirMap: Record<string, string>
  notifyFocus: { sessionId: string; seq: number }
  actions: {
    select: (id: string) => void
    menu: (item: SessionInfo, anchor: HTMLElement) => void
    create: () => void
    newFolder: () => void
    createIn: (dirId: string) => void
    folderMenu: (dir: ThreadDirInfo, anchor: HTMLElement) => void
    move: (sessionId: string, dirId: string | null) => void
    toggleSelectMode: () => void
    toggleSelect: (id: string) => void
    selectAll: () => void
    requestBatchDelete: () => void
  }
}) {
  const allSelected = sessions.length > 0 && selectedIds.size >= sessions.length
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    parseCollapsedFolders(localStorage.getItem(FOLDERS_COLLAPSED_KEY)),
  )
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [threadQuery, setThreadQuery] = useState("")
  const query = threadQuery.trim().toLowerCase()
  const matchesQuery = (item: SessionInfo) =>
    !query ||
    threadTitle(item).toLowerCase().includes(query) ||
    personaLabel(item.id).toLowerCase().includes(query)
  const groups = useMemo(() => {
    const sections: {
      key: string
      label: string
      dir?: ThreadDirInfo
      items: SessionInfo[]
    }[] = [{ key: "", label: THREADS_UI.listTitle, items: [] }]
    for (const dir of dirs)
      sections.push({ key: dir.id, label: dir.name, dir, items: [] })
    for (const item of sessions) {
      const dirId = threadDirMap[item.id]
      const group =
        dirId && dirs.some((dir) => dir.id === dirId)
          ? sections.find((section) => section.key === dirId)
          : sections[0]
      ;(group ?? sections[0]).items.push(item)
    }
    return sections
  }, [sessions, dirs, threadDirMap])
  const groupActivity = useMemo(() => {
    const counts: Record<string, { unread: number; busy: number }> = {}
    for (const group of groups) counts[group.key] = { unread: 0, busy: 0 }
    for (const group of groups) {
      for (const item of group.items) {
        const entry = counts[group.key]
        if (!entry) continue
        if (unread.has(item.id) && !(item.id === sessionId && !document.hidden))
          entry.unread += 1
        if (busyIds.has(item.id)) entry.busy += 1
      }
    }
    return counts
  }, [groups, unread, busyIds, sessionId])
  const toggleCollapsed = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(FOLDERS_COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }
  // Only notification navigation reopens a collapsed folder (the notified
  // thread may sit inside one); collapsing the active thread's folder by hand
  // sticks across refreshes and thread switches. `seq` re-triggers per notice.
  const appliedFocusRef = useRef(0)
  useEffect(() => {
    if (!notifyFocus.seq || notifyFocus.seq === appliedFocusRef.current) return
    appliedFocusRef.current = notifyFocus.seq
    setCollapsed((current) => {
      const dirId = threadDirMap[notifyFocus.sessionId] ?? ""
      const next = expandFolder(current, dirId)
      if (next === current) return current
      localStorage.setItem(FOLDERS_COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [notifyFocus, threadDirMap])
  const dropToGroup = (key: string) => (event: React.DragEvent) => {
    event.preventDefault()
    const id =
      event.dataTransfer.getData("application/x-ob-thread") ||
      event.dataTransfer.getData("text/plain")
    setDragOver(null)
    if (id) actions.move(id, key || null)
  }
  const overGroup = (key: string) => (event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    if (dragOver !== key) setDragOver(key)
  }
  const renderRow = (item: SessionInfo) => (
    <Box
      key={item.id}
      draggable={!selectMode}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-ob-thread", item.id)
        event.dataTransfer.setData("text/plain", item.id)
        event.dataTransfer.effectAllowed = "move"
      }}
      onDragEnd={() => setDragOver(null)}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
      }}
    >
      {selectMode ? (
        <CheckBox
          checked={selectedIds.has(item.id)}
          aria-label={`Select ${threadTitle(item)}`}
          onClick={(event) => event.stopPropagation()}
          onChange={() => actions.toggleSelect(item.id)}
          sx={{ ml: 1.25, mr: 0.25 }}
        />
      ) : null}
      <ListItemButton
        selected={!selectMode && item.id === sessionId}
        onClick={() =>
          selectMode ? actions.toggleSelect(item.id) : actions.select(item.id)
        }
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
              <span className="ob-thread-title">{threadTitle(item)}</span>
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
      {selectMode ? null : (
        <IconButton
          size="small"
          aria-label={THREADS_UI.actionsFor(threadTitle(item))}
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
      )}
    </Box>
  )

  return (
    <Paper
      variant="outlined"
      sx={{
        // Give the chat room on small laptops: below 1200px the history is a
        // swap-in overlay, never a second permanent column.
        width: mobile
          ? "100%"
          : mid
            ? "min(360px, 100%)"
            : "clamp(240px, 24vw, 280px)",
        flexShrink: 0,
        minHeight: 0,
        display: (mobile || mid) && !open ? "none" : "flex",
        flexDirection: "column",
      }}
    >
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ px: 1.5, py: 0.75 }}
      >
        {selectMode ? (
          <>
            <CheckBox
              checked={allSelected}
              aria-label="Tout sélectionner"
              onChange={() => actions.selectAll()}
              sx={{ p: 0.5, mr: 0.5 }}
            />
            <Typography variant="subtitle2" component="p" sx={{ flex: 1 }}>
              {THREADS_UI.selectedCount(selectedIds.size)}
            </Typography>
            <Tip title="Supprimer la sélection">
              <IconButton
                size="small"
                aria-label="Supprimer la sélection"
                color="error"
                disabled={selectedIds.size === 0}
                onClick={actions.requestBatchDelete}
              >
                <DeleteIcon width={18} height={18} />
              </IconButton>
            </Tip>
            <Tip title="Annuler la sélection">
              <IconButton
                size="small"
                aria-label="Annuler la sélection"
                onClick={actions.toggleSelectMode}
              >
                <CloseIcon width={18} height={18} />
              </IconButton>
            </Tip>
          </>
        ) : (
          <>
            <Typography variant="subtitle2" component="h2" sx={{ flex: 1 }}>
              {THREADS_UI.listTitle}
            </Typography>
            <Tip title="Sélectionner les conversations">
              <IconButton
                size="small"
                aria-label="Sélectionner les conversations"
                disabled={actionBusy || sessions.length === 0}
                onClick={actions.toggleSelectMode}
              >
                <ChecklistIcon width={18} height={18} />
              </IconButton>
            </Tip>
            <Tip title="Nouveau dossier">
              <IconButton
                size="small"
                aria-label="Nouveau dossier"
                disabled={actionBusy}
                onClick={actions.newFolder}
              >
                <FolderIcon width={18} height={18} />
              </IconButton>
            </Tip>
            <Tip title="Nouvelle conversation">
              <IconButton
                size="small"
                aria-label="Nouvelle conversation"
                disabled={actionBusy}
                onClick={actions.create}
              >
                <AddIcon width={18} height={18} />
              </IconButton>
            </Tip>
          </>
        )}
      </Stack>
      {/* Search + new thread live under the header so they are identifiable
          controls, not small icon-only affordances. The filter is a compact
          native field (real placeholder + aria-label): mui-lite's floating
          label geometry broke below the input edge at this height. It
          filters the threads already loaded on this device; it is not a
          server search. */}
      {selectMode ? null : (
        <Box sx={{ px: 1, pt: 0.75, pb: 0.5 }}>
          <Stack spacing={0.75}>
            <label className="ob-filter-field">
              <SearchIcon width={14} height={14} />
              <input
                value={threadQuery}
                onChange={(event) => setThreadQuery(event.currentTarget.value)}
                placeholder="Filtrer les conversations chargées"
                aria-label="Filtrer les conversations chargées"
                type="search"
              />
              {threadQuery ? (
                <button
                  type="button"
                  className="ob-filter-clear"
                  aria-label="Effacer le filtre de conversations"
                  onClick={() => setThreadQuery("")}
                >
                  <CloseIcon width={13} height={13} />
                </button>
              ) : null}
            </label>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon width={16} height={16} />}
              disabled={actionBusy}
              onClick={actions.create}
              sx={{ justifyContent: "flex-start" }}
            >
              {THREADS_UI.newThread}
            </Button>
          </Stack>
        </Box>
      )}
      <Divider />
      <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {loading && sessions.length === 0 ? (
          <Stack spacing={1} sx={{ p: 1 }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : loadError && sessions.length === 0 ? (
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <Typography variant="body2" color="textSecondary">
              Impossible de charger vos conversations. Vos échanges n’ont pas
              été supprimés — l’environnement est peut-être en veille.
            </Typography>
            <Button size="small" variant="outlined" onClick={onRetryLoad}>
              Réessayer
            </Button>
          </Stack>
        ) : sessions.length === 0 ? (
          <Typography variant="body2" color="textSecondary" sx={{ p: 1.5 }}>
            Aucune conversation pour l’instant — envoyez un message ou créez-en
            une.
          </Typography>
        ) : (
          <List dense disablePadding>
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key)
              const dir = group.dir
              const activity = groupActivity[group.key] ?? {
                unread: 0,
                busy: 0,
              }
              const visibleItems = group.items.filter(matchesQuery)
              if (query && visibleItems.length === 0) return null
              return (
                <Box key={group.key || "unfiled"}>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    onDragOver={overGroup(group.key)}
                    onDragLeave={() =>
                      setDragOver((current) =>
                        current === group.key ? null : current,
                      )
                    }
                    onDrop={dropToGroup(group.key)}
                    sx={{
                      px: 1,
                      pt: 1,
                      pb: 0.5,
                      bgcolor:
                        dragOver === group.key ? "action.hover" : undefined,
                    }}
                  >
                    <IconButton
                      size="small"
                      aria-label={
                        isCollapsed
                          ? `Expand ${group.label}`
                          : `Collapse ${group.label}`
                      }
                      onClick={() => toggleCollapsed(group.key)}
                      sx={{ p: 0.25 }}
                    >
                      {isCollapsed ? (
                        <ChevronRightIcon width={14} height={14} />
                      ) : (
                        <ChevronDownIcon width={14} height={14} />
                      )}
                    </IconButton>
                    {dir ? (
                      <Box
                        Element="span"
                        aria-hidden
                        onClick={() => toggleCollapsed(group.key)}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        {isCollapsed ? (
                          <FolderIcon width={14} height={14} />
                        ) : (
                          <FolderOpenIcon width={14} height={14} />
                        )}
                      </Box>
                    ) : null}
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      onClick={() => toggleCollapsed(group.key)}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      {group.label} ({visibleItems.length})
                    </Typography>
                    {isCollapsed ? (
                      <>
                        {activity.unread > 0 ? (
                          <>
                            <span
                              className="ob-unread-dot"
                              role="img"
                              aria-label={`${activity.unread} unread`}
                            />
                            <Typography
                              variant="caption"
                              color="primary"
                              sx={{ flexShrink: 0, fontWeight: 600 }}
                            >
                              {activity.unread}
                            </Typography>
                          </>
                        ) : null}
                        {activity.busy > 0 ? (
                          <CircularProgress size={1.2} sx={{ flexShrink: 0 }} />
                        ) : null}
                      </>
                    ) : null}
                    {dir ? (
                      <>
                        <Tip title={THREADS_UI.newThreadIn(dir.name)}>
                          <IconButton
                            size="small"
                            aria-label={`New thread in ${dir.name}`}
                            disabled={actionBusy}
                            onClick={() => actions.createIn(dir.id)}
                            sx={{ p: 0.25 }}
                          >
                            <AddIcon width={14} height={14} />
                          </IconButton>
                        </Tip>
                        <Tip title={`Folder actions for ${dir.name}`}>
                          <IconButton
                            size="small"
                            aria-label={THREADS_UI.actionsForFolder(dir.name)}
                            onClick={(event) =>
                              actions.folderMenu(dir, event.currentTarget)
                            }
                            sx={{ p: 0.25 }}
                          >
                            <MoreVertIcon width={14} height={14} />
                          </IconButton>
                        </Tip>
                      </>
                    ) : null}
                  </Stack>
                  {isCollapsed
                    ? null
                    : query
                      ? visibleItems.map((item) => renderRow(item))
                      : group.items.map((item) => renderRow(item))}
                </Box>
              )
            })}
            {query &&
            groups.every(
              (group) => group.items.filter(matchesQuery).length === 0,
            ) ? (
              <Typography variant="body2" color="textSecondary" sx={{ p: 1.5 }}>
                No loaded threads match “{threadQuery.trim()}”.
              </Typography>
            ) : null}
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

// Keep the arrow-key highlighted popup row inside the scrollable popup view.
function scrollRowIntoView(list: HTMLElement | null, index: number) {
  if (!list) return
  const el = list.querySelectorAll("button")[index]
  if (!(el instanceof HTMLElement)) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight)
    list.scrollTop = bottom - list.clientHeight
}

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
  compact,
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
  plugins,
  pluginMentionSources,
  models,
  model,
  onModel,
  effort,
  effortSaving,
  onEffort,
  userId,
  modelsError,
  onReloadModels,
}: {
  sessionId: string
  running: boolean
  sending: boolean
  stopping: boolean
  stopBusy: boolean
  canStop: boolean
  mobile: boolean
  /** Narrow chat column (phone, or chat docked beside the IDE): the
      model/effort pickers move to their own designed second row. */
  compact: boolean
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
  plugins: PluginMention[]
  pluginMentionSources: PluginMentionSource[]
  models: Model[]
  model: string
  onModel: (value: string) => void
  effort: string
  effortSaving: boolean
  onEffort: (value: string) => void
  userId: string
  modelsError: string
  onReloadModels: () => void
}) {
  // An example chosen while a draft exists must never silently replace it:
  // the seed stays staged until the user picks "replace" or "keep" — the
  // hint below the composer. Peeking (not consuming) keeps that choice
  // stable across the composer's remounts.
  const [skippedSeed, setSkippedSeed] = useState(() => {
    if (sessionId) return ""
    const seed = peekComposerSeed()
    const stored =
      readDraft(localStorage, sessionId) || readBlankDraft(localStorage, userId)
    return stored && seed ? seed : ""
  })
  const [draft, setDraft] = useState(() => {
    const stored =
      readDraft(localStorage, sessionId) ||
      // A thread that does not exist server-side yet keeps its text under
      // the user-scoped blank key, so a detour through Home or Settings
      // never loses it.
      (!sessionId ? readBlankDraft(localStorage, userId) : "")
    if (stored) return stored
    // adopt a draft typed before this thread existed
    if (sessionId && migrateDraft) {
      writeDraft(localStorage, sessionId, migrateDraft)
      return migrateDraft
    }
    // a blank conversation can be seeded by an example chosen on Home —
    // consumed once, and never over a draft the user already has
    if (!sessionId) {
      const seed = consumeComposerSeed()
      if (seed) return seed
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

  // An explicit "Nouvelle conversation" lands ready to type: the blank view
  // focuses the composer (desktop only — a phone would pop the virtual
  // keyboard over the view it just reached).
  useEffect(() => {
    if (sessionId || mobile || running === false) return
    const timer = window.setTimeout(() => messageInputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [sessionId, mobile, running])

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
      const raw = await response.text().catch(() => "")
      let body: { text?: string; error?: string } = {}
      try {
        if (raw) body = JSON.parse(raw) as { text?: string; error?: string }
      } catch {
        body = {}
      }
      if (!response.ok) {
        throw new Error(
          body.error ||
            `transcription failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""})`,
        )
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
      onError(
        caught instanceof TypeError
          ? "could not reach the server — check your connection and try again"
          : caught instanceof Error
            ? caught.message
            : "transcription failed",
      )
    } finally {
      setTranscribing(false)
    }
  }

  async function startRecording() {
    if (recording || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      recordStreamRef.current = stream
      recordChunksRef.current = []
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined,
      )
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

  /** The draft's storage target: the thread, or the user-scoped blank slot. */
  function draftTarget(): string {
    return sessionId || blankDraftKey(userId)
  }

  function persistDraftNow(text: string) {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current)
      writeTimer.current = null
    }
    if (sessionId) writeDraft(localStorage, sessionId, text)
    else writeBlankDraft(localStorage, userId, text)
  }

  function updateDraft(text: string) {
    draftRef.current = text
    sharedDraftRef.current = text
    setDraft(text)
    if (writeTimer.current) clearTimeout(writeTimer.current)
    const target = draftTarget()
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null
      if (target.startsWith("ob-draft:blank:"))
        writeBlankDraft(localStorage, userId, text)
      else writeDraft(localStorage, target, text)
    }, DRAFT_WRITE_DELAY)
  }

  // flush a pending draft write when leaving the thread — or when the
  // document goes away. React cleanups never run on a full-page navigation,
  // reload or tab close, so the debounced write would die with the timer:
  // pagehide is the last reliable hook.
  useEffect(() => {
    const flush = () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current)
        writeTimer.current = null
        if (sessionId) writeDraft(localStorage, sessionId, draftRef.current)
        else writeBlankDraft(localStorage, userId, draftRef.current)
      }
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [sessionId, userId])

  function ensureSkills() {
    if (skillsRequestedRef.current) return
    skillsRequestedRef.current = true
    api<{ skills?: SkillSummary[] }>("/api/skills")
      .then((body) => setSkillList(body.skills ?? []))
      .catch(() => setSkillList([]))
  }

  const [pluginMentionItems, setPluginMentionItems] = useState<
    Record<string, RefItemView[]>
  >({})
  const pluginMentionFetchedAt = useRef<Record<string, number>>({})
  useEffect(() => {
    for (const source of pluginMentionSources) {
      delete pluginMentionFetchedAt.current[source.section]
    }
    pluginMentionFetchedAt.current = {}
    setPluginMentionItems({})
  }, [pluginMentionSources])

  function ensurePluginMentions() {
    const now = Date.now()
    for (const source of pluginMentionSources) {
      const at = pluginMentionFetchedAt.current[source.section] ?? 0
      if (now - at < 30_000) continue
      pluginMentionFetchedAt.current[source.section] = now
      const path = `/api/pages/${encodeURIComponent(source.pluginId)}${source.path}`
      api<{
        items?: { name?: unknown; description?: unknown; aliases?: unknown }[]
      }>(path)
        .then((body) => {
          const items = (Array.isArray(body.items) ? body.items : [])
            .slice(0, 100)
            .flatMap((entry): RefItemView[] => {
              if (typeof entry.name !== "string") return []
              const name = entry.name.replace(/\s+/g, " ").trim().slice(0, 80)
              if (!name) return []
              const aliases = (
                Array.isArray(entry.aliases) ? entry.aliases : []
              )
                .filter((alias): alias is string => typeof alias === "string")
                .map((alias) => alias.replace(/\s+/g, " ").trim().slice(0, 40))
                .filter(Boolean)
                .slice(0, 5)
              return [
                {
                  id: name,
                  name,
                  description:
                    typeof entry.description === "string"
                      ? entry.description
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 200)
                      : undefined,
                  aliases: aliases.length ? aliases : undefined,
                },
              ]
            })
          setPluginMentionItems((prev) => ({
            ...prev,
            [source.section]: items,
          }))
        })
        .catch(() => {
          pluginMentionFetchedAt.current[source.section] = 0
        })
    }
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
      ...(plugins.length
        ? [
            {
              key: "plugins",
              label: "Plugins",
              items: plugins.map(
                (plugin): RefItemView => ({
                  id: plugin.pluginId,
                  name: plugin.name,
                  description: plugin.enabled
                    ? plugin.description
                    : `disabled · ${plugin.description}`,
                }),
              ),
            },
          ]
        : []),
      ...pluginMentionSources.map((source) => ({
        key: source.section,
        label: source.label,
        items: pluginMentionItems[source.section] ?? [],
      })),
    ],
    [
      baseSections,
      skillList,
      projects,
      reports,
      plugins,
      pluginMentionSources,
      pluginMentionItems,
    ],
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
  const mentionListRef = useRef<HTMLDivElement | null>(null)
  const slashListRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    scrollRowIntoView(
      mentionListRef.current,
      Math.min(mentionIndex, suggestions.length - 1),
    )
  }, [mentionIndex, suggestions])
  useEffect(() => {
    scrollRowIntoView(
      slashListRef.current,
      Math.min(slashIndex, (slashActive?.length ?? 0) - 1),
    )
  }, [slashIndex, slashActive])

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
    ensurePluginMentions()
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

  async function addJoined(list: FileList | File[] | null) {
    // The input's FileList is a live view: clearing the input below would
    // empty it mid-loop, so snapshot before the first await.
    const { accepted, errors } = pickJoinableFiles(
      Array.from(list ?? []),
      joined.length,
    )
    for (const message of errors) onError(message)
    if (!accepted.length) return
    const next = [...joined]
    for (const file of accepted) {
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

  // A running turn no longer removes the Send button: sending joins the
  // waiting list, so Send and Stop coexist while busy.
  const sendDisabled =
    !running || sending || stopping || (!draft.trim() && joined.length === 0)
  const sendButton = mobile ? (
    <IconButton
      size="medium"
      aria-label={canStop ? THREADS_UI.queuedHint : "Envoyer le message"}
      disabled={sendDisabled}
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
      disabled={sendDisabled}
      sx={{ flexShrink: 0 }}
    >
      {sending ? "…" : "Envoyer"}
    </Button>
  )

  return (
    <>
      <Stack
        spacing={1}
        className="ob-input-row ob-composer"
        sx={{ p: mobile ? 0.75 : 1 }}
      >
        {modelsError ? (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ flexWrap: "wrap", rowGap: 0.5 }}
          >
            <Typography variant="caption" color="error" sx={{ flex: 1 }}>
              {modelsError}
            </Typography>
            {running ? (
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshIcon width={16} height={16} />}
                onClick={onReloadModels}
              >
                Reload
              </Button>
            ) : null}
          </Stack>
        ) : null}
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
        {!sessionId && skippedSeed ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            className="ob-status-row"
            sx={{ flexWrap: "wrap", rowGap: 0.5 }}
          >
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ flex: 1, minWidth: 160 }}
            >
              L’exemple a été ignoré pour préserver votre brouillon.
            </Typography>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                updateDraft(skippedSeed)
                clearComposerSeed()
                setSkippedSeed("")
                messageInputRef.current?.focus()
              }}
            >
              Remplacer par l’exemple
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                clearComposerSeed()
                setSkippedSeed("")
              }}
            >
              Garder mon brouillon
            </Button>
          </Stack>
        ) : null}
        <Box
          className="ob-composer-field"
          sx={{ position: "relative", width: "100%" }}
        >
          <ReferenceOverlay
            text={draft}
            sections={mentionSections}
            inputRef={messageInputRef}
          />
          {!draft ? (
            <div className="ob-composer-placeholder" aria-hidden="true">
              {running
                ? "Message OpenBot…"
                : "Démarrez l’environnement pour discuter"}
            </div>
          ) : null}
          <TextField
            aria-label="Message"
            value={draft}
            variant="standard"
            multiline={{ minRows: mobile ? 1 : 2, maxRows: 10 }}
            ref={messageInputRef}
            disabled={!running || sending || stopping}
            onFocus={() => {
              onEnsureProjects()
              onEnsureReports()
              ensurePluginMentions()
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
                ensurePluginMentions()
              }
              rememberDraft(el.value)
              setCaret(el.selectionStart ?? el.value.length)
            }}
            onClick={(event) =>
              setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onPaste={(event) => {
              const files = event.clipboardData?.files
              if (!files?.length) return
              event.preventDefault()
              void addJoined(files)
            }}
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
                  setMentionIndex((index) => (index + 1 > last ? 0 : index + 1))
                  return
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setMentionIndex((index) => (index - 1 < 0 ? last : index - 1))
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
              if (
                event.key === "Enter" &&
                !event.repeat &&
                !event.shiftKey &&
                // An IME composition confirms with Enter — never submit then.
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                // A running turn no longer hijacks Enter: the message joins
                // the waiting list. Stopping stays on the Stop button.
                void submitFlow()
              }
            }}
            sx={{ width: "100%" }}
          />
          {mention && !mentionHidden && !sending && !stopping ? (
            <Paper
              elevation={8}
              ref={mentionListRef}
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
                          : "Aucune section correspondante"
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
              ref={slashListRef}
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
        <Box className="ob-composer-actions">
          {/* Row 1 — designed, never wrapped by accident: secondary tools on
              the left, Send/Stop pinned to the right edge of the same row.
              Wide desks keep the pickers inline between the two. */}
          <Box className="ob-composer-row">
            <IconButton
              size="medium"
              aria-label="Ajouter un contexte"
              disabled={!running || sending || stopping}
              onClick={(event) => {
                joinAnchor.current = event.currentTarget
                setJoinOpen(true)
              }}
              sx={{ flexShrink: 0 }}
            >
              <AttachFileIcon />
            </IconButton>
            <Tip
              title={
                recording ? "Relâcher pour transcrire" : "Maintenir pour parler"
              }
            >
              <IconButton
                size="medium"
                aria-label={
                  recording
                    ? "Relâcher pour transcrire"
                    : "Maintenir pour parler"
                }
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
            </Tip>
            {recording ? (
              <Typography
                variant="caption"
                color="error"
                sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
              >
                {Math.floor(recordMs / 1000)}s
              </Typography>
            ) : null}
            <Tip
              title={
                readAloud
                  ? "Lire les réponses à voix haute : activé"
                  : "Lire les réponses à voix haute : désactivé"
              }
            >
              <IconButton
                size="medium"
                aria-label="Lire les réponses à voix haute"
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
            </Tip>
            <span className="ob-composer-row-space" style={{ flex: 1 }} />
            {compact ? null : (
              <ComposerPickers
                mobile={mobile}
                models={models}
                model={model}
                onModel={onModel}
                effort={effort}
                effortSaving={effortSaving}
                onEffort={onEffort}
                userId={userId}
                disabled={!running || sending || stopping}
                modelButtonId="ob-composer-model"
              />
            )}
            {canStop ? (
              mobile ? (
                <IconButton
                  size="medium"
                  aria-label={THREADS_UI.stopReplyAria}
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
                  sx={{ flexShrink: 0 }}
                >
                  {THREADS_UI.stopReply}
                </Button>
              )
            ) : null}
            {canStop ? (
              <Tip title={THREADS_UI.queuedHint}>{sendButton}</Tip>
            ) : (
              sendButton
            )}
          </Box>
          {/* Row 2 — only when the chat column is compact (phones, chat
              docked beside the IDE): model + effort get their own stable
              row instead of being squeezed into row 1. */}
          {compact ? (
            <Box className="ob-composer-row ob-composer-row-pickers">
              <ComposerPickers
                mobile={mobile}
                models={models}
                model={model}
                onModel={onModel}
                effort={effort}
                effortSaving={effortSaving}
                onEffort={onEffort}
                userId={userId}
                disabled={!running || sending || stopping}
                modelButtonId="ob-composer-model"
              />
            </Box>
          ) : null}
        </Box>
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
          <ListItemText primary="Joindre un fichier" />
        </ListItemButton>
        <ListItemButton
          onClick={() => {
            setJoinOpen(false)
            // Reuses the existing @mention contract: insert the trigger and
            // hand the pickers back to the composer, no new binding.
            const at =
              caret >= 0 && caret <= draft.length ? caret : draft.length
            const next = `${draft.slice(0, at)}@${draft.slice(at)}`
            updateDraft(next)
            const pos = at + 1
            setCaret(pos)
            window.setTimeout(() => {
              messageInputRef.current?.focus()
              messageInputRef.current?.setSelectionRange(pos, pos)
            }, 0)
          }}
        >
          <ListItemText
            primary="Ouvrir le sélecteur de contexte (@)"
            secondary="Liste les projets, fichiers et applications référençables — tapez ensuite pour filtrer"
          />
        </ListItemButton>
      </Menu>
    </>
  )
}

export function Workspace({
  me,
  tab,
  onTab,
  onMeRefreshed,
  blankChatRef,
}: {
  me: Me
  /** Active workspace view, owned by the shell's route. */
  tab: WorkspaceTab
  /** Move to another workspace view (the shell syncs the URL). */
  onTab: (next: WorkspaceTab) => void
  /** Push a refreshed profile up so Config and the shell stay in sync. */
  onMeRefreshed?: (me: Me) => void
  /**
   * Shell-owned "open a blank conversation" intent (R02). True from the
   * moment a "Nouvelle conversation" CTA is used until the user explicitly
   * opens a thread or the first send creates one; never cleared by a slow
   * history load or a phase transition. Survives StrictMode remounts
   * because the shell owns it, not storage consumed at mount time.
   */
  blankChatRef: { current: boolean }
}) {
  // Mid widths: the threads history becomes a temporary swap-in instead of a
  // second permanent column squeezing the composer (1024px laptops).
  const midWidth = useViewportBelow(1199)
  // Accessible dialog names: useId keeps ids unique if two instances ever
  // render side by side.
  const dialogIdBase = useId()
  const dialogIds = {
    renameThread: `${dialogIdBase}-rename-thread`,
    deleteThread: `${dialogIdBase}-delete-thread`,
    batchDelete: `${dialogIdBase}-batch-delete`,
    folder: `${dialogIdBase}-folder`,
    folderDelete: `${dialogIdBase}-folder-delete`,
  }
  const [phase, setPhase] = useState<Phase>(me.desktop ?? "sleeping")
  const [stopping, setStopping] = useState(false)
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
  // Per-thread waiting list: messages typed while a turn runs, flushed in
  // order when the session goes idle. In-memory only, like receipts.
  const [queuedBySession, setQueuedBySession] = useState<
    Record<string, QueuedMessage[]>
  >({})
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [threadsError, setThreadsError] = useState("")
  const [sessionStatus, setSessionStatus] = useState<
    Record<string, SessionStatus>
  >({})
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerPaperRef = useRef<HTMLDivElement | null>(null)
  // The model/desktop drawer shares the app-wide overlay contract: Escape
  // closes (top overlay only), focus enters the panel and returns to the
  // exact trigger, Tab stays confined. The Drawer's Paper is the dialog.
  useOverlayA11y(
    drawerOpen,
    useCallback(() => setDrawerOpen(false), []),
    drawerPaperRef,
  )
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [threadPersona, setThreadPersona] = useState<Record<string, string>>({})
  const [hasBlankDraft, setHasBlankDraft] = useState(() =>
    Boolean(readBlankDraft(localStorage, me.id)),
  )
  // Re-read whenever the visible thread changes: typing in the blank
  // composer (or sending, which clears the slot) is reflected here, so the
  // "Reprendre le brouillon" affordance only shows while a draft exists.
  useEffect(() => {
    setHasBlankDraft(Boolean(readBlankDraft(localStorage, me.id)))
  }, [me.id])
  const [newPersonaId, setNewPersonaId] = useState("assistant")
  const [menuThread, setMenuThread] = useState<SessionInfo | null>(null)
  const [dirs, setDirs] = useState<ThreadDirInfo[]>([])
  const [threadDirMap, setThreadDirMap] = useState<Record<string, string>>({})
  // set when a notice (bell or native) opens a thread; `seq` distinguishes
  // repeat notices for the same thread so the panel re-expands its folder
  const [notifyFocus, setNotifyFocus] = useState<{
    sessionId: string
    seq: number
  }>({ sessionId: "", seq: 0 })
  const [folderDialog, setFolderDialog] = useState<{
    mode: "create" | "rename"
    dir?: ThreadDirInfo
  } | null>(null)
  const [folderName, setFolderName] = useState("")
  const [folderDeleteTarget, setFolderDeleteTarget] =
    useState<ThreadDirInfo | null>(null)
  const [folderMenuDir, setFolderMenuDir] = useState<ThreadDirInfo | null>(null)
  const [moveMenuThread, setMoveMenuThread] = useState<SessionInfo | null>(null)
  const [newThreadDir, setNewThreadDir] = useState("")
  const [renameTarget, setRenameTarget] = useState<SessionInfo | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [threadSelectMode, setThreadSelectMode] = useState(false)
  const [selectedThreads, setSelectedThreads] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [batchTarget, setBatchTarget] = useState<string[] | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [models, setModels] = useState<Model[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState("")
  const [model, setModel] = useState(
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : "",
  )
  // Saved thinking effort for the current model; "" means model default.
  const [effort, setEffort] = useState(me.model?.thinkingEffort ?? "")
  const [effortSaving, setEffortSaving] = useState(false)
  // Model/effort writes are coordinated (serialized, per-channel staleness)
  // by the shared saver — see model-effort.ts for the contract.
  const settingsSaverRef = useRef<SettingsSaver | null>(null)
  const onMeRefreshedRef = useRef(onMeRefreshed)
  onMeRefreshedRef.current = onMeRefreshed
  if (!settingsSaverRef.current) {
    settingsSaverRef.current = createSettingsSaver({
      putModel: (key) =>
        api("/api/model", {
          method: "PUT",
          body: JSON.stringify({
            providerID: key.slice(0, key.indexOf("/")),
            modelID: key.slice(key.indexOf("/") + 1),
          }),
        }),
      putThinking: (value) =>
        api("/api/thinking", {
          method: "PUT",
          body: JSON.stringify({ effort: value }),
        }),
      fetchMe: () => api<MeLike>("/api/me"),
      adoptServer: (next) => {
        onMeRefreshedRef.current?.(next as Me)
        const info = next.model
        if (info?.providerID && info.modelID) {
          const key = `${info.providerID}/${info.modelID}`
          setModel((current) => (current === key ? current : key))
        }
        // While an effort save is still queued we keep the optimistic
        // value — the older /api/me snapshot must not clobber a pick the
        // queue has not written yet.
        if (!settingsSaverRef.current?.effortPending()) {
          const serverEffort = info?.thinkingEffort ?? ""
          setEffort((current) =>
            current === serverEffort ? current : serverEffort,
          )
        }
      },
      revertModel: (previous) => setModel(previous),
      revertEffort: (previous) => setEffort(previous),
      setEffortSaving,
      onError: setError,
      isTeamLocked: isTeamLockedError,
    })
  }
  const settingsSaver = settingsSaverRef.current
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
  const [councilMode, setCouncilMode] = useState<"closed" | "pane" | "overlay">(
    "closed",
  )
  const [councilWidth, setCouncilWidth] = useState(() => {
    const raw = Number(sessionStorage.getItem("ob-council-width"))
    return Number.isFinite(raw) && raw >= 280 ? raw : 420
  })
  const councilWidthRef = useRef(councilWidth)
  const councilPaneRef = useRef<HTMLDivElement>(null)
  const [councilName, setCouncilName] = useState("")
  const [councilData, setCouncilData] = useState<CouncilData | null>(null)
  const [councilError, setCouncilError] = useState("")
  const [councilMemberId, setCouncilMemberId] = useState("")
  const [controlBusy, setControlBusy] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([])
  const mobile = useMobile()
  // Threads history behavior: swap-in overlay on phones AND mid-width
  // desktops (single permanent history column only ≥1200px).
  const threadsOverlay = mobile || midWidth

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
  const { plugins: installedPlugins } = usePlugins()
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
  // installed plugins power @plugins/ mentions in the composer
  const pluginMentions = useMemo<PluginMention[]>(
    () =>
      installedPlugins.map((plugin) => ({
        pluginId: plugin.pluginId,
        name: plugin.name || plugin.pluginId,
        description: plugin.description,
        enabled: plugin.enabled,
      })),
    [installedPlugins],
  )
  const pluginMentionSources = useMemo(
    () => collectPluginMentionSources(installedPlugins),
    [installedPlugins],
  )
  const unread = useUnreadThreads()
  const outputRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  // Mirror of stickRef for rendering: the "jump to latest" pill shows while
  // the reader scrolled away from the bottom.
  const [atBottom, setAtBottom] = useState(true)
  const messagesJsonRef = useRef("")
  const messagesRef = useRef<ChatMessage[]>([])
  // Current-thread mirror for async guards: a tick or media load started for
  // one thread must never paint after the user switched to another — the
  // classic race shows the previous (often busy) thread's transcript under
  // the newly selected one.
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])
  // Separate guards per resource: a message tick must not invalidate an
  // in-flight media load (both fire together on session.idle), only a
  // newer load of the same kind does.
  const tickGuard = useRef(createLatestGuard())
  const mediaGuard = useRef(createLatestGuard())
  const menuAnchor = useRef<HTMLElement | null>(null)
  const restoredRef = useRef(false)
  // Set once the first history load COMPLETES (success or failure). The
  // restore decision must never run against a list that simply has not
  // arrived yet: sessionsLoading starts false, so gating on it alone let
  // the restore mark itself done against an empty list and never run again.
  const sessionsLoadedRef = useRef(false)
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
            description: `${job.enabled ? "" : "en pause · "}${cronSchedule(job)}`,
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
        (queuedBySession[sessionId] ?? []).map((item) => ({
          id: item.id,
          text: item.text,
          files: item.files.map((file) => file.name),
        })),
      ),
    [messages, receipts, sessionId, mediaMap, queuedBySession],
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
  // Waiting-list flush: when the session goes idle, the head of the queue
  // becomes the next prompt. One message per idle window — the guard
  // re-opens only once a real turn has been observed busy again (the flush
  // send's own `sending` window must not count), or shortly after, in case
  // a turn never surfaced in the status feed. A dead-turn banner (dropped
  // connection, provider error) holds the queue: the resume flow owns that
  // window, and flushing into it re-sent the same message mid-recovery.
  const flushBlockRef = useRef(false)
  const flushBlockSessionRef = useRef("")
  const [flushKick, setFlushKick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: prompt is a fresh closure each render by design; flushKick deliberately re-checks after the guard reopens
  useEffect(() => {
    if (!sessionId || !running || stopping) return
    if (flushBlockSessionRef.current !== sessionId) {
      flushBlockSessionRef.current = sessionId
      flushBlockRef.current = false
    }
    const queue = queuedBySession[sessionId] ?? []
    if (queue.length === 0) return
    if (turnIssue && turnIssueKey !== dismissedTurnId) return
    if (threadBusy(sessionId)) {
      flushBlockRef.current = false
      return
    }
    if (sending || flushBlockRef.current) return
    const head = queue[0]
    if (!head) return
    flushBlockRef.current = true
    setQueuedBySession((prev) => ({
      ...prev,
      [sessionId]: dropQueuedHead(prev[sessionId] ?? []),
    }))
    void prompt(head.text, head.files).then(() => {
      setTimeout(() => {
        flushBlockRef.current = false
        setFlushKick((kick) => kick + 1)
      }, 2500)
    })
  }, [
    sessionId,
    running,
    stopping,
    sending,
    threadBusy,
    queuedBySession,
    flushKick,
  ])
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
    openCouncil: (_name: string) => {},
    queuedForce: (_pendingId: string) => {},
    queuedRemove: (_pendingId: string) => {},
  })
  const bubbleActions = useMemo(
    () => ({
      takeControl: () => bubbleActionsRef.current.takeControl(),
      screenDone: () => bubbleActionsRef.current.screenDone(),
      screenClose: () => bubbleActionsRef.current.screenClose(),
      openPreview: () => bubbleActionsRef.current.openPreview(),
      openCouncil: (name: string) => bubbleActionsRef.current.openCouncil(name),
      queuedForce: (pendingId: string) =>
        bubbleActionsRef.current.queuedForce(pendingId),
      queuedRemove: (pendingId: string) =>
        bubbleActionsRef.current.queuedRemove(pendingId),
    }),
    [],
  )
  const threadActionsRef = useRef({
    select: (_id: string) => {},
    menu: (_item: SessionInfo, _anchor: HTMLElement) => {},
    create: () => {},
    newFolder: () => {},
    createIn: (_dirId: string) => {},
    folderMenu: (_dir: ThreadDirInfo, _anchor: HTMLElement) => {},
    move: (_sessionId: string, _dirId: string | null) => {},
    toggleSelectMode: () => {},
    toggleSelect: (_id: string) => {},
    selectAll: () => {},
    requestBatchDelete: () => {},
  })
  const threadActions = useMemo(
    () => ({
      select: (id: string) => threadActionsRef.current.select(id),
      menu: (item: SessionInfo, anchor: HTMLElement) =>
        threadActionsRef.current.menu(item, anchor),
      create: () => threadActionsRef.current.create(),
      newFolder: () => threadActionsRef.current.newFolder(),
      createIn: (dirId: string) => threadActionsRef.current.createIn(dirId),
      folderMenu: (dir: ThreadDirInfo, anchor: HTMLElement) =>
        threadActionsRef.current.folderMenu(dir, anchor),
      move: (sessionId: string, dirId: string | null) =>
        threadActionsRef.current.move(sessionId, dirId),
      toggleSelectMode: () => threadActionsRef.current.toggleSelectMode(),
      toggleSelect: (id: string) => threadActionsRef.current.toggleSelect(id),
      selectAll: () => threadActionsRef.current.selectAll(),
      requestBatchDelete: () => threadActionsRef.current.requestBatchDelete(),
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
    openCouncil: (name: string) => {
      const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
      const next = clampCouncilWidth(councilWidthRef.current, parent)
      councilWidthRef.current = next
      setCouncilWidth(next)
      setCouncilName(name)
      setCouncilMode(mobile ? "overlay" : "pane")
    },
    queuedForce: (pendingId) => void forceQueued(pendingId),
    queuedRemove: (pendingId) => removeQueuedMessage(pendingId),
  }
  threadActionsRef.current = {
    select: selectThread,
    menu: (item, anchor) => {
      menuAnchor.current = anchor
      setMenuThread(item)
    },
    create: () => startBlankThread(),
    newFolder: () => {
      setFolderName("")
      setFolderDialog({ mode: "create" })
    },
    createIn: (dirId) => startBlankThread(dirId),
    folderMenu: (dir, anchor) => {
      menuAnchor.current = anchor
      setFolderMenuDir(dir)
    },
    move: (id, dirId) => void moveThread(id, dirId),
    toggleSelectMode: () => {
      setThreadSelectMode((open) => !open)
      setSelectedThreads(new Set())
    },
    toggleSelect: (id) => {
      setSelectedThreads((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    selectAll: () => {
      setSelectedThreads((current) =>
        current.size >= sessions.length
          ? new Set()
          : new Set(sessions.map((item) => item.id)),
      )
    },
    requestBatchDelete: () => {
      const live = new Set(sessions.map((item) => item.id))
      const ids = [...selectedThreads].filter((id) => live.has(id))
      if (ids.length === 0) return
      setBatchTarget(ids)
    },
  }

  const loadThreads = useCallback(async () => {
    setThreadsError("")
    try {
      const [
        list,
        status,
        personaBody,
        assignmentBody,
        dirsBody,
        dirAssignBody,
      ] = await Promise.all([
        // The desktop routes start the desktop server-side (ensure), so a
        // failed poll here means "unavailable right now" — never an empty
        // list. The status is kept per-source and surfaced with a retry.
        fetch("/api/opencode/session").then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        }),
        fetch("/api/opencode/session/status").then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        }),
        // Auxiliary sources fail soft but NOT to empty: null keeps the last
        // good data on screen instead of wiping folders/personas/assignments
        // because one auxiliary request hiccuped.
        api<{ personas?: PersonaInfo[] }>("/api/personas").catch(() => null),
        api<{ threads?: { sessionId: string; personaId: string }[] }>(
          "/api/personas/threads",
        ).catch(() => null),
        api<{ dirs?: ThreadDirInfo[] }>("/api/thread-dirs").catch(() => null),
        api<{ threads?: { sessionId: string; dirId: string }[] }>(
          "/api/thread-dirs/assignments",
        ).catch(() => null),
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
      if (personaBody) setPersonas(personaBody.personas ?? [])
      if (assignmentBody) {
        const assigned: Record<string, string> = {}
        for (const row of assignmentBody.threads ?? []) {
          if (row.sessionId && row.personaId)
            assigned[row.sessionId] = row.personaId
        }
        setThreadPersona(assigned)
      }
      if (dirsBody) setDirs(dirsBody.dirs ?? [])
      if (dirAssignBody) {
        const dirAssigned: Record<string, string> = {}
        for (const row of dirAssignBody.threads ?? []) {
          if (row.sessionId && row.dirId) dirAssigned[row.sessionId] = row.dirId
        }
        setThreadDirMap(dirAssigned)
      }
    } catch (caught) {
      // desktop may have gone to sleep; the next tick retries — but the
      // failure is never rendered as "no conversations".
      setThreadsError(
        caught instanceof Error ? caught.message : "chargement impossible",
      )
    } finally {
      sessionsLoadedRef.current = true
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
    // Sleep stops the whole desktop — a busy conversation would be cut
    // mid-task. The scope is stated and confirmed only when work is live.
    if (busyIds.size > 0 && !window.confirm(sleepBusyConfirmText(busyIds.size)))
      return
    stoppingRef.current = true
    setStopping(true)
    setError("")
    try {
      await api("/api/desktop/stop", { method: "POST" })
      setPhase("sleeping")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Échec de l’arrêt")
    } finally {
      stoppingRef.current = false
      setStopping(false)
    }
  }

  // A remount (e.g. Workspace → Apps → Workspace) re-seeds the phase from the
  // page-load snapshot in me.desktop, which can be stale. Correct it once;
  // never clobber a start the user just clicked.
  useEffect(() => {
    let cancelled = false
    void api<DesktopStatus>("/api/desktop")
      .then((status) => {
        if (cancelled || status.error) return
        setPhase((current) => (current === "starting" ? current : status.phase))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (phase === "running") return
    // Poll while starting, while sleeping (a cron or webhook can wake the
    // desktop behind our back), and on the Projects tab where IDE API calls
    // wake it too. `/api/desktop` never wakes the desktop itself.
    const timer = setInterval(
      () => {
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
      },
      phase === "starting" ? 2000 : 10_000,
    )
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

  // event-driven refresh: the socket announces changes, we refetch lazily.
  // A cached transcript paints instantly; the fetch below still reconciles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs reset when the thread or desktop changes
  useEffect(() => {
    const cached = sessionId ? getCachedMessages(sessionId) : undefined
    if (cached) {
      messagesJsonRef.current = cached.payload
      setMessages(cached.messages)
      setMessagesLoading(false)
    } else {
      messagesJsonRef.current = ""
      setMessages([])
    }
    messagesRef.current = cached?.messages ?? []
    stickRef.current = true
    setAtBottom(true)
    setMediaMap(new Map())
  }, [sessionId, running])

  const loadMedia = useCallback(async () => {
    const id = sessionId
    if (!id || !running) {
      setMediaMap(new Map())
      return
    }
    const seq = mediaGuard.current.begin()
    try {
      const res = await fetch(
        `/api/workspace/snapshots?sessionId=${encodeURIComponent(id)}`,
      )
      if (!res.ok) return
      // A late response for the previous thread must not replace the
      // current thread's media map.
      if (!mediaGuard.current.isCurrent(seq) || sessionIdRef.current !== id)
        return
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
    const id = sessionId
    if (!id || !running) return
    const seq = tickGuard.current.begin()
    const isCurrent = () =>
      tickGuard.current.isCurrent(seq) && sessionIdRef.current === id
    try {
      const messageRes = await fetch(`/api/opencode/session/${id}/message`)
      const body = await messageRes.json()
      // A late response for the previous thread must not overwrite the
      // view, the message refs, or the delta upsert base (messagesRef).
      if (!isCurrent()) return
      const next = Array.isArray(body) ? body : []
      const payload = JSON.stringify(next)
      if (payload !== messagesJsonRef.current) {
        messagesJsonRef.current = payload
        messagesRef.current = next
        setMessages(next)
        putCachedMessages(id, payload, next)
      }
    } catch {
      return
    } finally {
      if (isCurrent()) setMessagesLoading(false)
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
        dropCachedMessages(sessionId)
        setQueuedBySession((prev) => {
          if (!prev[sessionId]?.length) return prev
          const next = { ...prev }
          delete next[sessionId]
          return next
        })
        setSessionId("")
        setMessages([])
        localStorage.removeItem(THREAD_KEY)
        return
      }
      // Live deltas replace the per-event full refetch: message/part events
      // upsert in place, anything uncertain falls back to a full tick.
      if (
        (type === "message.updated" || type === "message.part.updated") &&
        eventTouchesSession(event, sessionId)
      ) {
        const next = applyMessageDelta(messagesRef.current, event)
        if (next && next !== messagesRef.current) {
          messagesRef.current = next
          const payload = JSON.stringify(next)
          messagesJsonRef.current = payload
          putCachedMessages(sessionId, payload, next)
          setMessages(next)
        } else if (!next) {
          scheduleTick()
        }
        return
      }
      if (type === "message.removed" && eventTouchesSession(event, sessionId)) {
        scheduleTick()
        return
      }
      if (type === "session.idle" && eventTouchesSession(event, sessionId)) {
        scheduleTick()
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
        type === "session.deleted" ||
        type === "threads.changed"
      ) {
        scheduleThreads()
      }
    })
  }, [running, subscribe, scheduleThreads])

  useEffect(() => {
    if (!running || restoredRef.current || !sessionsLoadedRef.current) return
    restoredRef.current = true
    // An explicit "Nouvelle conversation" intent wins over every automatic
    // restore — phase changes, slow history, reconnections, refocus — until
    // the user picks a thread or the first send creates one. Plain /chat
    // visits restore normally once the intent is gone.
    if (blankChatRef.current && !sessionId) return
    const stored = localStorage.getItem(THREAD_KEY)
    if (stored && !sessionId && sessions.some((item) => item.id === stored)) {
      setSessionId(stored)
      setMessagesLoading(true)
    }
  }, [running, sessions, sessionId, blankChatRef])

  // The intent arrives while this Workspace instance stays mounted (the
  // Home detour is a tab switch, not an unmount): landing on the chat tab
  // with the intent active clears the view to a blank composer. Idempotent
  // under StrictMode; the intent itself persists in the shell until an
  // explicit selection or the first send clears it.
  useEffect(() => {
    if (tab !== "chat" || !blankChatRef.current || !sessionId) return
    setSessionId("")
    setMessages([])
    setMessagesLoading(false)
  }, [tab, sessionId, blankChatRef])

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
      // A voluntary open of a specific thread ends the blank intent.
      blankChatRef.current = false
      if (id === sessionId) {
        // Re-opening the visible thread: setSessionId would be a React
        // no-op, so neither the cache-paint effect nor the tick effect
        // re-runs — repaint from cache and force a reconciliation fetch.
        const cached = getCachedMessages(id)
        if (cached) {
          messagesJsonRef.current = cached.payload
          messagesRef.current = cached.messages
          setMessages(cached.messages)
          setMessagesLoading(false)
        }
        stickRef.current = true
        setAtBottom(true)
        scheduleTick()
      } else {
        setSessionId(id)
        setMessages([])
        setMessagesLoading(true)
        // Same last-open memory as an explicit list pick: a reload restores
        // the thread the user actually opened last, whatever the path.
        localStorage.setItem(THREAD_KEY, id)
      }
      setNotifyFocus((current) => ({ sessionId: id, seq: current.seq + 1 }))
      onTab("chat")
      if (mobile) setThreadsOpen(false)
    }
    window.addEventListener(OPEN_THREAD_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_THREAD_EVENT, onOpen)
  }, [sessionId, mobile, onTab, blankChatRef, scheduleTick])

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
    setCouncilMode("closed")
    setCouncilName("")
    setCouncilData(null)
    setCouncilError("")
    setCouncilMemberId("")
  }, [sessionId])
  useEffect(() => {
    if (previewMode === "pane" && mobile) setPreviewMode("overlay")
    if (previewMode === "overlay" && !mobile) setPreviewMode("pane")
    if (councilMode === "pane" && mobile) setCouncilMode("overlay")
    if (councilMode === "overlay" && !mobile) setCouncilMode("pane")
  }, [mobile, previewMode, councilMode])
  useEffect(() => {
    if (previewMode === "closed" && councilMode === "closed") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return
      setPreviewMode("closed")
      setCouncilMode("closed")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [previewMode, councilMode])
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

  // Council viewer: fetch membership for the open council and keep the rail
  // fresh as members appear or the council is closed by the agent.
  const loadCouncil = useCallback(async () => {
    if (!councilName) return
    try {
      const next = await api<CouncilData>(
        `/api/councils/${encodeURIComponent(councilName)}`,
      )
      setCouncilData(next)
      setCouncilError("")
      setCouncilMemberId((current) =>
        next.members.some((member) => member.sessionId === current) ||
        (next.subagents ?? []).some((sub) => sub.sessionId === current)
          ? current
          : (next.members[0]?.sessionId ?? ""),
      )
    } catch (caught) {
      setCouncilData(null)
      setCouncilError(
        caught instanceof Error ? caught.message : "could not open the council",
      )
    }
  }, [councilName])
  useEffect(() => {
    if (councilMode === "closed" || !running || !councilName) {
      setCouncilData(null)
      return
    }
    void loadCouncil()
  }, [councilMode, running, councilName, loadCouncil])
  const scheduleCouncilLoad = useDebounced(() => void loadCouncil(), 300)
  useEffect(() => {
    if (councilMode === "closed" || !councilName) return
    return subscribe((event) => {
      const type = event.type ?? ""
      if (
        type === "councils.changed" ||
        type === "session.created" ||
        type === "session.deleted"
      ) {
        scheduleCouncilLoad()
      }
    })
  }, [councilMode, councilName, subscribe, scheduleCouncilLoad])
  const councilStatusOf = useCallback(
    (id: string) => sessionStatus[id],
    [sessionStatus],
  )
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

  // Keep the jump honest: images, media, the screen/preview iframes, and
  // content-visibility layout estimates all change the transcript height
  // after the scroll above ran. While the reader stays at the bottom, re-pin.
  const logObserverRef = useRef<ResizeObserver | null>(null)
  const attachLogInner = useCallback((node: HTMLDivElement | null) => {
    logObserverRef.current?.disconnect()
    logObserverRef.current = null
    const el = outputRef.current
    if (!node || !el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return
      el.scrollTop = el.scrollHeight
    })
    observer.observe(node)
    logObserverRef.current = observer
  }, [])

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
          ? "L’environnement se met en veille. Attendez, puis renvoyez."
          : "L’environnement n’est pas prêt. Attendez qu’il fonctionne, puis renvoyez.",
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
    setAtBottom(true)
    setSending(true)
    try {
      if (!id) {
        const created = await api<{ id: string }>("/api/opencode/session", {
          method: "POST",
          // The blank composer's Assistant/Folder picks ride the same
          // session-create contract the old dialog used; "assistant"/no
          // folder send an empty body like before.
          body: blankSessionBody(),
        })
        id = created.id
        draftSessionRef.current = id
        // First accepted send: the blank intent ends exactly once, with the
        // session the composer text migrates into. The picks are consumed.
        blankChatRef.current = false
        setNewPersonaId("assistant")
        setNewThreadDir("")
        setHasBlankDraft(false)
        clearBlankDraft(localStorage, me.id)
        clearComposerSeed()
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
    // A running turn no longer blocks the composer: the message joins the
    // waiting list and the flush sends it when the turn ends. Queued
    // messages live ONLY in the queue state (the bubble renders from it) —
    // never as receipts — so nothing can orphan a ghost "En attente" bubble.
    if (sessionId && canStop) {
      const item = { id: clientId(), text, files }
      const result = enqueueQueued(queuedBySession[sessionId] ?? [], item)
      if (!result) {
        setError(THREADS_UI.queueFull(MAX_QUEUED_MESSAGES))
        rememberJoined(files)
        return false
      }
      if (!result.duplicate) {
        setQueuedBySession((prev) => {
          // Re-checked inside the updater so two rapid submits cannot
          // overwrite each other with a stale queue.
          const merged = enqueueQueued(prev[sessionId] ?? [], item)
          return merged && !merged.duplicate
            ? { ...prev, [sessionId]: merged.queue }
            : prev
        })
      }
      return true
    }
    const accepted = await prompt(text, files)
    if (!accepted) rememberJoined(files)
    return accepted
  }

  /**
   * Every "Nouvelle conversation" entry (thread list, drawer, folder "+",
   * search) lands on the same blank composer the Home/Help CTAs open through
   * the shell intent: a view, never a server-side row — the session is
   * created by the first send, which then carries the assistant/folder
   * picks. Idempotent: running it twice leaves the same blank view.
   */
  function startBlankThread(dirId = "") {
    blankChatRef.current = true
    setNewPersonaId("assistant")
    setNewThreadDir(dirId)
    if (sessionId) {
      setSessionId("")
      setMessages([])
      setMessagesLoading(false)
    }
    setError("")
    setThreadsOpen(false)
    setDrawerOpen(false)
    onTab("chat")
  }

  function selectThread(id: string) {
    if (id !== sessionId) {
      // An explicit pick from the history ends the blank intent.
      blankChatRef.current = false
      setSessionId(id)
      setMessages([])
      setMessagesLoading(true)
      localStorage.setItem(THREAD_KEY, id)
    } else {
      // Re-clicking the visible thread refreshes in place — the
      // sessionId effects never re-run for the same id.
      scheduleTick()
    }
    if (mobile) setThreadsOpen(false)
  }

  function goTab(next: WorkspaceTab) {
    onTab(next)
    setDrawerOpen(false)
  }

  function selectModel(value: string) {
    setModel(value)
    settingsSaver.selectModel({ value, previous: model })
  }

  function selectEffort(value: string) {
    setEffort(value)
    settingsSaver.selectEffort({ value, previous: effort })
  }

  // Follow server-side model/effort changes (Config page saves, admin
  // overlays) while no local save is queued or settling — otherwise the
  // optimistic picker state wins until its own response arrives.
  const serverModelKey =
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : ""
  const serverEffort = me.model?.thinkingEffort ?? ""
  useEffect(() => {
    if (settingsSaver.busy()) return
    setModel((current) =>
      !serverModelKey || current === serverModelKey ? current : serverModelKey,
    )
    setEffort((current) => (current === serverEffort ? current : serverEffort))
  }, [serverModelKey, serverEffort, settingsSaver])

  // Display name for a model key ("provider/id" → real name when known).
  function modelName(key: string): string {
    const found = models.find(
      (item) => `${item.providerID}/${item.modelID}` === key,
    )
    return found
      ? found.name
        ? `${found.name} (${found.providerID})`
        : key
      : key
  }

  function personaName(id: string | undefined): string {
    if (!id || id === "assistant") return "Assistant"
    return (
      personas.find((item) => item.id === id)?.name ??
      BUILTIN_PERSONA_NAMES[id] ??
      id
    )
  }

  /**
   * The blank composer's secondary picks (Assistant / Dossier), applied when
   * the first send creates the session — the same server contract the old
   * new-thread dialog used, but nothing exists server-side before an
   * explicit send.
   */
  function blankSessionBody(): string {
    return JSON.stringify({
      ...(newPersonaId && newPersonaId !== "assistant"
        ? { personaId: newPersonaId }
        : {}),
      ...(newThreadDir ? { dirId: newThreadDir } : {}),
    })
  }

  async function moveThread(id: string, dirId: string | null) {
    setError("")
    try {
      await api("/api/thread-dirs/assign", {
        method: "PUT",
        body: JSON.stringify({ sessionId: id, dirId }),
      })
      setThreadDirMap((current) => {
        const next = { ...current }
        if (dirId) next[id] = dirId
        else delete next[id]
        return next
      })
      await loadThreads()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Échec du déplacement",
      )
    }
  }

  async function saveFolder() {
    const name = folderName.trim()
    if (!folderDialog || !name || actionBusy) return
    setError("")
    setActionBusy(true)
    try {
      if (folderDialog.mode === "create") {
        await api("/api/thread-dirs", {
          method: "POST",
          body: JSON.stringify({ name }),
        })
      } else if (folderDialog.dir) {
        await api(`/api/thread-dirs/${folderDialog.dir.id}`, {
          method: "PUT",
          body: JSON.stringify({ name }),
        })
      }
      setFolderDialog(null)
      await loadThreads()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Échec de l’enregistrement du dossier",
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function removeFolder() {
    const dir = folderDeleteTarget
    if (!dir || actionBusy) return
    setError("")
    setActionBusy(true)
    try {
      await api(`/api/thread-dirs/${dir.id}`, { method: "DELETE" })
      setFolderDeleteTarget(null)
      await loadThreads()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Échec de la suppression du dossier",
      )
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
      setError(caught instanceof Error ? caught.message : "Échec du renommage")
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
      dropCachedMessages(target.id)
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
      setError(
        caught instanceof Error ? caught.message : "Échec de la suppression",
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function deleteThreadsBatch() {
    const ids = batchTarget
    if (!ids || ids.length === 0 || batchBusy) return
    setError("")
    setBatchBusy(true)
    setBatchProgress({ done: 0, total: ids.length })
    const activeId = sessionId
    const failed: string[] = []
    for (const [index, id] of ids.entries()) {
      try {
        await api(`/api/opencode/session/${id}`, { method: "DELETE" })
        writeDraft(localStorage, id, "")
        dropCachedMessages(id)
        joinedStore.current.delete(id)
        seenThread(id)
        if (id === activeId) {
          setSessionId("")
          setMessages([])
          setMessagesLoading(false)
          localStorage.removeItem(THREAD_KEY)
        }
      } catch {
        failed.push(id)
      }
      setBatchProgress({ done: index + 1, total: ids.length })
    }
    setBatchBusy(false)
    setBatchTarget(null)
    if (failed.length === 0) {
      setSelectedThreads(new Set())
      setThreadSelectMode(false)
    } else {
      setSelectedThreads(new Set(failed))
      if (failed.length === ids.length) setError("delete failed")
      else
        setError(
          `${ids.length - failed.length} sur ${ids.length} conversations supprimées — les autres ont échoué`,
        )
    }
    await loadThreads()
  }

  async function stopThread() {
    if (!sessionId || stopBusy) return
    setStopBusy(true)
    setError("")
    try {
      await api(`/api/opencode/session/${sessionId}/abort`, { method: "POST" })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Échec de l’arrêt")
    } finally {
      setStopBusy(false)
    }
  }

  // Force-send: jump the queue and interrupt the running turn; the idle
  // transition flushes the promoted message right away.
  async function forceQueued(pendingId: string) {
    if (!sessionId || !running || stopping || sending) return
    setQueuedBySession((prev) => ({
      ...prev,
      [sessionId]: promoteQueued(prev[sessionId] ?? [], pendingId),
    }))
    // A dead-turn banner holds the queue for the resume flow; forcing a
    // send is an explicit user decision that steps over it.
    if (turnIssue) setDismissedTurnId(turnIssue.messageId || turnIssue.detail)
    if (canStop) {
      try {
        await api(`/api/opencode/session/${sessionId}/abort`, {
          method: "POST",
        })
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Échec de l’arrêt")
      }
      return
    }
    // Already idle (e.g. a previous flush failed): reopen the window now.
    flushBlockRef.current = false
    setFlushKick((kick) => kick + 1)
  }

  function removeQueuedMessage(pendingId: string) {
    if (!sessionId) return
    setQueuedBySession((prev) => ({
      ...prev,
      [sessionId]: removeQueuedItem(prev[sessionId] ?? [], pendingId),
    }))
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

  function onCouncilDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startW = councilWidthRef.current
    const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
    document.body.classList.add("ob-preview-dragging")
    const move = (next: PointerEvent) => {
      const width = clampCouncilWidth(startW - (next.clientX - startX), parent)
      councilWidthRef.current = width
      setCouncilWidth(width)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("ob-preview-dragging")
      sessionStorage.setItem(
        "ob-council-width",
        String(councilWidthRef.current),
      )
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function openCouncilFullscreen() {
    const el = councilPaneRef.current
    if (!el?.requestFullscreen) {
      setCouncilMode("overlay")
      return
    }
    void el.requestFullscreen().catch(() => setCouncilMode("overlay"))
  }

  function closeCouncilPane() {
    if (document.fullscreenElement) void document.exitFullscreen()
    setCouncilMode("closed")
  }

  const phaseColor = stopping
    ? "warning"
    : phase === "running"
      ? "success"
      : phase === "starting"
        ? "warning"
        : undefined
  // Activity is only shown while it explains something: starting up or a
  // turn in flight. The completed state is the chat itself — a permanent
  // "Done" chip said nothing.
  const activeActivity = activity && activity !== "done" ? activity : null
  // Orb phase for the active turn: presentation only. Booting the desktop or
  // an accepted send waiting for events reads as "thinking"; live turn
  // activity reads as "working". The label stays the factual activity name.
  const orb = orbState(activeActivity, sending)
  const activityLabel = activeActivity ? ACTIVITY_LABEL[activeActivity] : ""
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
          sx={{ minHeight: 40, flexShrink: 0, pr: 0.5 }}
        >
          {/* The view's one heading. On the chat tab it always names the
              current context (thread, blank composer, or the view), so the
              outline never depends on a conversation being open — and it is
              never an empty heading on Desktop/Projects/Media, where each
              view carries its own title. Compact look, real h1/p element. */}
          <Typography
            variant="subtitle2"
            component={tab === "chat" ? "h1" : "p"}
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {/* Thread context only — Desktop/Projects/Media page names are
                already announced by the shell header; saying them here too
                repeated the page title at two levels. */}
            {tab === "chat"
              ? activeThread
                ? threadTitle(activeThread)
                : sessionId
                  ? THREAD.untitled
                  : THREADS_UI.listTitle
              : ""}
          </Typography>
          {mobile ? null : running ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={
                stopping ? <CircularProgress size={1.2} /> : <PauseIcon />
              }
              disabled={stopping}
              aria-busy={stopping}
              onClick={() => void sleep()}
            >
              {stopping ? "Mise en veille…" : "Mettre en veille"}
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              disabled={phase === "starting"}
              onClick={() => void start()}
            >
              Démarrer
            </Button>
          )}
          <IconButton
            size="small"
            aria-label={tab === "desktop" ? "Back to chat" : "Desktop"}
            color={tab === "desktop" ? "primary" : undefined}
            onClick={() => goTab(tab === "desktop" ? "chat" : "desktop")}
          >
            {tab === "desktop" ? <ChatIcon /> : <ComputerIcon />}
          </IconButton>
          {mobile ? (
            <IconButton
              size="small"
              aria-label={THREADS_UI.desktopOptions}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <TuneIcon />
            </IconButton>
          ) : null}
          <Chip size="small" color={phaseColor} sx={{ flexShrink: 0 }}>
            {stopping
              ? "mise en veille…"
              : phase === "starting"
                ? "démarrage…"
                : phase === "running"
                  ? "prêt"
                  : "en veille"}
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
          {running && threadsOverlay ? (
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
                {threadsOpen ? THREADS_UI.hideThreads : THREADS_UI.listTitle}
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
                {/* The thread title already sits in the top bar; this row
                    only adds the persona so nothing is said twice. */}
                {activeThread
                  ? personaName(threadPersona[activeThread.id])
                  : sessionId
                    ? "Nouvelle conversation"
                    : "Aucune conversation sélectionnée"}
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
                loadError={threadsError}
                onRetryLoad={() => void loadThreads()}
                mobile={mobile}
                mid={midWidth && !mobile}
                open={threadsOpen}
                personaLabel={personaLabel}
                busyIds={busyIds}
                unread={unread}
                actionBusy={actionBusy}
                selectMode={threadSelectMode}
                selectedIds={selectedThreads}
                dirs={dirs}
                threadDirMap={threadDirMap}
                notifyFocus={notifyFocus}
                actions={threadActions}
              />
            ) : null}
            <Dock target={chatDocked ? threadDock : null}>
              <Paper
                className={
                  chatDocked ? "ob-chat-paper ob-chat-docked" : "ob-chat-paper"
                }
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
                    : threadsOverlay && running && threadsOpen
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
                {/* A blank draft survives detours and reloads; when another
                    thread is open, the recovery stays one visible tap away —
                    never a hidden detour through Home. */}
                {sessionId && hasBlankDraft && running ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    className="ob-status-row"
                    sx={{ px: mobile ? 1 : 1.5, py: 0.5 }}
                  >
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      sx={{ flex: 1, minWidth: 0 }}
                    >
                      Un brouillon non envoyé est conservé sur cet appareil.
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => startBlankThread()}
                    >
                      Reprendre le brouillon
                    </Button>
                  </Stack>
                ) : null}
                {/* The blank view's secondary picks — the same
                    assistant/folder choice the old new-thread dialog owned.
                    They apply when the first send creates the session. */}
                {!sessionId && running ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{
                      px: mobile ? 1 : 1.5,
                      pt: 0.75,
                      flexWrap: "wrap",
                      rowGap: 0.5,
                    }}
                  >
                    <Typography variant="caption" color="textSecondary">
                      Assistant
                    </Typography>
                    <Select
                      name="blank-persona"
                      label=""
                      value={newPersonaId}
                      disabled={actionBusy}
                      sx={{ width: 190 }}
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
                    <Typography variant="caption" color="textSecondary">
                      Dossier
                    </Typography>
                    <Select
                      name="blank-folder"
                      label=""
                      value={newThreadDir}
                      disabled={actionBusy}
                      sx={{ width: 190 }}
                      onSelect={setNewThreadDir}
                    >
                      {[
                        <option key="none" value="">
                          Aucun dossier
                        </option>,
                        ...dirs.map((dir) => (
                          <option key={dir.id} value={dir.id}>
                            {dir.name}
                          </option>
                        )),
                      ]}
                    </Select>
                  </Stack>
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
                      {THREADS_UI.sleepStopping}
                    </Typography>
                  </Stack>
                ) : null}
                {stopping ? <Divider /> : null}
                <Box
                  className="ob-chat-log"
                  ref={outputRef}
                  onScroll={() => {
                    const el = outputRef.current
                    if (!el) return
                    const stick = nearBottom(
                      el.scrollHeight,
                      el.scrollTop,
                      el.clientHeight,
                    )
                    stickRef.current = stick
                    setAtBottom(stick)
                  }}
                >
                  {phase === "sleeping" ? (
                    <Stack
                      alignItems="center"
                      justifyContent="center"
                      sx={{ flex: 1, minHeight: 160, textAlign: "center" }}
                      spacing={1}
                    >
                      <Typography variant="subtitle1" component="p">
                        {THREADS_UI.screenAsleep}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {THREADS_UI.screenAsleepBody}
                      </Typography>
                      <Button
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                        onClick={() => void start()}
                        sx={{ mt: 1 }}
                      >
                        Démarrer l’environnement
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
                      <Typography variant="subtitle1" component="p">
                        {phase === "starting"
                          ? "L’environnement démarre"
                          : "Aucun message pour l’instant"}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {phase === "starting"
                          ? "Le modèle n’est utilisable qu’une fois l’environnement démarré."
                          : model
                            ? `Avec ${modelName(model)}. Demandez ce que vous voulez.`
                            : "Choisissez un modèle, puis demandez ce que vous voulez."}
                      </Typography>
                      {phase !== "starting" && !model ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => {
                            document
                              .getElementById("ob-composer-model")
                              ?.focus()
                          }}
                        >
                          Choisir un modèle
                        </Button>
                      ) : null}
                    </Stack>
                  ) : (
                    <div className="ob-chat-log-inner" ref={attachLogInner}>
                      {shown.map((entry, index) => (
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
                          onOpenCouncil={bubbleActions.openCouncil}
                          onQueuedForce={bubbleActions.queuedForce}
                          onQueuedRemove={bubbleActions.queuedRemove}
                          councilOpened={councilMode !== "closed"}
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
                      ))}
                    </div>
                  )}
                  {!atBottom && shown.length > 0 ? (
                    <div className="ob-jump-wrap">
                      <button
                        type="button"
                        className="ob-jump-latest"
                        onClick={() => {
                          const el = outputRef.current
                          stickRef.current = true
                          setAtBottom(true)
                          if (el) el.scrollTop = el.scrollHeight
                        }}
                      >
                        <ChevronDownIcon width={16} height={16} />
                        Jump to latest
                      </button>
                    </div>
                  ) : null}
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
                {orb ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    className="ob-orb-row"
                    sx={{
                      px: mobile ? 1 : 2,
                      pt: 0.5,
                      flexShrink: 0,
                      alignSelf: "center",
                    }}
                  >
                    <AgentOrb state={orb} size={mobile ? 80 : 112} />
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      role="status"
                    >
                      {activityLabel}
                    </Typography>
                  </Stack>
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
                  compact={mobile || chatDocked}
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
                  plugins={pluginMentions}
                  pluginMentionSources={pluginMentionSources}
                  models={models}
                  model={model}
                  onModel={selectModel}
                  effort={effort}
                  effortSaving={effortSaving}
                  onEffort={selectEffort}
                  userId={me.id}
                  modelsError={modelsError}
                  onReloadModels={() => void loadModels()}
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
            {councilMode === "pane" && councilData ? (
              <CouncilPane
                data={councilData}
                selectedId={councilMemberId}
                statusOf={councilStatusOf}
                width={councilWidth}
                paneRef={councilPaneRef}
                onClose={closeCouncilPane}
                onFullscreen={openCouncilFullscreen}
                onDrag={onCouncilDrag}
                onSelect={setCouncilMemberId}
                subscribe={subscribe}
                live={live}
                mobile={mobile}
              />
            ) : null}
            {councilMode === "pane" && !councilData ? (
              <div className="ob-preview-pane" style={{ width: councilWidth }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  className="ob-preview-bar"
                >
                  <Typography variant="caption" sx={{ flex: 1 }}>
                    Council
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={closeCouncilPane}
                  >
                    Close
                  </Button>
                </Stack>
                <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
                  {!running
                    ? "Start the desktop to view this council."
                    : councilError || "Opening council…"}
                </Typography>
              </div>
            ) : null}
          </Box>
        </Box>
        {previewMode === "overlay" && previewSrc ? (
          <PreviewOverlay src={previewSrc} onClose={closePreview} />
        ) : null}
        {councilMode === "overlay" && councilData ? (
          <CouncilOverlay
            data={councilData}
            selectedId={councilMemberId}
            statusOf={councilStatusOf}
            onClose={closeCouncilPane}
            onSelect={setCouncilMemberId}
            subscribe={subscribe}
            live={live}
            mobile={mobile}
          />
        ) : null}
        {councilMode === "overlay" && !councilData ? (
          <div className="ob-preview-overlay">
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
                Council
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={closeCouncilPane}
              >
                Close
              </Button>
            </Stack>
            <Typography variant="body2" sx={{ color: "#fff", p: 2 }}>
              {!running
                ? "Start the desktop to view this council."
                : councilError || "Opening council…"}
            </Typography>
          </div>
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
              <Typography variant="subtitle1" component="p">
                {THREADS_UI.screenAsleep}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {THREADS_UI.screenAsleepBody}
              </Typography>
            </Paper>
          ) : !sessionId ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="subtitle1" component="p">
                {THREADS_UI.noThreadSelected}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {THREADS_UI.noThreadSelectedBody}
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
                    ? THREADS_UI.sleepStopping
                    : held
                      ? THREADS_UI.screenHeld
                      : THREADS_UI.screenViewOnly(
                          sessions.find((item) => item.id === sessionId)
                            ?.title || THREAD.untitled,
                        )}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!running || stopping || controlBusy}
                  onClick={() =>
                    void (held ? releaseControl(false) : takeControl())
                  }
                >
                  {held ? THREADS_UI.releaseControl : THREADS_UI.takeControl}
                </Button>
                <Tip title={THREADS_UI.reloadScreen}>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<RefreshIcon />}
                    onClick={() => setDesktopKey((key) => key + 1)}
                    disabled={!screen || screen.sessionId !== sessionId}
                  >
                    Reload
                  </Button>
                </Tip>
                <Tip title="Open VNC in a new tab">
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
                    {THREADS_UI.popOut}
                  </Button>
                </Tip>
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
                  <Typography variant="subtitle1" component="p">
                    {screenError
                      ? THREADS_UI.screenUnavailable
                      : THREADS_UI.screenOpening}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {screenError || THREADS_UI.screenOpeningBody}
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
          <MediaVault subscribe={subscribe} onOpenChat={() => onTab("chat")} />
        </Box>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          variant="temporary"
          anchor="left"
          width={300}
          ref={drawerPaperRef}
          aria-label={THREADS_UI.desktopOptions}
        >
          <Box
            sx={{
              p: 1.5,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" component="h2" sx={{ flex: 1 }}>
                {THREADS_UI.desktopDrawer}
              </Typography>
              <Chip size="small" color={phaseColor}>
                {stopping
                  ? "mise en veille…"
                  : phase === "starting"
                    ? "démarrage…"
                    : phase === "running"
                      ? "prêt"
                      : "en veille"}
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
                {stopping ? "Mise en veille…" : "Mettre en veille"}
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={() => void start()}
                disabled={phase === "starting"}
              >
                {THREADS_UI.startDesktopShort}
              </Button>
            )}
            <Divider />
            {running ? (
              <Button
                size="small"
                variant="text"
                startIcon={<AddIcon />}
                disabled={actionBusy}
                onClick={() => startBlankThread()}
              >
                {THREADS_UI.newThread}
              </Button>
            ) : null}
            <Typography variant="caption" color="textSecondary">
              {THREADS_UI.desktopDrawerHint}
            </Typography>
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
                <ListItemText primary={THREADS_UI.rename} />
              </ListItemButton>
              <ListItemButton
                onClick={() => {
                  setMoveMenuThread(menuThread)
                  setMenuThread(null)
                }}
              >
                <FolderIcon />
                <ListItemText primary={THREADS_UI.moveToFolder} />
              </ListItemButton>
              {threadBusy(menuThread.id) ? (
                <ListItemButton onClick={() => void abortThread(menuThread.id)}>
                  <StopIcon />
                  <ListItemText primary={THREADS_UI.abort} />
                </ListItemButton>
              ) : null}
              <ListItemButton
                onClick={() => {
                  setDeleteTarget(menuThread)
                  setMenuThread(null)
                }}
              >
                <DeleteIcon />
                <ListItemText primary={THREADS_UI.delete} />
              </ListItemButton>
            </>
          ) : null}
        </Menu>

        <Menu
          open={Boolean(moveMenuThread)}
          anchorEl={menuAnchor}
          onClose={() => setMoveMenuThread(null)}
        >
          <ListItemButton
            onClick={() => {
              const id = moveMenuThread?.id
              setMoveMenuThread(null)
              if (id) void moveThread(id, null)
            }}
          >
            {moveMenuThread && !threadDirMap[moveMenuThread.id] ? (
              <CheckCircleIcon />
            ) : (
              <span style={{ width: 18, display: "inline-flex" }} />
            )}
            <ListItemText primary={THREADS_UI.noFolder} />
          </ListItemButton>
          {dirs.map((dir) => (
            <ListItemButton
              key={dir.id}
              onClick={() => {
                setMoveMenuThread(null)
                void moveThread(moveMenuThread?.id ?? "", dir.id)
              }}
            >
              {moveMenuThread && threadDirMap[moveMenuThread.id] === dir.id ? (
                <CheckCircleIcon />
              ) : (
                <span style={{ width: 18, display: "inline-flex" }} />
              )}
              <ListItemText primary={dir.name} />
            </ListItemButton>
          ))}
          {dirs.length === 0 ? (
            <ListItemButton
              disabled
              onClick={() => {
                setMoveMenuThread(null)
                threadActions.newFolder()
              }}
            >
              <ListItemText primary={THREADS_UI.noFoldersYet} />
            </ListItemButton>
          ) : null}
        </Menu>

        <Menu
          open={Boolean(folderMenuDir)}
          anchorEl={menuAnchor}
          onClose={() => setFolderMenuDir(null)}
        >
          {folderMenuDir ? (
            <>
              <ListItemButton
                onClick={() => {
                  setFolderName(folderMenuDir.name)
                  setFolderDialog({ mode: "rename", dir: folderMenuDir })
                  setFolderMenuDir(null)
                }}
              >
                <EditIcon />
                <ListItemText primary={THREADS_UI.renameFolder} />
              </ListItemButton>
              <ListItemButton
                onClick={() => {
                  setFolderDeleteTarget(folderMenuDir)
                  setFolderMenuDir(null)
                }}
              >
                <DeleteIcon />
                <ListItemText primary={THREADS_UI.deleteFolder} />
              </ListItemButton>
            </>
          ) : null}
        </Menu>

        {renameTarget ? (
          <AccessibleDialog
            open
            onClose={() => setRenameTarget(null)}
            aria-labelledby={dialogIds.renameThread}
          >
            <DialogTitle id={dialogIds.renameThread}>
              {THREADS_UI.renameTitle}
            </DialogTitle>
            <DialogContent>
              <TextField
                label={THREADS_UI.titleLabel}
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
          </AccessibleDialog>
        ) : null}

        {deleteTarget ? (
          <AccessibleDialog
            open
            onClose={() => setDeleteTarget(null)}
            aria-labelledby={dialogIds.deleteThread}
          >
            <DialogTitle id={dialogIds.deleteThread}>
              {THREADS_UI.deleteTitle}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {THREADS_UI.deleteBody(
                  deleteTarget ? threadTitle(deleteTarget) : "",
                )}
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
          </AccessibleDialog>
        ) : null}

        {batchTarget ? (
          <AccessibleDialog
            open
            onClose={() => {
              if (!batchBusy) setBatchTarget(null)
            }}
            aria-labelledby={dialogIds.batchDelete}
          >
            <DialogTitle id={dialogIds.batchDelete}>
              {batchTarget.length === 1
                ? THREADS_UI.deleteTitle
                : THREADS_UI.deleteManyTitle(batchTarget.length)}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {batchBusy
                  ? THREADS_UI.deletingProgress(
                      batchProgress.done,
                      batchProgress.total,
                    )
                  : batchTarget.length === 1
                    ? THREADS_UI.deleteBody("")
                    : THREADS_UI.deleteManyBody(batchTarget.length)}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                disabled={batchBusy}
                onClick={() => setBatchTarget(null)}
              >
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={batchBusy}
                startIcon={<DeleteIcon />}
                onClick={() => void deleteThreadsBatch()}
              >
                Delete
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        {folderDialog ? (
          <AccessibleDialog
            open
            onClose={() => setFolderDialog(null)}
            aria-labelledby={dialogIds.folder}
          >
            <DialogTitle id={dialogIds.folder}>
              {folderDialog.mode === "create"
                ? THREADS_UI.newFolderTitle
                : THREADS_UI.renameFolderTitle}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                {THREADS_UI.folderHint}
              </Typography>
              <TextField
                label={THREADS_UI.folderNameLabel}
                value={folderName}
                autoFocus
                sx={{ width: "100%" }}
                disabled={actionBusy}
                onChange={(event) => setFolderName(event.currentTarget.value)}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveFolder()
                  }
                }}
              />
            </DialogContent>
            <DialogActions>
              <Button variant="text" onClick={() => setFolderDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={actionBusy || !folderName.trim()}
                onClick={() => void saveFolder()}
              >
                {folderDialog.mode === "create"
                  ? THREADS_UI.create
                  : STATES.save}
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}

        {folderDeleteTarget ? (
          <AccessibleDialog
            open
            onClose={() => setFolderDeleteTarget(null)}
            aria-labelledby={dialogIds.folderDelete}
          >
            <DialogTitle id={dialogIds.folderDelete}>
              {THREADS_UI.folderDeleteTitle(folderDeleteTarget.name)}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {THREADS_UI.folderDeleteBody}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                onClick={() => setFolderDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={actionBusy}
                startIcon={<DeleteIcon />}
                onClick={() => void removeFolder()}
              >
                Delete folder
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
      </Stack>
    </ProjectRefsContext.Provider>
  )
}
