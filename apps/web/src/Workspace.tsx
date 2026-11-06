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
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
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
import { patchSearch, searchParam, useBackLayer, usePaneNav } from "./back-nav"
import {
  type CouncilData,
  CouncilGroupSwitcher,
  CouncilOverlay,
  CouncilPane,
  clampCouncilWidth,
  councilRunning,
  councilRunningIds,
  councilSwitchPatch,
} from "./CouncilView"
import type { CronJobInfo } from "./CronView"
import {
  composerSlim,
  nextReadingMode,
  orbSizePx,
  orbState,
} from "./chat-controls"
import { ChatMarkdown } from "./chat-markdown"
import {
  ACTIVITY_LABEL,
  applyMessageDelta,
  type ChatMessage,
  chatLinkUrl,
  eventTouchesSession,
  handoffStamp,
  lastHandoffStamp,
  type MediaMap,
  mediaKey,
  modelActivity,
  nearBottom,
  type PluginCardBlock,
  previewFrameSrc,
  SCREEN_DONE_PROMPT,
  type SendReceipt,
  type SendStatus,
  screenCardState,
  showLivePreview,
  speakableText,
  splitPluginCards,
  type TranscriptEntry,
  transcriptBubbles,
  turnError,
  userMessageCount,
  visibleMessages,
  visibleText,
} from "./chat-view"
import { Chip } from "./chip"
import { ComposerPickers } from "./composer-controls"
import {
  clearComposerSeed,
  consumeComposerSeed,
  formatFrAgo,
  peekComposerSeed,
} from "./dashboard-data"
import {
  type CouncilSummary,
  type DelegationWatch,
  delegatedBusyIds,
  parseCouncilSummaries,
  parseDelegationWatches,
  threadCouncils,
} from "./delegations"
import { useOverlayA11y } from "./dialog-a11y"
import {
  blankDraftKey,
  clearBlankDraft,
  readBlankDraft,
  readDraft,
  writeBlankDraft,
  writeDraft,
} from "./draft"
import { FilePreviewOverlay, FilePreviewPane } from "./FileView"
import { FilePreviewContext, filePathFromSrc } from "./file-view"
import {
  isNarrowPane,
  useDebounced,
  useElementWidth,
  useEventStream,
  useMobile,
  useUnreadThreads,
  useViewportBelow,
} from "./hooks"
import {
  AddIcon,
  AttachFileIcon,
  BlockIcon,
  ChatIcon,
  CheckCircleIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ComputerIcon,
  ContentCopyIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  GroupsIcon,
  MicIcon,
  MoreVertIcon,
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
  pickJoinableFiles,
  promptParts,
  readJoinedFile,
} from "./join-file"
import { JoinedFiles } from "./joined-files"
import { createLatestGuard } from "./latest-guard"
import { MediaImage } from "./MediaDownload"
import { MediaVault } from "./MediaVault"
import {
  dropCachedMessages,
  getCachedMessages,
  putCachedMessages,
} from "./message-cache"
import {
  EMPTY_PAGE_META,
  infoPredatesWindow,
  MESSAGE_PAGE_SIZE,
  type MessagePageMeta,
  mergeOlderPage,
  mergeTailPage,
  messagePageUrl,
  pageMeta,
  parseMessagePage,
  tailLimit,
} from "./message-page"
import { MessageSkeletons } from "./message-skeletons"
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
import { ProjectRefsContext } from "./project-refs"
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
import {
  PARAM_COUNCIL,
  PARAM_FILEVIEW,
  PARAM_MEMBER,
  PARAM_PREVIEW,
  PARAM_SCREEN,
  PARAM_THREAD,
  type WorkspaceTab,
} from "./routes"
import {
  ScreenCard,
  ScreenOverlay,
  ScreenPane,
  ScreenStage,
} from "./ScreenView"
import Stack from "./stack"
import { Tip } from "./Tip"
import { STATES, THREAD, THREADS_UI } from "./texts"
import { expandFolder, parseCollapsedFolders } from "./thread-folders"
import {
  QueueDock,
  type ThreadQueueFileView,
  type ThreadQueueItemView,
  WorkLine,
} from "./thread-timeline"
import { timelineRows } from "./timeline"

// the IDE keeps its own state; memo keeps workspace renders (streaming ticks,
// status polls) from re-rendering its whole tree
const MemoProjects = memo(Projects)

const BUILTIN_PERSONA_NAMES: Record<string, string> = {
  assistant: "Assistant",
  "plugin-creator": "Open-bot Plugin Creator",
}

type Model = {
  providerID: string
  modelID: string
  name?: string
  variants?: string[]
}
// GET /api/thread-model: effective values for the picker plus the explicit
// per-thread pick (null halves follow the desktop default).
type ThreadModelPayload = {
  model?: {
    providerID?: string | null
    modelID?: string | null
    thinkingEffort?: string | null
  }
  thread?: {
    providerID?: string | null
    modelID?: string | null
    thinkingEffort?: string | null
  } | null
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
  screenOutcome: { stamp: string; kind: "done" | "later" } | null
  screenLive: boolean
  screenPath: string
  screenError: string
  screenOpened: boolean
  screenReloadKey: number
  running: boolean
  sending: boolean
  stopping: boolean
  controlBusy: boolean
  renderers: Map<string, PluginRenderer>
  onTakeControl: () => void
  onScreenDone: () => void
  onReleaseSilent: () => void
  onScreenLater: () => void
  onScreenResume: () => void
  onOpenScreen: () => void
  onCloseScreen: () => void
  onScreenRetry: () => void
  onStartDesktop: () => void
  onOpenPreview: () => void
  onOpenCouncil: (name: string) => void
  previewLive: boolean
  previewOpened: boolean
  previewSrc: string
  previewError: string
  /** Name of the council currently open in the viewer ("" = none). */
  openedCouncil: string
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
  screenOutcome,
  screenLive,
  screenPath,
  screenError,
  screenOpened,
  screenReloadKey,
  running,
  sending,
  stopping,
  controlBusy,
  renderers,
  onTakeControl,
  onScreenDone,
  onReleaseSilent,
  onScreenLater,
  onScreenResume,
  onOpenScreen,
  onCloseScreen,
  onScreenRetry,
  onStartDesktop,
  onOpenPreview,
  onOpenCouncil,
  previewLive,
  previewOpened,
  previewSrc,
  previewError,
  openedCouncil,
  onSpeak,
  onStopSpeak,
}: BubbleViewProps) {
  const message = entry.message
  const role = message.info?.role ?? "message"
  const mine = role === "user"
  const stamp = handoffStamp(message)
  const cardState = screenCardState({
    isLast: index === lastHandoff,
    held,
    outcome:
      screenOutcome && screenOutcome.stamp === stamp
        ? screenOutcome.kind
        : "none",
    running,
    screenLive,
    screenError,
    opened: screenOpened,
  })
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyMessage = () => {
    navigator.clipboard
      ?.writeText(message.text)
      .then(() => {
        setCopied(true)
        if (copyTimer.current !== null) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }
  const copyButton = message.text.trim() ? (
    <Tip title={copied ? THREADS_UI.copiedMessage : THREADS_UI.copyMessage}>
      <IconButton
        size="small"
        aria-label={THREADS_UI.copyMessage}
        onClick={copyMessage}
      >
        {copied ? (
          <CheckCircleIcon width={15} height={15} />
        ) : (
          <ContentCopyIcon width={15} height={15} />
        )}
      </IconButton>
    </Tip>
  ) : null
  const timeMark = message.sentAt ? (
    <time
      className="ob-bubble-time"
      dateTime={new Date(message.sentAt).toISOString()}
    >
      {formatWhen(message.sentAt)}
    </time>
  ) : null
  return (
    <div className={`ob-msg ${mine ? "ob-msg-user" : "ob-msg-assistant"}`}>
      <Box
        title={mine ? "You" : "Agent"}
        className={`ob-bubble ${mine ? "ob-bubble-user" : "ob-bubble-assistant"}`}
      >
        <div className="ob-md">
          {message.text.trim() ? (
            <PluginSegments text={message.text} renderers={renderers} />
          ) : null}
          {message.images.map((src) => (
            <MediaImage key={src} src={src} />
          ))}
          {message.handoff ? (
            <ScreenCard
              state={cardState}
              path={screenPath}
              error={screenError}
              timeLabel={message.sentAt ? formatWhen(message.sentAt) : ""}
              reloadKey={screenReloadKey}
              takeDisabled={!running || sending || stopping || controlBusy}
              doneDisabled={!running || sending || stopping || controlBusy}
              onTakeControl={onTakeControl}
              onDone={onScreenDone}
              onReleaseSilent={onReleaseSilent}
              onLater={onScreenLater}
              onResume={onScreenResume}
              onOpenStage={onOpenScreen}
              onCloseStage={onCloseScreen}
              onRetry={onScreenRetry}
              onStartDesktop={onStartDesktop}
            />
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
          {(message.councils.length > 0
            ? message.councils
            : message.council
              ? [message.council]
              : []
          ).map((slug) => (
            <div className="ob-preview-note" key={slug}>
              {openedCouncil === slug ? (
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
                  onClick={() => onOpenCouncil(slug)}
                >
                  {message.councils.length > 1 || openedCouncil
                    ? `Open council: ${slug}`
                    : "Open council"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Box>
      {mine ? (
        <div className="ob-msg-meta ob-msg-meta-user">
          {entry.mark ? <SendMark mark={entry.mark} /> : null}
          {timeMark}
          {copyButton}
        </div>
      ) : message.text.trim() ? (
        <div className="ob-msg-meta">
          {copyButton}
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
              >
                {speechLoading === bubbleKey ? (
                  <CircularProgress size={1.1} />
                ) : speechKey === bubbleKey ? (
                  <StopIcon width={15} height={15} />
                ) : (
                  <VolumeUpIcon width={15} height={15} />
                )}
              </IconButton>
            </span>
          </Tip>
          {timeMark}
        </div>
      ) : timeMark ? (
        <div className="ob-msg-meta">{timeMark}</div>
      ) : null}
    </div>
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
  // Filter off the critical path: the input stays live, the thread list
  // recomputes at a lower priority so a big list can never block typing.
  const deferredThreadQuery = useDeferredValue(threadQuery)
  const query = deferredThreadQuery.trim().toLowerCase()
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
  reading,
  activityOrb,
  activityLabel,
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
  /** The reader scrolled well up into history: slim to a one-line pill
      unless composing (focus, draft, attachments, voice). */
  reading: boolean
  /** Live turn phase for the mini orb inside the reading pill, with its
      factual label; null when no turn is running. At the bottom the
      parent renders the full-size orb row instead. */
  activityOrb: "thinking" | "working" | null
  activityLabel: string
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
  useBackLayer(joinOpen, () => setJoinOpen(false), { name: "menu" })
  const draftRef = useRef(draft)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const joinAnchor = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const skillsRequestedRef = useRef(false)
  const [fieldFocused, setFieldFocused] = useState(false)
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

  // Reading pill: while the reader is up in history the mini orb and its
  // status label move inside this surface, on the field's own line — one
  // bar instead of a floating mini row, a divider, and a slim box. Not
  // composing → the toolbar rows also drop away (slim) and Stop rides
  // the pill; composing (focus, draft, attachments, voice) keeps the
  // full toolbar below, with the orb staying put on the field line so
  // expanding never makes it jump. The field stays mounted throughout,
  // so focus and caret survive every toggle.
  const slim = composerSlim({
    reading,
    focused: fieldFocused,
    hasDraft: draft.length > 0,
    hasAttachments: joined.length > 0,
    voiceBusy: recording || transcribing,
  })
  const inlineOrb = reading && activityOrb ? activityOrb : null

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
        className={
          slim
            ? "ob-input-row ob-composer ob-composer-slim"
            : "ob-input-row ob-composer"
        }
        sx={{ p: slim ? 0.5 : mobile ? 0.75 : 1 }}
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
        <JoinedFiles
          files={joined}
          onRemove={(id) =>
            rememberJoined(joined.filter((item) => item.id !== id))
          }
        />
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
          className={
            inlineOrb || (slim && canStop) ? "ob-composer-fieldrow" : undefined
          }
        >
          {inlineOrb ? (
            <>
              <AgentOrb
                state={inlineOrb}
                size={orbSizePx(mobile, true)}
                className="ob-composer-inline-orb"
              />
              <Typography
                variant="caption"
                color="textSecondary"
                role="status"
                className="ob-composer-inline-status"
                sx={{ fontWeight: 600 }}
              >
                {activityLabel}
              </Typography>
            </>
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
              multiline={{ minRows: slim || mobile ? 1 : 2, maxRows: 10 }}
              ref={messageInputRef}
              disabled={!running || sending || stopping}
              onFocus={() => {
                setFieldFocused(true)
                onEnsureProjects()
                onEnsureReports()
                ensurePluginMentions()
              }}
              onBlur={() => setFieldFocused(false)}
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
          {slim && canStop ? (
            <IconButton
              size="small"
              className="ob-composer-inline-stop"
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
          ) : null}
        </Box>
        {/* Always mounted: slim folds the toolbar away with a grid-row
            animation (app.css) rather than unmounting it at full height.
            inert + aria-hidden keep the folded controls unreachable. */}
        <div
          className={
            slim
              ? "ob-composer-actions-wrap ob-composer-actions-slim"
              : "ob-composer-actions-wrap"
          }
          inert={slim}
          aria-hidden={slim}
        >
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
                  recording
                    ? "Relâcher pour transcrire"
                    : "Maintenir pour parler"
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
                      ? {
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                        }
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
        </div>
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
  // The open thread rides the URL (?thread=) like every app screen: a
  // deep link or reload starts on it, Back/Forward walk the threads the
  // user actually opened. localStorage stays only as the "last thread"
  // memory for bare /chat visits (initial restore below).
  const paneNav = usePaneNav()
  const { pushSearch, backOr } = paneNav
  const paneNavRef = useRef(paneNav)
  paneNavRef.current = paneNav
  const locationSearch = paneNav.search
  const threadParam = searchParam(locationSearch, PARAM_THREAD)
  const [sessionId, setSessionId] = useState(() =>
    searchParam(locationSearch, PARAM_THREAD),
  )
  // Threads deleted in this tab: Back can still land on their old
  // ?thread= entries (and a delete dialog's own layer pop can, too) —
  // those entries resolve to the blank composer, never a resurrection.
  const deadThreadsRef = useRef(new Set<string>())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState(false)
  // Lazy history: `messages` is a window (newest page first, older pages
  // prepended on scroll), and this meta says where the window starts —
  // the cursor for the next older page and the user-message count it
  // skipped. The ref mirrors the state for async loaders.
  const [pageMetaState, setPageMetaState] =
    useState<MessagePageMeta>(EMPTY_PAGE_META)
  const pageMetaRef = useRef<MessagePageMeta>(EMPTY_PAGE_META)
  const applyPageMeta = useCallback((meta: MessagePageMeta) => {
    pageMetaRef.current = meta
    setPageMetaState(meta)
  }, [])
  const [olderLoading, setOlderLoading] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const olderLoadingRef = useRef(false)
  const olderGuard = useRef(createLatestGuard())
  // Scroll anchor captured just before an older page prepends, applied
  // in a layout effect so the reader's place does not jump.
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
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
  // The persisted waiting list of the open thread (server-owned,
  // /api/thread-queue): messages typed while a turn runs. The control
  // plane flushes them in order on session idle; this state only
  // mirrors it for the dock, refreshed on open and on queue.changed.
  const [queueItems, setQueueItems] = useState<ThreadQueueItemView[]>([])
  const [queueBusyId, setQueueBusyId] = useState("")
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
  // Delegation watches (GET /api/delegations): creator → subject pairs so a
  // hidden member's busy state (council `worker:` threads the list filters
  // out) can show as the owner thread's spinner.
  const [delegations, setDelegations] = useState<DelegationWatch[]>([])
  // Every council of the user (GET /api/councils), for the floating
  // Councils button in the open thread. Null until the first good load so
  // `threadCouncils` can tell "unknown yet" from "council was closed".
  const [councilList, setCouncilList] = useState<CouncilSummary[] | null>(null)
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
  // Blank-composer pick: bind the new session to the no-step-cap agent so a
  // long coordinating turn is never cut at the default step guard (512).
  const [newUnlimitedSteps, setNewUnlimitedSteps] = useState(false)
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
  // Per-thread picker scoping: the model/effort state above always belongs
  // to one thread — modelForRef names it ("" = the blank composer). A pick
  // made here is stored on that thread only (PUT with sessionId); the
  // desktop default on /api/me is just the fallback for threads without a
  // pick, and the Config page stays its only editor.
  const activeSessionRef = useRef(sessionId)
  activeSessionRef.current = sessionId
  const modelForRef = useRef("")
  const pickExplicitRef = useRef({ model: false, effort: false })
  const pickSeqRef = useRef(0)
  // Blank composer pick, kept local until the first send creates the
  // thread and stores it as that thread's own pick.
  const blankPickRef = useRef<{ modelKey?: string; effort?: string } | null>(
    null,
  )
  const threadModelGuard = useRef(createLatestGuard())
  // Model/effort writes are coordinated (serialized, per-channel staleness)
  // by the shared saver — see model-effort.ts for the contract.
  const settingsSaverRef = useRef<SettingsSaver | null>(null)
  const onMeRefreshedRef = useRef(onMeRefreshed)
  onMeRefreshedRef.current = onMeRefreshed
  if (!settingsSaverRef.current) {
    settingsSaverRef.current = createSettingsSaver({
      putModel: (key, sessionId) =>
        api("/api/model", {
          method: "PUT",
          body: JSON.stringify({
            providerID: key.slice(0, key.indexOf("/")),
            modelID: key.slice(key.indexOf("/") + 1),
            ...(sessionId ? { sessionId } : {}),
          }),
        }),
      putThinking: (value, sessionId) =>
        api("/api/thinking", {
          method: "PUT",
          body: JSON.stringify({
            effort: value,
            ...(sessionId ? { sessionId } : {}),
          }),
        }),
      // Per-thread saves reconcile against that thread's effective pick,
      // never the desktop-wide /api/me — the two must not overwrite each
      // other (that cross-talk was the bug).
      fetchMe: (sessionId) =>
        sessionId
          ? api<MeLike>(
              `/api/thread-model?sessionId=${encodeURIComponent(sessionId)}`,
            )
          : api<MeLike>("/api/me"),
      adoptServer: (next, sessionId) => {
        if (!sessionId) onMeRefreshedRef.current?.(next as Me)
        // A save for a thread the user already left must not paint the
        // newly opened thread's picker.
        if (sessionId && activeSessionRef.current !== sessionId) return
        if (sessionId) {
          const payload = next as ThreadModelPayload
          if (payload.thread !== undefined) {
            pickExplicitRef.current = {
              model: Boolean(
                payload.thread?.providerID && payload.thread?.modelID,
              ),
              effort: Boolean(payload.thread?.thinkingEffort),
            }
            modelForRef.current = sessionId
          }
        }
        const info = next.model
        if (info?.providerID && info.modelID) {
          const key = `${info.providerID}/${info.modelID}`
          setModel((current) => (current === key ? current : key))
        }
        // While an effort save is still queued we keep the optimistic
        // value — the older snapshot must not clobber a pick the queue
        // has not written yet.
        if (!settingsSaverRef.current?.effortPending()) {
          const serverEffort = info?.thinkingEffort ?? ""
          setEffort((current) =>
            current === serverEffort ? current : serverEffort,
          )
        }
      },
      revertModel: (previous, sessionId) => {
        if (!sessionId || activeSessionRef.current === sessionId)
          setModel(previous)
      },
      revertEffort: (previous, sessionId) => {
        if (!sessionId || activeSessionRef.current === sessionId)
          setEffort(previous)
      },
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
  const [screenOutcome, setScreenOutcome] = useState<{
    stamp: string
    kind: "done" | "later"
  } | null>(null)
  const [previewMode, setPreviewMode] = useState<"closed" | "pane" | "overlay">(
    () =>
      searchParam(locationSearch, PARAM_PREVIEW) === "1"
        ? typeof window !== "undefined" && window.innerWidth <= 899
          ? "overlay"
          : "pane"
        : "closed",
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
  /** Which side pane opened last — Escape dismisses in Back's order. */
  const lastPaneRef = useRef<"preview" | "council" | "file" | "screen" | "">("")
  const widthRef = useRef(previewWidth)
  const [councilMode, setCouncilMode] = useState<"closed" | "pane" | "overlay">(
    () =>
      searchParam(locationSearch, PARAM_COUNCIL)
        ? typeof window !== "undefined" && window.innerWidth <= 899
          ? "overlay"
          : "pane"
        : "closed",
  )
  const [councilWidth, setCouncilWidth] = useState(() => {
    const raw = Number(sessionStorage.getItem("ob-council-width"))
    return Number.isFinite(raw) && raw >= 280 ? raw : 420
  })
  const councilWidthRef = useRef(councilWidth)
  const councilPaneRef = useRef<HTMLDivElement>(null)
  const [councilName, setCouncilName] = useState(() =>
    searchParam(locationSearch, PARAM_COUNCIL),
  )
  const [councilData, setCouncilData] = useState<CouncilData | null>(null)
  const [councilError, setCouncilError] = useState("")
  const [councilMemberId, setCouncilMemberId] = useState(() =>
    searchParam(locationSearch, PARAM_MEMBER),
  )
  const [fileMode, setFileMode] = useState<"closed" | "pane" | "overlay">(() =>
    searchParam(locationSearch, PARAM_FILEVIEW)
      ? typeof window !== "undefined" && window.innerWidth <= 899
        ? "overlay"
        : "pane"
      : "closed",
  )
  const [fileWidth, setFileWidth] = useState(() => {
    const raw = Number(sessionStorage.getItem("ob-file-width"))
    return Number.isFinite(raw) && raw >= 280 ? raw : 520
  })
  const fileWidthRef = useRef(fileWidth)
  const filePaneRef = useRef<HTMLDivElement>(null)
  const [screenMode, setScreenMode] = useState<"closed" | "pane" | "overlay">(
    () =>
      searchParam(locationSearch, PARAM_SCREEN) === "1"
        ? typeof window !== "undefined" && window.innerWidth <= 899
          ? "overlay"
          : "pane"
        : "closed",
  )
  const [screenWidth, setScreenWidth] = useState(() => {
    const raw = Number(sessionStorage.getItem("ob-screen-width"))
    return Number.isFinite(raw) && raw >= 280 ? raw : 560
  })
  const screenWidthRef = useRef(screenWidth)
  const screenPaneRef = useRef<HTMLDivElement>(null)
  const [filePath, setFilePath] = useState(() =>
    searchParam(locationSearch, PARAM_FILEVIEW),
  )
  // Latest-wins guard for council loads: fast group switching must never
  // let a slow fetch for the previous council paint over the new one.
  const councilLoadGuard = useRef(createLatestGuard())
  const [controlBusy, setControlBusy] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([])
  const viewportMobile = useMobile()
  // Small-screen layout is space-driven: in the global split screen this
  // workspace may sit in a phone-narrow pane while the window stays wide,
  // so its own measured width (root ref below) flips it to the mobile
  // layout exactly like a narrow viewport does. Until the first
  // measurement lands (width 0), the viewport flag alone decides.
  const [workspaceRef, workspaceWidth] = useElementWidth<HTMLDivElement>()
  const narrowPane = isNarrowPane(workspaceWidth)
  const mobile = viewportMobile || narrowPane
  // Threads history behavior: swap-in overlay on phones AND mid-width
  // desktops (single permanent history column only ≥1200px).
  const threadsOverlay = mobile || midWidth

  // Preview/council panes are URL screens (?preview=1, ?council=name,
  // ?member=id): opening pushes, Back/Forward and reload restore them,
  // member switches replace. The mode itself (pane vs overlay) stays a
  // layout-width concern below; the URL only carries open/closed + identity.
  const previewParam = searchParam(locationSearch, PARAM_PREVIEW) === "1"
  const screenParam = searchParam(locationSearch, PARAM_SCREEN) === "1"
  const councilParam = searchParam(locationSearch, PARAM_COUNCIL)
  const memberParam = searchParam(locationSearch, PARAM_MEMBER)
  const fileParam = searchParam(locationSearch, PARAM_FILEVIEW)
  useEffect(() => {
    if (previewParam && previewMode === "closed") {
      lastPaneRef.current = "preview"
      setPreviewMode(mobile ? "overlay" : "pane")
    }
    if (!previewParam && previewMode !== "closed") {
      if (document.fullscreenElement) void document.exitFullscreen()
      setPreviewMode("closed")
    }
  }, [previewParam, previewMode, mobile])
  useEffect(() => {
    if (screenParam && screenMode === "closed") {
      lastPaneRef.current = "screen"
      setScreenMode(mobile ? "overlay" : "pane")
    }
    if (!screenParam && screenMode !== "closed") {
      if (document.fullscreenElement) void document.exitFullscreen()
      setScreenMode("closed")
    }
  }, [screenParam, screenMode, mobile])
  useEffect(() => {
    if (councilParam) {
      if (councilParam.toLowerCase() !== councilName.toLowerCase()) {
        councilLoadGuard.current.begin()
        setCouncilData(null)
        setCouncilError("")
        setCouncilName(councilParam)
      }
      if (councilMode === "closed") {
        lastPaneRef.current = "council"
        setCouncilMode(mobile ? "overlay" : "pane")
      }
    } else if (councilMode !== "closed") {
      if (document.fullscreenElement) void document.exitFullscreen()
      setCouncilMode("closed")
    }
  }, [councilParam, councilName, councilMode, mobile])
  useEffect(() => {
    if (memberParam !== councilMemberId) setCouncilMemberId(memberParam)
  }, [memberParam, councilMemberId])
  useEffect(() => {
    if (fileParam && chatLinkUrl(fileParam)) {
      if (fileParam !== filePath) setFilePath(fileParam)
      if (fileMode === "closed") {
        lastPaneRef.current = "file"
        setFileMode(mobile ? "overlay" : "pane")
      }
    } else if (fileMode !== "closed") {
      if (document.fullscreenElement) void document.exitFullscreen()
      setFileMode("closed")
    }
  }, [fileParam, filePath, fileMode, mobile])

  // Chat file links land here (FilePreviewContext): a click on a served
  // desktop file opens it in the split previewer instead of a new tab.
  // First open pushes a history entry (Back closes); following another
  // file link inside the pane swaps it in place.
  const openChatFile = useCallback(
    (src: string) => {
      const path = filePathFromSrc(src)
      if (!path) return
      if (fileMode === "closed") {
        lastPaneRef.current = "file"
        setFilePath(path)
        setFileMode(mobile ? "overlay" : "pane")
        pushSearch({ [PARAM_FILEVIEW]: path })
      } else if (path !== filePath) {
        setFilePath(path)
        pushSearch({ [PARAM_FILEVIEW]: path }, { replace: true })
      }
    },
    [fileMode, filePath, mobile, pushSearch],
  )
  const fileSrc = filePath ? (chatLinkUrl(filePath) ?? "") : ""

  const selectCouncilMember = useCallback(
    (id: string) => {
      setCouncilMemberId(id)
      pushSearch({ [PARAM_MEMBER]: id || null }, { replace: true })
    },
    [pushSearch],
  )

  // Back-dismiss layers for the workspace's transient surfaces: the
  // swap-in thread history (overlay widths only — the permanent column
  // is not dismissible) and the action menus. Dialogs and the views
  // drawer get theirs from AccessibleDialog/useOverlayA11y.
  const closeThreadsPanel = useCallback(() => setThreadsOpen(false), [])
  useBackLayer(threadsOpen, closeThreadsPanel, {
    name: "threads",
    enabled: threadsOverlay,
  })
  useBackLayer(Boolean(menuThread), () => setMenuThread(null), {
    name: "menu",
  })
  useBackLayer(Boolean(moveMenuThread), () => setMoveMenuThread(null), {
    name: "menu",
  })
  useBackLayer(Boolean(folderMenuDir), () => setFolderMenuDir(null), {
    name: "menu",
  })
  // Batch-select is a mode screen on phones: Back leaves it (and drops
  // the selection) before it can leave the thread.
  const exitSelectMode = useCallback(() => {
    setThreadSelectMode(false)
    setSelectedThreads(new Set())
  }, [])
  useBackLayer(threadSelectMode, exitSelectMode, { name: "select-mode" })

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
  // Reading mode: the reader scrolled well up into history, so the orb row
  // shrinks to a mini status line and the composer slims to its bare field.
  // Hysteresis via nextReadingMode — the shrink frees log height, which
  // would otherwise flip the mode back and forth near one threshold.
  const [readingMode, setReadingMode] = useState(false)
  // The full orb row stays mounted briefly after reading mode starts so
  // it can morph down (canvas size + row height, CSS in app.css) instead
  // of vanishing the instant the mini orb appears in the composer pill.
  // Keep in sync with the ob-orb-row transition durations.
  const [orbRowLeaving, setOrbRowLeaving] = useState(false)
  useEffect(() => {
    if (!readingMode) {
      setOrbRowLeaving(false)
      return
    }
    setOrbRowLeaving(true)
    const timer = window.setTimeout(() => setOrbRowLeaving(false), 300)
    return () => window.clearTimeout(timer)
  }, [readingMode])
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
        pageMetaState.startUserCount,
      ),
    [messages, receipts, sessionId, mediaMap, pageMetaState.startUserCount],
  )
  // Councils this thread created or announced — the floating Councils
  // button's list. A thread can run several teams at once; membership and
  // running counts join through the delegation watches and /api/councils,
  // markers in the rendered replies cover councils whose wake never armed.
  const threadCouncilRows = useMemo(
    () =>
      threadCouncils({
        councils: councilList,
        watches: delegations,
        markerNames: shown.flatMap((entry) =>
          entry.message.councils.length > 0
            ? entry.message.councils
            : entry.message.council
              ? [entry.message.council]
              : [],
        ),
        creatorId: sessionId,
        isBusy: (id) => councilRunning(sessionStatus[id]),
      }),
    [councilList, delegations, shown, sessionId, sessionStatus],
  )
  const councilsRunning = threadCouncilRows.reduce(
    (count, row) => count + row.running,
    0,
  )
  // Groups for the viewer's in-pane switcher: the open council always has
  // a chip, even when the thread list above no longer carries it (closed
  // elsewhere, marker scrolled out of the rendered window).
  const councilSwitcherRows = useMemo(() => {
    if (
      !councilName ||
      threadCouncilRows.some(
        (row) => row.name.toLowerCase() === councilName.toLowerCase(),
      )
    ) {
      return threadCouncilRows
    }
    return [
      {
        id: "",
        name: councilName,
        members: councilData?.members.length ?? 0,
        running: 0,
      },
      ...threadCouncilRows,
    ]
  }, [threadCouncilRows, councilName, councilData])
  const [councilMenuOpen, setCouncilMenuOpen] = useState(false)
  useBackLayer(councilMenuOpen, () => setCouncilMenuOpen(false), {
    name: "menu",
  })
  const councilFabRef = useRef<HTMLDivElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the trigger — close the menu when the thread or the open council changes
  useEffect(() => {
    setCouncilMenuOpen(false)
  }, [sessionId, councilMode])
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
  // The waiting list is flushed by the control plane now (on session
  // idle, holding behind an errored turn like this client flush used
  // to); the dock only mirrors it. Loaded per thread and refreshed on
  // every queue.changed for the open thread (see the stream effect).
  const queueSessionRef = useRef("")
  const loadQueue = useCallback(async (id: string) => {
    if (!id) {
      setQueueItems([])
      return
    }
    try {
      const data = await api<{ items?: ThreadQueueItemView[] }>(
        `/api/thread-queue/${encodeURIComponent(id)}`,
      )
      if (queueSessionRef.current === id)
        setQueueItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      // A failed queue read shows an empty dock, never a broken thread;
      // the next queue.changed or thread switch retries.
    }
  }, [])
  useEffect(() => {
    queueSessionRef.current = sessionId
    setQueueItems([])
    void loadQueue(sessionId)
  }, [sessionId, loadQueue])
  // Derived timeline rows: bubbles interleaved with one work-summary
  // row per assistant turn (see timeline.ts).
  const timeline = useMemo(
    () =>
      timelineRows(shown, messages, {
        live: Boolean(sessionId && threadBusy(sessionId)),
      }),
    [shown, messages, sessionId, threadBusy],
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
    // Delegated work is invisible on its own row (hidden council members are
    // filtered out of the list), so a hidden busy member lifts its spinner
    // onto the coordinating thread. Visible subjects spin on their own row.
    for (const id of delegatedBusyIds(
      delegations,
      threadBusy,
      new Set(sessions.map((item) => item.id)),
    )) {
      set.add(id)
    }
    return set
  }, [sessions, threadBusy, delegations])
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
  // The agent still waits on a postponed share of this thread.
  const screenWaiting =
    screenOutcome?.kind === "later" &&
    screenOutcome.stamp === lastHandoffStamp(shown)
  const screenTitle =
    sessions.find((item) => item.id === sessionId)?.title || THREAD.untitled
  const screenApps = sessionId ? (
    <AppLauncher
      sessionId={sessionId}
      disabled={!screen || screen.sessionId !== sessionId}
      onError={setError}
    />
  ) : undefined
  // a draft typed before any thread existed, handed to the composer on mount
  const migrateDraft =
    sessionId && !draftSessionRef.current ? draftRef.current : ""

  // stable identities so memoized bubbles skip re-renders while the
  // underlying handlers stay fresh
  const bubbleActionsRef = useRef({
    takeControl: () => {},
    screenDone: () => {},
    releaseSilent: () => {},
    screenLater: () => {},
    screenResume: () => {},
    openScreen: () => {},
    closeScreen: () => {},
    screenRetry: () => {},
    startDesktop: () => {},
    openPreview: () => {},
    openCouncil: (_name: string) => {},
  })
  const bubbleActions = useMemo(
    () => ({
      takeControl: () => bubbleActionsRef.current.takeControl(),
      screenDone: () => bubbleActionsRef.current.screenDone(),
      releaseSilent: () => bubbleActionsRef.current.releaseSilent(),
      screenLater: () => bubbleActionsRef.current.screenLater(),
      screenResume: () => bubbleActionsRef.current.screenResume(),
      openScreen: () => bubbleActionsRef.current.openScreen(),
      closeScreen: () => bubbleActionsRef.current.closeScreen(),
      screenRetry: () => bubbleActionsRef.current.screenRetry(),
      startDesktop: () => bubbleActionsRef.current.startDesktop(),
      openPreview: () => bubbleActionsRef.current.openPreview(),
      openCouncil: (name: string) => bubbleActionsRef.current.openCouncil(name),
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
      if (held) void releaseControl(true)
      else {
        stampScreenOutcome("done")
        void prompt(SCREEN_DONE_PROMPT)
      }
    },
    releaseSilent: () => void releaseControl(false),
    screenLater: () => stampScreenOutcome("later"),
    screenResume: () => clearScreenOutcome(),
    openScreen: () => {
      const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
      const next = clampPreviewWidth(screenWidthRef.current, parent)
      screenWidthRef.current = next
      setScreenWidth(next)
      setScreenMode(mobile ? "overlay" : "pane")
      lastPaneRef.current = "screen"
      pushSearch({ [PARAM_SCREEN]: "1" })
    },
    closeScreen: () => closeScreenStage(),
    screenRetry: () => setDesktopKey((key) => key + 1),
    startDesktop: () => void start(),
    openPreview: () => {
      const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
      const next = clampPreviewWidth(widthRef.current, parent)
      widthRef.current = next
      setPreviewWidth(next)
      setPreviewMode(mobile ? "overlay" : "pane")
      lastPaneRef.current = "preview"
      pushSearch({ [PARAM_PREVIEW]: "1" })
    },
    openCouncil: (name: string) => {
      const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
      const next = clampCouncilWidth(councilWidthRef.current, parent)
      councilWidthRef.current = next
      setCouncilWidth(next)
      if (name.toLowerCase() !== councilName.toLowerCase()) {
        councilLoadGuard.current.begin()
        setCouncilData(null)
        setCouncilError("")
        setCouncilMemberId("")
      }
      setCouncilName(name)
      setCouncilMode(mobile ? "overlay" : "pane")
      lastPaneRef.current = "council"
      pushSearch({ [PARAM_COUNCIL]: name, [PARAM_MEMBER]: null })
    },
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
        delegationBody,
        councilBody,
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
        api<unknown>("/api/delegations").catch(() => null),
        api<unknown>("/api/councils").catch(() => null),
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
      if (delegationBody) setDelegations(parseDelegationWatches(delegationBody))
      if (councilBody) setCouncilList(parseCouncilSummaries(councilBody))
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
  // A cached transcript paints instantly; messagesLoading stays set until the
  // first successful reconciliation fetch, so a stale cache never hides the
  // catch-up in silence.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs reset when the thread or desktop changes
  useEffect(() => {
    const cached = sessionId ? getCachedMessages(sessionId) : undefined
    if (cached) {
      messagesJsonRef.current = cached.payload
      setMessages(cached.messages)
    } else {
      messagesJsonRef.current = ""
      setMessages([])
    }
    messagesRef.current = cached?.messages ?? []
    // The cached window's paging meta paints with it; a fresh thread
    // starts windowless and any in-flight older-page load for the
    // previous thread is invalidated.
    applyPageMeta(cached?.page ?? EMPTY_PAGE_META)
    olderGuard.current.begin()
    olderLoadingRef.current = false
    setOlderLoading(false)
    setOlderError(false)
    prependScrollRef.current = null
    stickRef.current = true
    setAtBottom(true)
    setReadingMode(false)
    setMediaMap(new Map())
    setMessagesError(false)
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
      // Lazy history: ask only for the newest page — widened to the
      // loaded window so edits/removals inside it reconcile — and merge
      // it over the window instead of replacing the whole transcript.
      const messageRes = await fetch(
        messagePageUrl(id, tailLimit(messagesRef.current.length)),
      )
      // A failed fetch (desktop restarting, session gone) must not wipe the
      // transcript or poison the cache with an empty payload: painted
      // messages stay, and an empty view surfaces the error row instead.
      if (!messageRes.ok) {
        if (isCurrent() && messagesRef.current.length === 0)
          setMessagesError(true)
        return
      }
      const body = await messageRes.json()
      // A late response for the previous thread must not overwrite the
      // view, the message refs, or the delta upsert base (messagesRef).
      if (!isCurrent()) return
      const page = parseMessagePage(body)
      const merged = mergeTailPage(messagesRef.current, page)
      // When the older prefix survived, the window still starts where it
      // did — keep its cursor/offset and only refresh the total.
      const nextMeta = merged.keptPrefix
        ? { ...pageMetaRef.current, total: page.total }
        : pageMeta(page)
      const payload = JSON.stringify(merged.messages)
      if (payload !== messagesJsonRef.current) {
        messagesJsonRef.current = payload
        messagesRef.current = merged.messages
        setMessages(merged.messages)
      }
      applyPageMeta(nextMeta)
      putCachedMessages(id, payload, messagesRef.current, nextMeta)
      setMessagesError(false)
    } catch {
      if (isCurrent() && messagesRef.current.length === 0)
        setMessagesError(true)
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
  }, [sessionId, running, applyPageMeta])

  // initial load plus catch-up whenever the stream comes back
  // biome-ignore lint/correctness/useExhaustiveDependencies: live re-runs the load after a reconnect
  useEffect(() => {
    void tick()
  }, [tick, live])

  const scheduleTick = useDebounced(() => void tick(), 250)

  // Pull one older page in front of the window. Triggered by the top
  // sentinel (and its button fallback); a page of tool-only steps renders
  // no bubble, so the walk continues — bounded per trigger — until
  // something visible lands or history runs out.
  const loadOlder = useCallback(async () => {
    const id = sessionId
    if (!id || !running || olderLoadingRef.current) return
    if (!pageMetaRef.current.hasMore || !pageMetaRef.current.nextBefore) return
    olderLoadingRef.current = true
    setOlderLoading(true)
    setOlderError(false)
    const seq = olderGuard.current.begin()
    const isCurrent = () =>
      olderGuard.current.isCurrent(seq) && sessionIdRef.current === id
    try {
      let older: ChatMessage[] = []
      let nextMeta = pageMetaRef.current
      let addedVisible = 0
      for (let hop = 0; hop < 5; hop++) {
        if (!nextMeta.hasMore || !nextMeta.nextBefore) break
        const res = await fetch(
          messagePageUrl(id, MESSAGE_PAGE_SIZE, nextMeta.nextBefore),
        )
        if (!res.ok) throw new Error(`older page failed (${res.status})`)
        const page = parseMessagePage(await res.json())
        if (!isCurrent()) return
        if (page.messages.length === 0) {
          nextMeta = pageMeta(page)
          break
        }
        older = mergeOlderPage(older, page)
        addedVisible += visibleMessages(page.messages).length
        nextMeta = pageMeta(page)
        if (addedVisible > 0) break
      }
      if (!isCurrent()) return
      if (older.length > 0) {
        // Merge against the live window at landing time so deltas that
        // arrived during the fetch are not rolled back, and anchor the
        // scroll so the prepend does not move what the reader is reading.
        const el = outputRef.current
        if (el)
          prependScrollRef.current = {
            height: el.scrollHeight,
            top: el.scrollTop,
          }
        const nextWindow = mergeOlderPage(messagesRef.current, {
          messages: older,
          ...EMPTY_PAGE_META,
        })
        messagesRef.current = nextWindow
        const payload = JSON.stringify(nextWindow)
        messagesJsonRef.current = payload
        setMessages(nextWindow)
        putCachedMessages(id, payload, nextWindow, nextMeta)
      }
      applyPageMeta(nextMeta)
    } catch {
      if (isCurrent()) setOlderError(true)
    } finally {
      olderLoadingRef.current = false
      if (isCurrent()) setOlderLoading(false)
    }
  }, [sessionId, running, applyPageMeta])

  // Scroll-up trigger: the sentinel at the top of the log loads the next
  // older page as it approaches. After a failure auto-loading stops —
  // the sentinel row's retry button is the way back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length and tab re-observe once the sentinel node (re)mounts
  useEffect(() => {
    const node = topSentinelRef.current
    const root = outputRef.current
    if (!node || !root) return
    if (!pageMetaState.hasMore || olderError) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder()
      },
      { root, rootMargin: "400px 0px 0px 0px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadOlder, pageMetaState.hasMore, olderError, messages.length, tab])

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
        deadThreadsRef.current.add(sessionId)
        writeDraft(localStorage, sessionId, "")
        dropCachedMessages(sessionId)
        setQueueItems([])
        setSessionId("")
        setMessages([])
        localStorage.removeItem(THREAD_KEY)
        pushSearch(
          {
            [PARAM_THREAD]: null,
            [PARAM_PREVIEW]: null,
            [PARAM_SCREEN]: null,
            [PARAM_COUNCIL]: null,
            [PARAM_MEMBER]: null,
            [PARAM_FILEVIEW]: null,
          },
          { replace: true },
        )
        return
      }
      // Live deltas replace the per-event full refetch: message/part events
      // upsert in place, anything uncertain falls back to a full tick.
      if (
        (type === "message.updated" || type === "message.part.updated") &&
        eventTouchesSession(event, sessionId)
      ) {
        // An update to a message older than the loaded window must not
        // append as if new; the next older-page load or tick reconciles.
        const deltaInfo = (
          event.properties as
            | { info?: { id?: unknown; time?: { created?: unknown } } }
            | undefined
        )?.info
        if (
          pageMetaRef.current.hasMore &&
          infoPredatesWindow(messagesRef.current, deltaInfo)
        ) {
          return
        }
        const next = applyMessageDelta(messagesRef.current, event)
        if (next && next !== messagesRef.current) {
          messagesRef.current = next
          const payload = JSON.stringify(next)
          messagesJsonRef.current = payload
          putCachedMessages(sessionId, payload, next, pageMetaRef.current)
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
  }, [
    running,
    subscribe,
    sessionId,
    scheduleTick,
    scheduleMediaLoad,
    pushSearch,
  ])

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
        type === "threads.changed" ||
        type === "councils.changed"
      ) {
        scheduleThreads()
      }
      if (type === "queue.changed") {
        const props = event.properties as { sessionId?: unknown } | undefined
        if (
          typeof props?.sessionId === "string" &&
          props.sessionId === queueSessionRef.current
        ) {
          void loadQueue(props.sessionId)
        }
      }
    })
  }, [running, subscribe, scheduleThreads, loadQueue])

  useEffect(() => {
    if (!running || restoredRef.current || !sessionsLoadedRef.current) return
    restoredRef.current = true
    // An explicit "Nouvelle conversation" intent wins over every automatic
    // restore — phase changes, slow history, reconnections, refocus — until
    // the user picks a thread or the first send creates one. Plain /chat
    // visits restore normally once the intent is gone.
    if (blankChatRef.current && !sessionId) return
    // A thread named by the URL wins over the stored memory and becomes
    // the new memory; a bare /chat restores the stored thread and writes
    // it into the URL (replace — Back must not land on a duplicate /chat).
    if (sessionId) {
      if (sessions.some((item) => item.id === sessionId))
        localStorage.setItem(THREAD_KEY, sessionId)
      return
    }
    const stored = localStorage.getItem(THREAD_KEY)
    if (stored && sessions.some((item) => item.id === stored)) {
      setSessionId(stored)
      setMessagesLoading(true)
      pushSearch({ [PARAM_THREAD]: stored }, { replace: true })
    }
  }, [running, sessions, sessionId, blankChatRef, pushSearch])

  // History traversal (Back/Forward, shell navigation) moves ?thread=;
  // the view follows the URL. User picks push the param themselves and
  // land here already in sync, so this only fires for traversals.
  const appliedThreadParamRef = useRef(threadParam)
  useEffect(() => {
    if (appliedThreadParamRef.current === threadParam) return
    appliedThreadParamRef.current = threadParam
    if (threadParam === sessionId) return
    if (threadParam && deadThreadsRef.current.has(threadParam)) {
      setSessionId("")
      setMessages([])
      setMessagesLoading(false)
      pushSearch({ [PARAM_THREAD]: null }, { replace: true })
      return
    }
    if (threadParam) blankChatRef.current = false
    setSessionId(threadParam)
    setMessages([])
    setMessagesLoading(Boolean(threadParam))
    if (threadParam) localStorage.setItem(THREAD_KEY, threadParam)
  }, [threadParam, sessionId, blankChatRef, pushSearch])

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
    // Shell-driven "new conversation" is a real navigation: Back returns
    // to the thread that was open.
    pushSearch({ [PARAM_THREAD]: null })
  }, [
    tab,
    sessionId,
    blankChatRef, // Shell-driven "new conversation" is a real navigation: Back returns
    // to the thread that was open.
    pushSearch,
  ])

  useEffect(() => {
    // In a split, only the active (focused) pane owns the global
    // notice focus — the other pane must not claim "already looking".
    if (paneNav.active) setNoticeFocus({ tab, sessionId })
  }, [tab, sessionId, paneNav.active])

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
    return () => {
      if (paneNavRef.current.active) setNoticeFocus({ tab: "", sessionId: "" })
    }
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => {
      // Split panes each mount a Workspace; only the active pane
      // answers the global open-thread event.
      if (!paneNavRef.current.active) return
      const id = (event as CustomEvent<{ sessionId?: string }>).detail
        ?.sessionId
      if (!id) return
      // A voluntary open of a specific thread ends the blank intent.
      blankChatRef.current = false
      if (id === sessionId) {
        // Re-opening the visible thread: setSessionId would be a React
        // no-op, so neither the cache-paint effect nor the tick effect
        // re-runs — repaint from cache and force a reconciliation fetch.
        // The catch-up stays visible until the fetch lands.
        const cached = getCachedMessages(id)
        if (cached) {
          messagesJsonRef.current = cached.payload
          messagesRef.current = cached.messages
          setMessages(cached.messages)
          applyPageMeta(cached.page ?? EMPTY_PAGE_META)
        }
        stickRef.current = true
        setAtBottom(true)
        setReadingMode(false)
        setMessagesError(false)
        setMessagesLoading(true)
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
  }, [sessionId, mobile, onTab, blankChatRef, scheduleTick, applyPageMeta])

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
  // Panes themselves now follow the URL (thread picks strip their
  // params; traversals restore them) — only per-thread fetched data
  // resets when the thread changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pane data when the thread changes
  useEffect(() => {
    setPreviewFrame(null)
    setPreviewError("")
    setCouncilData(null)
    setCouncilError("")
  }, [sessionId])
  useEffect(() => {
    if (previewMode === "pane" && mobile) setPreviewMode("overlay")
    if (previewMode === "overlay" && !mobile) setPreviewMode("pane")
    if (councilMode === "pane" && mobile) setCouncilMode("overlay")
    if (councilMode === "overlay" && !mobile) setCouncilMode("pane")
    if (fileMode === "pane" && mobile) setFileMode("overlay")
    if (fileMode === "overlay" && !mobile) setFileMode("pane")
    if (screenMode === "pane" && mobile) setScreenMode("overlay")
    if (screenMode === "overlay" && !mobile) setScreenMode("pane")
  }, [mobile, previewMode, councilMode, fileMode, screenMode])
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode-keyed Escape subscription; the close handlers are render-fresh closures over refs and the identity-stable pane nav
  useEffect(() => {
    if (
      previewMode === "closed" &&
      councilMode === "closed" &&
      fileMode === "closed" &&
      screenMode === "closed"
    )
      return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return
      // One pane at a time, topmost first — the same order Back uses.
      if (lastPaneRef.current === "file" && fileMode !== "closed")
        closeFilePane()
      else if (lastPaneRef.current === "screen" && screenMode !== "closed")
        closeScreenStage()
      else if (lastPaneRef.current === "council" && councilMode !== "closed")
        closeCouncilPane()
      else if (previewMode !== "closed") closePreview()
      else if (screenMode !== "closed") closeScreenStage()
      else if (councilMode !== "closed") closeCouncilPane()
      else if (fileMode !== "closed") closeFilePane()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [previewMode, councilMode, fileMode, screenMode])
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
    const seq = councilLoadGuard.current.begin()
    try {
      const next = await api<CouncilData>(
        `/api/councils/${encodeURIComponent(councilName)}`,
      )
      if (!councilLoadGuard.current.isCurrent(seq)) return
      setCouncilData(next)
      setCouncilError("")
      setCouncilMemberId((current) =>
        next.members.some((member) => member.sessionId === current) ||
        (next.subagents ?? []).some((sub) => sub.sessionId === current)
          ? current
          : (next.members[0]?.sessionId ?? ""),
      )
    } catch (caught) {
      if (!councilLoadGuard.current.isCurrent(seq)) return
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: desktopKey is the manual screen reload
  useEffect(() => {
    if (
      tab === "desktop" ||
      !running ||
      !sessionId ||
      (!needsScreen && screenMode === "closed")
    )
      return
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
  }, [tab, running, sessionId, needsScreen, screenMode, desktopKey])

  useEffect(() => {
    setHeld(false)
    if (!sessionId) {
      setScreenOutcome(null)
    } else {
      const stored = sessionStorage.getItem(`ob-screen-outcome:${sessionId}`)
      const split = stored ? stored.indexOf("|") : -1
      const kind = split > 0 ? stored?.slice(0, split) : ""
      if (stored && (kind === "done" || kind === "later")) {
        setScreenOutcome({ stamp: stored.slice(split + 1), kind })
      } else {
        // Legacy one-way dismiss key: it covered both Done and Close,
        // and Done was the common path.
        const legacy = sessionStorage.getItem(`ob-screen-dismiss:${sessionId}`)
        setScreenOutcome(legacy ? { stamp: legacy, kind: "done" } : null)
      }
    }
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
          sessionStorage.setItem(
            `ob-screen-outcome:${sessionId}`,
            `later|${stamp}`,
          )
          setScreenOutcome({ stamp, kind: "later" })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, held, holdOrigin, sessionId, screen, shown, controlBusy])

  // An older-page prepend grows the log upward: shift the scroll by the
  // added height before paint so the reader stays on the same bubble.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is the trigger — the effect only reads refs and the DOM
  useLayoutEffect(() => {
    const pending = prependScrollRef.current
    if (!pending) return
    prependScrollRef.current = null
    const el = outputRef.current
    if (!el) return
    el.scrollTop = pending.top + (el.scrollHeight - pending.height)
  }, [messages])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shown, tab])

  // Leaving reading mode re-expands the bottom chrome, which shrinks the
  // log viewport and would strand the newest lines below the fold while
  // the reader is stuck to the bottom — re-pin after that layout lands.
  // Entering needs no adjustment: the log only grows downward from the
  // reader's current scroll position.
  useLayoutEffect(() => {
    if (readingMode || tab !== "chat" || !stickRef.current) return
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [readingMode, tab])

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
    // Also watch the log box itself: the reading-mode chrome animates its
    // height (orb row morph, toolbar collapse), which resizes the
    // viewport without changing the inner content — re-pin through the
    // whole animation, not just at its end.
    observer.observe(el)
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
        // Absolute user count: window-local counts would shift every
        // time an older page prepends user messages in front.
        baseline:
          pageMetaRef.current.startUserCount + userMessageCount(messages),
      },
    ])
    setError("")
    if (turnIssue) setDismissedTurnId(turnIssue.messageId || turnIssue.detail)
    stickRef.current = true
    setAtBottom(true)
    setReadingMode(false)
    setSending(true)
    // Only a pick that belongs to this thread may ride the prompt; while
    // a thread switch is still loading its pick the model is omitted and
    // the server stamps the stored one.
    let promptModelKey = model
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
        // The blank model/effort pick rode the create body and is now the
        // new thread's own pick. Re-read the stored truth before the
        // first prompt: the server drops a pick it cannot honor (team
        // lock, unknown model) instead of blocking creation.
        const hadBlankPick = Boolean(
          blankPickRef.current?.modelKey || blankPickRef.current?.effort,
        )
        blankPickRef.current = null
        modelForRef.current = id
        if (hadBlankPick) {
          const payload = await api<ThreadModelPayload>(
            `/api/thread-model?sessionId=${encodeURIComponent(id)}`,
          ).catch(() => null)
          const info = payload?.model
          if (payload && info) {
            pickExplicitRef.current = {
              model: Boolean(
                payload.thread?.providerID && payload.thread?.modelID,
              ),
              effort: Boolean(payload.thread?.thinkingEffort),
            }
            promptModelKey =
              info.providerID && info.modelID
                ? `${info.providerID}/${info.modelID}`
                : ""
            setModel(promptModelKey)
            setEffort(info.thinkingEffort ?? "")
          }
        }
        // First accepted send: the blank intent ends exactly once, with the
        // session the composer text migrates into. The picks are consumed.
        blankChatRef.current = false
        setNewPersonaId("assistant")
        setNewThreadDir("")
        setNewUnlimitedSteps(false)
        setHasBlankDraft(false)
        clearBlankDraft(localStorage, me.id)
        clearComposerSeed()
        setSessionId(id)
        localStorage.setItem(THREAD_KEY, id)
        // The created thread replaces the blank entry: Back leaves to the
        // previous page, not to an empty composer that no longer exists.
        pushSearch({ [PARAM_THREAD]: id }, { replace: true })
        setReceipts((prev) =>
          prev.map((item) =>
            item.id === receiptId ? { ...item, sessionId: id } : item,
          ),
        )
        void loadThreads()
      }
      if (modelForRef.current !== id) promptModelKey = ""
      const split = promptModelKey.indexOf("/")
      const providerID = split > 0 ? promptModelKey.slice(0, split) : ""
      const modelID = split > 0 ? promptModelKey.slice(split + 1) : ""
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
    // A running turn no longer blocks the composer: the message joins
    // the server-persisted waiting list and the control plane sends it
    // when the turn ends. Queued messages render in the dock from the
    // server mirror — never as receipts or bubbles — so nothing can
    // orphan a ghost "En attente" bubble.
    if (sessionId && canStop) {
      try {
        await api(`/api/thread-queue/${encodeURIComponent(sessionId)}`, {
          method: "POST",
          body: JSON.stringify({ text, files }),
        })
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "queue failed")
        rememberJoined(files)
        return false
      }
      void loadQueue(sessionId)
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
    blankPickRef.current = null
    setNewPersonaId("assistant")
    setNewThreadDir(dirId)
    setNewUnlimitedSteps(false)
    if (sessionId) {
      setSessionId("")
      setMessages([])
      setMessagesLoading(false)
    }
    setError("")
    setThreadsOpen(false)
    setDrawerOpen(false)
    onTab("chat")
    // The blank composer is its own history entry (Back returns to the
    // thread that was open); panes of the previous thread do not follow.
    pushSearch({
      [PARAM_THREAD]: null,
      [PARAM_PREVIEW]: null,
      [PARAM_SCREEN]: null,
      [PARAM_COUNCIL]: null,
      [PARAM_MEMBER]: null,
      [PARAM_FILEVIEW]: null,
    })
  }

  function selectThread(id: string) {
    if (id !== sessionId) {
      // An explicit pick from the history ends the blank intent.
      blankChatRef.current = false
      setSessionId(id)
      setMessages([])
      setMessagesLoading(true)
      localStorage.setItem(THREAD_KEY, id)
      pushSearch({
        [PARAM_THREAD]: id,
        [PARAM_PREVIEW]: null,
        [PARAM_SCREEN]: null,
        [PARAM_COUNCIL]: null,
        [PARAM_MEMBER]: null,
        [PARAM_FILEVIEW]: null,
      })
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
    pickSeqRef.current += 1
    pickExplicitRef.current = { ...pickExplicitRef.current, model: true }
    if (sessionId) {
      modelForRef.current = sessionId
      settingsSaver.selectModel({ value, previous: model, sessionId })
    } else {
      // No thread yet: the pick stays pending for the thread the first
      // send creates — it never rewrites the desktop default.
      blankPickRef.current = { ...blankPickRef.current, modelKey: value }
    }
  }

  function selectEffort(value: string) {
    setEffort(value)
    pickSeqRef.current += 1
    pickExplicitRef.current = {
      ...pickExplicitRef.current,
      effort: value !== "",
    }
    if (sessionId) {
      modelForRef.current = sessionId
      settingsSaver.selectEffort({ value, previous: effort, sessionId })
    } else {
      blankPickRef.current = { ...blankPickRef.current, effort: value }
    }
  }

  // Follow server-side model/effort changes (Config page saves, admin
  // overlays) while no local save is queued or settling — otherwise the
  // optimistic picker state wins until its own response arrives. Only
  // halves without an explicit per-thread pick follow the desktop
  // default; a pinned half is this thread's alone.
  const serverModelKey =
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : ""
  const serverEffort = me.model?.thinkingEffort ?? ""
  const serverModelKeyRef = useRef(serverModelKey)
  serverModelKeyRef.current = serverModelKey
  const serverEffortRef = useRef(serverEffort)
  serverEffortRef.current = serverEffort
  useEffect(() => {
    if (settingsSaver.busy()) return
    if (modelForRef.current !== sessionId) return
    if (!pickExplicitRef.current.model)
      setModel((current) =>
        !serverModelKey || current === serverModelKey
          ? current
          : serverModelKey,
      )
    if (!pickExplicitRef.current.effort)
      setEffort((current) =>
        current === serverEffort ? current : serverEffort,
      )
  }, [serverModelKey, serverEffort, settingsSaver, sessionId])

  // On thread switch the picker reloads that thread's effective pick.
  // Until it lands, modelForRef still names the previous thread, so a
  // prompt sent in that window omits the model and the server stamps the
  // stored pick — the previous thread's model can never leak in.
  useEffect(() => {
    if (!sessionId) {
      modelForRef.current = ""
      const pending = blankPickRef.current
      pickExplicitRef.current = {
        model: Boolean(pending?.modelKey),
        effort: Boolean(pending?.effort),
      }
      setModel(pending?.modelKey || serverModelKeyRef.current)
      setEffort(pending?.effort ?? serverEffortRef.current)
      return
    }
    blankPickRef.current = null
    const token = threadModelGuard.current.begin()
    const pickSeq = pickSeqRef.current
    void api<ThreadModelPayload>(
      `/api/thread-model?sessionId=${encodeURIComponent(sessionId)}`,
    )
      .then((payload) => {
        if (!threadModelGuard.current.isCurrent(token)) return
        if (activeSessionRef.current !== sessionId) return
        // The user already picked on this thread while loading — their
        // optimistic pick (and its save) owns the picker now.
        if (pickSeqRef.current !== pickSeq) return
        pickExplicitRef.current = {
          model: Boolean(payload.thread?.providerID && payload.thread?.modelID),
          effort: Boolean(payload.thread?.thinkingEffort),
        }
        modelForRef.current = sessionId
        const info = payload.model
        setModel(
          info?.providerID && info.modelID
            ? `${info.providerID}/${info.modelID}`
            : "",
        )
        setEffort(info?.thinkingEffort ?? "")
      })
      .catch(() => {
        // Leave modelForRef on the previous thread: prompts omit the
        // model and the server stamps this thread's stored pick.
      })
  }, [sessionId])

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
    const pending = blankPickRef.current
    const split = pending?.modelKey ? pending.modelKey.indexOf("/") : -1
    return JSON.stringify({
      ...(newPersonaId && newPersonaId !== "assistant"
        ? { personaId: newPersonaId }
        : {}),
      ...(newThreadDir ? { dirId: newThreadDir } : {}),
      ...(newUnlimitedSteps ? { steps: "unlimited" } : {}),
      // The blank composer's model/effort pick becomes the new thread's
      // own pick on the server — never the desktop default.
      ...(pending?.modelKey && split > 0
        ? {
            model: {
              providerID: pending.modelKey.slice(0, split),
              modelID: pending.modelKey.slice(split + 1),
            },
          }
        : {}),
      ...(pending?.effort ? { thinkingEffort: pending.effort } : {}),
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
      deadThreadsRef.current.add(target.id)
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
        pushSearch(
          {
            [PARAM_THREAD]: null,
            [PARAM_PREVIEW]: null,
            [PARAM_SCREEN]: null,
            [PARAM_COUNCIL]: null,
            [PARAM_MEMBER]: null,
            [PARAM_FILEVIEW]: null,
          },
          { replace: true },
        )
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
        deadThreadsRef.current.add(id)
        writeDraft(localStorage, id, "")
        dropCachedMessages(id)
        joinedStore.current.delete(id)
        seenThread(id)
        if (id === activeId) {
          setSessionId("")
          setMessages([])
          setMessagesLoading(false)
          localStorage.removeItem(THREAD_KEY)
          pushSearch(
            {
              [PARAM_THREAD]: null,
              [PARAM_PREVIEW]: null,
              [PARAM_SCREEN]: null,
              [PARAM_COUNCIL]: null,
              [PARAM_MEMBER]: null,
              [PARAM_FILEVIEW]: null,
            },
            { replace: true },
          )
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

  // Stop council: abort every running member/subagent turn of the open
  // council through the same per-session abort as the main thread's Stop.
  // Turns cancel in place — sessions, transcripts, and the council
  // itself stay (closing/deleting is ob-thread council close).
  async function stopCouncil() {
    if (!councilData) return
    const ids = councilRunningIds(councilData, councilStatusOf)
    if (ids.length === 0) return
    setError("")
    const results = await Promise.allSettled(
      ids.map((id) =>
        api(`/api/opencode/session/${encodeURIComponent(id)}/abort`, {
          method: "POST",
        }),
      ),
    )
    const failed = results.filter((result) => result.status === "rejected")
    if (failed.length > 0) {
      const first = failed[0]
      const detail =
        first?.status === "rejected" && first.reason instanceof Error
          ? first.reason.message
          : ""
      setError(
        `Could not stop ${failed.length} of ${ids.length} council members${detail ? `: ${detail}` : ""}`,
      )
    }
  }

  // Force-send: jump the queue and interrupt the running turn; the idle
  // transition flushes the promoted message right away.
  // Send-now: the server promotes the item to the head and interrupts
  // the running turn (or sends at once when idle). A dead-turn banner
  // holds the queue for the resume flow; forcing a send is an
  // explicit user decision that steps over it, here and server-side.
  async function sendNowQueued(itemId: string) {
    if (!sessionId || queueBusyId) return
    if (turnIssue) setDismissedTurnId(turnIssue.messageId || turnIssue.detail)
    setQueueBusyId(itemId)
    try {
      await api(
        `/api/thread-queue/${encodeURIComponent(sessionId)}/${encodeURIComponent(itemId)}/send-now`,
        { method: "POST" },
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "send-now failed")
    } finally {
      setQueueBusyId("")
      void loadQueue(sessionId)
    }
  }

  async function removeQueuedMessage(itemId: string) {
    if (!sessionId || queueBusyId) return
    setQueueBusyId(itemId)
    try {
      await api(
        `/api/thread-queue/${encodeURIComponent(sessionId)}/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      )
      setQueueItems((prev) => prev.filter((item) => item.id !== itemId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setQueueBusyId("")
    }
  }

  async function saveQueuedEdit(
    item: ThreadQueueItemView,
    text: string,
    files: ThreadQueueFileView[],
  ): Promise<boolean> {
    if (!sessionId) return false
    setQueueBusyId(item.id)
    try {
      const data = await api<{ item?: ThreadQueueItemView }>(
        `/api/thread-queue/${encodeURIComponent(sessionId)}/${encodeURIComponent(item.id)}`,
        { method: "PATCH", body: JSON.stringify({ text, files }) },
      )
      if (data.item)
        setQueueItems((prev) =>
          prev.map((row) =>
            row.id === item.id && data.item ? data.item : row,
          ),
        )
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "edit failed")
      return false
    } finally {
      setQueueBusyId("")
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

  function writeScreenOutcome(
    id: string,
    stamp: string,
    kind: "done" | "later",
  ) {
    sessionStorage.setItem(`ob-screen-outcome:${id}`, `${kind}|${stamp}`)
    sessionStorage.removeItem(`ob-screen-dismiss:${id}`)
    setScreenOutcome({ stamp, kind })
  }

  function stampScreenOutcome(kind: "done" | "later") {
    if (!sessionId) return
    const stamp = lastHandoffStamp(shown)
    if (!stamp) return
    writeScreenOutcome(sessionId, stamp, kind)
  }

  function clearScreenOutcome() {
    if (sessionId) {
      sessionStorage.removeItem(`ob-screen-outcome:${sessionId}`)
      sessionStorage.removeItem(`ob-screen-dismiss:${sessionId}`)
    }
    setScreenOutcome(null)
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
      clearScreenOutcome()
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
        writeScreenOutcome(sessionId, stamp, notify ? "done" : "later")
      }
      if (notify) {
        void prompt(SCREEN_DONE_PROMPT)
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
    // Topmost pane closes by traversing Back; with the council also open
    // this pane may not be the top entry, so strip its param in place.
    if (councilParam || fileParam || screenParam)
      pushSearch({ [PARAM_PREVIEW]: null }, { replace: true })
    else
      backOr(
        paneNavRef.current.pathname +
          patchSearch(paneNavRef.current.search, { [PARAM_PREVIEW]: null }),
      )
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
    if (previewParam || fileParam || screenParam)
      pushSearch(
        { [PARAM_COUNCIL]: null, [PARAM_MEMBER]: null },
        { replace: true },
      )
    else
      backOr(
        paneNavRef.current.pathname +
          patchSearch(paneNavRef.current.search, {
            [PARAM_COUNCIL]: null,
            [PARAM_MEMBER]: null,
          }),
      )
  }

  // In-viewer group switch: swap the open council in place, keeping the
  // pane/overlay mode (and any fullscreen) instead of closing back to
  // the floating Councils button.
  function switchCouncil(name: string) {
    if (!name || name.toLowerCase() === councilName.toLowerCase()) return
    councilLoadGuard.current.begin()
    setCouncilData(null)
    setCouncilError("")
    setCouncilMemberId("")
    setCouncilName(name)
    // The open council syncs from ?council= (see the effect above), so
    // the switch must land there too — a state-only change is reverted
    // to the council still named in the URL. Replace, like member
    // switches: Back still closes the viewer instead of stepping
    // through every council the user flipped through.
    pushSearch(councilSwitchPatch(name), { replace: true })
  }

  function onFileDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startW = fileWidthRef.current
    const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
    document.body.classList.add("ob-preview-dragging")
    const move = (next: PointerEvent) => {
      const width = clampPreviewWidth(startW - (next.clientX - startX), parent)
      fileWidthRef.current = width
      setFileWidth(width)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("ob-preview-dragging")
      sessionStorage.setItem("ob-file-width", String(fileWidthRef.current))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function openFileFullscreen() {
    const el = filePaneRef.current
    if (!el?.requestFullscreen) {
      setFileMode("overlay")
      return
    }
    void el.requestFullscreen().catch(() => setFileMode("overlay"))
  }

  function closeFilePane() {
    if (document.fullscreenElement) void document.exitFullscreen()
    setFileMode("closed")
    if (previewParam || councilParam || screenParam)
      pushSearch({ [PARAM_FILEVIEW]: null }, { replace: true })
    else
      backOr(
        paneNavRef.current.pathname +
          patchSearch(paneNavRef.current.search, {
            [PARAM_FILEVIEW]: null,
          }),
      )
  }

  function onScreenDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startW = screenWidthRef.current
    const parent = previewRowRef.current?.clientWidth ?? window.innerWidth
    document.body.classList.add("ob-preview-dragging")
    const move = (next: PointerEvent) => {
      const width = clampPreviewWidth(startW - (next.clientX - startX), parent)
      screenWidthRef.current = width
      setScreenWidth(width)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("ob-preview-dragging")
      sessionStorage.setItem("ob-screen-width", String(screenWidthRef.current))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function openScreenFullscreen() {
    const el = screenPaneRef.current
    if (!el?.requestFullscreen) {
      setScreenMode("overlay")
      return
    }
    void el.requestFullscreen().catch(() => setScreenMode("overlay"))
  }

  function closeScreenStage() {
    if (document.fullscreenElement) void document.exitFullscreen()
    setScreenMode("closed")
    if (previewParam || councilParam || fileParam)
      pushSearch({ [PARAM_SCREEN]: null }, { replace: true })
    else
      backOr(
        paneNavRef.current.pathname +
          patchSearch(paneNavRef.current.search, { [PARAM_SCREEN]: null }),
      )
  }

  // Stage (pane/overlay) hand-back tells the agent when the hold began
  // in the chat; a Desktop-tab hold stays silent, as before.
  function toggleStageControl() {
    if (held) void releaseControl(holdOrigin === "chat")
    else void takeControl()
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
      <FilePreviewContext.Provider value={openChatFile}>
        <Stack
          ref={workspaceRef}
          className={
            narrowPane ? "ob-workspace ob-workspace-narrow" : "ob-workspace"
          }
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
                {!threadsOpen &&
                sessions.some((item) => showUnread(item.id)) ? (
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
                    chatDocked
                      ? "ob-chat-paper ob-chat-docked"
                      : "ob-chat-paper"
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
                      <CheckBox
                        checked={newUnlimitedSteps}
                        aria-label="Sans limite d'étapes"
                        disabled={actionBusy}
                        onChange={() => setNewUnlimitedSteps((value) => !value)}
                        sx={{ ml: 0.5 }}
                      />
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        title="Sans la limite d'étapes par tour (512 par défaut, réglable dans Config → Chat) — pour les longues tâches (conseils, gros builds)"
                      >
                        Sans limite d'étapes
                      </Typography>
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
                  {/* Opening a thread with a cached transcript paints it
                    instantly; while the catch-up fetch reconciles against
                    opencode, skeleton bubbles at the end of the log (in
                    the timeline branch below) say newer messages may
                    still land — no status row above the log. */}
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
                      const gap =
                        el.scrollHeight - el.scrollTop - el.clientHeight
                      setReadingMode((current) => nextReadingMode(gap, current))
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
                          <MessageSkeletons
                            rows={5}
                            label={THREADS_UI.loadingMessages}
                          />
                        </Stack>
                      </Stack>
                    ) : messagesError && shown.length === 0 ? (
                      <Stack
                        alignItems="center"
                        justifyContent="center"
                        sx={{ flex: 1, minHeight: 160, textAlign: "center" }}
                        spacing={1}
                      >
                        <Typography variant="subtitle1" component="p">
                          {THREADS_UI.messagesLoadFailed}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setMessagesLoading(true)
                            scheduleTick()
                          }}
                        >
                          {THREADS_UI.retry}
                        </Button>
                      </Stack>
                    ) : shown.length === 0 && !pageMetaState.hasMore ? (
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
                        {pageMetaState.hasMore ? (
                          <div ref={topSentinelRef} className="ob-load-older">
                            {olderLoading ? (
                              <MessageSkeletons
                                rows={3}
                                label={THREADS_UI.loadingOlder}
                              />
                            ) : olderError ? (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => void loadOlder()}
                              >
                                {`${THREADS_UI.olderLoadFailed} ${THREADS_UI.retry}`}
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => void loadOlder()}
                              >
                                {THREADS_UI.loadOlder}
                              </Button>
                            )}
                          </div>
                        ) : null}
                        {timeline.map((row) =>
                          row.kind === "work" ? (
                            <WorkLine key={row.key} work={row.work} />
                          ) : (
                            <MessageBubble
                              key={bubbleKeys[row.index]}
                              entry={row.entry}
                              index={row.index}
                              bubbleKey={bubbleKeys[row.index] ?? ""}
                              speechKey={speakingKey}
                              speechLoading={speechLoadingKey}
                              lastHandoff={lastHandoff}
                              held={held}
                              screenOutcome={screenOutcome}
                              screenLive={screenLive}
                              screenPath={screen?.path ?? ""}
                              screenError={screenError}
                              screenOpened={screenMode !== "closed"}
                              screenReloadKey={desktopKey}
                              running={running}
                              sending={sending}
                              stopping={stopping}
                              controlBusy={controlBusy}
                              renderers={pluginRenderers}
                              onTakeControl={bubbleActions.takeControl}
                              onScreenDone={bubbleActions.screenDone}
                              onReleaseSilent={bubbleActions.releaseSilent}
                              onScreenLater={bubbleActions.screenLater}
                              onScreenResume={bubbleActions.screenResume}
                              onOpenScreen={bubbleActions.openScreen}
                              onCloseScreen={bubbleActions.closeScreen}
                              onScreenRetry={bubbleActions.screenRetry}
                              onStartDesktop={bubbleActions.startDesktop}
                              onOpenPreview={bubbleActions.openPreview}
                              onOpenCouncil={bubbleActions.openCouncil}
                              openedCouncil={
                                councilMode !== "closed" ? councilName : ""
                              }
                              previewLive={showLivePreview({
                                preview: Boolean(row.entry.message.preview),
                                isLast: row.index === lastPreview,
                              })}
                              previewOpened={previewMode !== "closed"}
                              previewSrc={previewSrc}
                              previewError={previewError}
                              onSpeak={speakText}
                              onStopSpeak={stopSpeaking}
                            />
                          ),
                        )}
                        {messagesLoading ? (
                          <MessageSkeletons
                            rows={2}
                            label={THREADS_UI.messagesCatchingUp}
                          />
                        ) : null}
                        <QueueDock
                          items={queueItems}
                          busyId={queueBusyId}
                          onSendNow={(id) => void sendNowQueued(id)}
                          onRemove={(id) => void removeQueuedMessage(id)}
                          onSaveEdit={saveQueuedEdit}
                        />
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
                            setReadingMode(false)
                            if (el) el.scrollTop = el.scrollHeight
                          }}
                        >
                          <ChevronDownIcon width={16} height={16} />
                          Jump to latest
                        </button>
                      </div>
                    ) : null}
                    {councilMode === "closed" &&
                    threadCouncilRows.length > 0 ? (
                      <div className="ob-councils-fab-wrap">
                        <div ref={councilFabRef}>
                          <button
                            type="button"
                            className="ob-councils-fab"
                            aria-haspopup="menu"
                            aria-expanded={councilMenuOpen}
                            onClick={() => setCouncilMenuOpen((open) => !open)}
                          >
                            <GroupsIcon width={16} height={16} />
                            Councils ({threadCouncilRows.length})
                            {councilsRunning > 0 ? (
                              <span className="ob-councils-fab-dot" />
                            ) : null}
                          </button>
                          <Menu
                            open={councilMenuOpen}
                            anchorEl={councilFabRef}
                            placement="top"
                            closeOnScroll={false}
                            onClose={() => setCouncilMenuOpen(false)}
                          >
                            {threadCouncilRows.map((row) => (
                              <ListItemButton
                                key={row.id || row.name}
                                onClick={() => {
                                  setCouncilMenuOpen(false)
                                  bubbleActions.openCouncil(row.name)
                                }}
                              >
                                <ListItemText
                                  primary={row.name}
                                  secondary={
                                    row.members > 0
                                      ? `${row.members} member${row.members === 1 ? "" : "s"}${row.running > 0 ? ` · ${row.running} running` : ""}`
                                      : undefined
                                  }
                                />
                              </ListItemButton>
                            ))}
                          </Menu>
                        </div>
                      </div>
                    ) : null}
                    {(screenWaiting ||
                      (held && holdOrigin === "chat" && !atBottom)) &&
                    screenMode === "closed" ? (
                      <div className="ob-screen-fab-wrap">
                        <button
                          type="button"
                          className="ob-screen-fab"
                          onClick={() => {
                            if (screenWaiting) bubbleActions.screenResume()
                            const el = outputRef.current
                            stickRef.current = true
                            setAtBottom(true)
                            setReadingMode(false)
                            if (el) el.scrollTop = el.scrollHeight
                          }}
                        >
                          <ComputerIcon width={16} height={16} />
                          {held && holdOrigin === "chat"
                            ? THREADS_UI.screenYouDriveShort
                            : THREADS_UI.screenWaitingPill}
                          <span className="ob-councils-fab-dot" />
                        </button>
                      </div>
                    ) : null}
                  </Box>
                  {visibleTurnIssue && (tab === "chat" || chatDocked) ? (
                    <Alert
                      severity={
                        visibleTurnIssue.retryable ? "warning" : "error"
                      }
                      sx={{ flexShrink: 0 }}
                      action={
                        <Stack
                          direction="row"
                          spacing={0.5}
                          alignItems="center"
                        >
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
                  {/* The held screen lives in its handoff card now (ScreenCard);
                      the old takeover block pinned above the composer is gone. */}
                  {/* Full-size orb at the bottom only. In reading mode the
                    same animation lives inside the composer pill (mini
                    orb + status on the field line) — one surface, no
                    separate row or divider competing with it. */}
                  {orb && (!readingMode || orbRowLeaving) ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      className={
                        readingMode
                          ? "ob-orb-row ob-orb-row-leave"
                          : "ob-orb-row"
                      }
                      sx={{
                        px: mobile ? 1 : 2,
                        pt: 0.5,
                        flexShrink: 0,
                        alignSelf: "center",
                      }}
                    >
                      {/* Same canvas across the switch: the size prop flips
                          and CSS transitions its box, so the sphere itself
                          shrinks instead of one orb popping out and another
                          popping in. While leaving, the pill's own status
                          owns the live announcement. */}
                      <AgentOrb
                        state={orb}
                        size={orbSizePx(mobile, readingMode)}
                      />
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        role={readingMode ? undefined : "status"}
                      >
                        {activityLabel}
                      </Typography>
                    </Stack>
                  ) : null}
                  {readingMode ? null : <Divider />}
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
                    reading={readingMode}
                    activityOrb={orb}
                    activityLabel={activityLabel}
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
                  onSelect={selectCouncilMember}
                  subscribe={subscribe}
                  live={live}
                  mobile={mobile}
                  councils={councilSwitcherRows}
                  selectedCouncilName={councilName}
                  onSelectCouncil={switchCouncil}
                  onStop={stopCouncil}
                />
              ) : null}
              {councilMode === "pane" && !councilData ? (
                <div
                  className="ob-preview-pane"
                  style={{ width: councilWidth }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    className="ob-preview-bar"
                  >
                    <Typography variant="caption" sx={{ flex: 1 }}>
                      Council{councilName ? ` ${councilName}` : ""}
                    </Typography>
                    <Button
                      size="small"
                      variant="text"
                      onClick={closeCouncilPane}
                    >
                      Close
                    </Button>
                  </Stack>
                  <CouncilGroupSwitcher
                    councils={councilSwitcherRows}
                    selectedName={councilName}
                    onSelect={switchCouncil}
                  />
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ p: 2 }}
                  >
                    {!running
                      ? "Start the desktop to view this council."
                      : councilError || "Opening council…"}
                  </Typography>
                </div>
              ) : null}
              {fileMode === "pane" && fileSrc ? (
                <FilePreviewPane
                  path={filePath}
                  src={fileSrc}
                  width={fileWidth}
                  paneRef={filePaneRef}
                  onClose={closeFilePane}
                  onFullscreen={openFileFullscreen}
                  onDrag={onFileDrag}
                />
              ) : null}
              {screenMode === "pane" ? (
                <ScreenPane
                  title={screenTitle}
                  path={screen?.sessionId === sessionId ? screen.path : ""}
                  error={screenError}
                  held={held}
                  reloadKey={desktopKey}
                  controlDisabled={
                    !running || sending || stopping || controlBusy
                  }
                  onToggleControl={toggleStageControl}
                  onReload={() => setDesktopKey((key) => key + 1)}
                  apps={screenApps}
                  width={screenWidth}
                  paneRef={screenPaneRef}
                  onClose={closeScreenStage}
                  onFullscreen={openScreenFullscreen}
                  onDrag={onScreenDrag}
                />
              ) : null}
            </Box>
          </Box>
          {previewMode === "overlay" && previewSrc ? (
            <PreviewOverlay src={previewSrc} onClose={closePreview} />
          ) : null}
          {screenMode === "overlay" ? (
            <ScreenOverlay
              title={screenTitle}
              path={screen?.sessionId === sessionId ? screen.path : ""}
              error={screenError}
              held={held}
              reloadKey={desktopKey}
              controlDisabled={!running || sending || stopping || controlBusy}
              onToggleControl={toggleStageControl}
              onReload={() => setDesktopKey((key) => key + 1)}
              apps={screenApps}
              onClose={closeScreenStage}
            />
          ) : null}
          {councilMode === "overlay" && councilData ? (
            <CouncilOverlay
              data={councilData}
              selectedId={councilMemberId}
              statusOf={councilStatusOf}
              onClose={closeCouncilPane}
              onSelect={selectCouncilMember}
              subscribe={subscribe}
              live={live}
              mobile={mobile}
              councils={councilSwitcherRows}
              selectedCouncilName={councilName}
              onSelectCouncil={switchCouncil}
              onStop={stopCouncil}
            />
          ) : null}
          {councilMode === "overlay" && !councilData ? (
            <div className="ob-preview-overlay">
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
                  Council{councilName ? ` ${councilName}` : ""}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  onClick={closeCouncilPane}
                >
                  Close
                </Button>
              </Stack>
              <CouncilGroupSwitcher
                councils={councilSwitcherRows}
                selectedName={councilName}
                onSelect={switchCouncil}
              />
              <Typography variant="body2" sx={{ color: "#fff", p: 2 }}>
                {!running
                  ? "Start the desktop to view this council."
                  : councilError || "Opening council…"}
              </Typography>
            </div>
          ) : null}
          {fileMode === "overlay" && fileSrc ? (
            <FilePreviewOverlay
              path={filePath}
              src={fileSrc}
              onClose={closeFilePane}
            />
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
              <ScreenStage
                title={screenTitle}
                path={screen?.sessionId === sessionId ? screen.path : ""}
                error={screenError}
                held={held}
                reloadKey={desktopKey}
                controlDisabled={!running || stopping || controlBusy}
                onToggleControl={() =>
                  void (held ? releaseControl(false) : takeControl())
                }
                onReload={() => setDesktopKey((key) => key + 1)}
                apps={screenApps}
              />
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
            <MediaVault
              subscribe={subscribe}
              onOpenChat={() => onTab("chat")}
            />
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
                  <ListItemButton
                    onClick={() => void abortThread(menuThread.id)}
                  >
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
                {moveMenuThread &&
                threadDirMap[moveMenuThread.id] === dir.id ? (
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
                  onChange={(event) =>
                    setRenameTitle(event.currentTarget.value)
                  }
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
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ mb: 1 }}
                >
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
      </FilePreviewContext.Provider>
    </ProjectRefsContext.Provider>
  )
}
