import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Typography from "@shpaw415/mui-lite/Typography"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ChatMarkdown } from "./chat-markdown"
import {
  applyMessageDelta,
  type ChatMessage,
  eventTouchesSession,
  nearBottom,
  type StreamEvent,
  type TranscriptEntry,
  transcriptBubbles,
  visibleMessages,
} from "./chat-view"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ContentCopyIcon,
  StopIcon,
} from "./icons"
import { createLatestGuard } from "./latest-guard"
import { MediaImage } from "./MediaDownload"
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
import { clampPreviewWidth } from "./PreviewView"
import { PARAM_COUNCIL, PARAM_MEMBER } from "./routes"
import Stack from "./stack"
import { THREADS_UI } from "./texts"
import { WorkLine } from "./thread-timeline"
import { formatWhen } from "./time"
import { type TimelineRow, timelineRows } from "./timeline"

export type CouncilMemberInfo = {
  sessionId: string
  role: string
  title: string
  createdAt: number
  // Creation picks (optional so an older control plane still renders).
  persona?: string
  model?: string
  effort?: string
}

// A task-tool subagent (opencode child session) of one of the members,
// derived by the control plane from the live session list. Optional so an
// older control plane without the field still renders.
export type CouncilSubagentInfo = {
  sessionId: string
  parentId: string
  title: string
  createdAt: number
}

export type CouncilData = {
  id: string
  name: string
  createdAt: number
  members: CouncilMemberInfo[]
  subagents?: CouncilSubagentInfo[]
}

/** One switchable council group, as the viewer header needs it. */
export type CouncilGroupOption = {
  name: string
  members: number
  running: number
}

export function councilRunning(status: { type?: string } | undefined): boolean {
  return Boolean(status && status.type !== "idle")
}

function memberLabel(member: CouncilMemberInfo): string {
  const title = member.title.replace(/^worker:/, "").trim()
  const role = member.role.trim()
  return title || role || member.sessionId.slice(0, 12)
}

/**
 * Secondary rail line: the role (when the title already carries the label
 * slot) plus the member's creation picks — persona, model, effort — so the
 * user sees exactly how each member of the team was configured.
 */
export function memberMetaText(member: CouncilMemberInfo): string {
  const parts: string[] = []
  if (member.title.trim() && member.role.trim()) parts.push(member.role.trim())
  if (member.persona?.trim()) parts.push(member.persona.trim())
  if (member.model?.trim()) parts.push(member.model.trim())
  if (member.effort?.trim()) parts.push(`effort: ${member.effort.trim()}`)
  return parts.join(" · ")
}

function subagentLabel(sub: CouncilSubagentInfo): string {
  const title = sub.title.replace(/^worker:/, "").trim()
  return title || sub.sessionId.slice(0, 12)
}

function CouncilDot({ live }: { live: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        background: live ? "#2e7d32" : "rgba(127,127,127,0.45)",
      }}
    />
  )
}

/**
 * Session ids of the council's running members and subagents, members
 * first — the stop button's abort targets.
 */
export function councilRunningIds(
  data: CouncilData,
  statusOf: (sessionId: string) => { type?: string } | undefined,
): string[] {
  return [...data.members, ...(data.subagents ?? [])]
    .filter((member) => councilRunning(statusOf(member.sessionId)))
    .map((member) => member.sessionId)
}

/**
 * Header stop for the whole council: aborts every running member (and
 * subagent) through the caller's `onStop`. Sessions and transcripts
 * survive — this cancels the current turns, it does not close the
 * council. Hidden when nothing runs; busy while the aborts land.
 */
function CouncilStopButton({
  runningCount,
  onStop,
}: {
  runningCount: number
  onStop: () => Promise<void>
}) {
  const [stopping, setStopping] = useState(false)
  if (runningCount === 0) return null
  return (
    <Button
      size="small"
      variant="contained"
      color="error"
      startIcon={<StopIcon width={14} height={14} />}
      disabled={stopping}
      onClick={() => {
        setStopping(true)
        void onStop().finally(() => setStopping(false))
      }}
    >
      {stopping ? "Stopping…" : "Stop council"}
    </Button>
  )
}

// One transcript bubble, same DOM as the main thread's MessageBubble
// (Workspace): ob-msg wrapper, CSS-only bubble surface, attached images,
// and the quiet meta row underneath (time · copy). The main bubble's
// thread-bound extras — screen handoff, preview embed, read-aloud, send
// marks, plugin cards — stay out: they act on the open dashboard
// thread, not on a member's worker session.
function CouncilBubble({ entry }: { entry: TranscriptEntry }) {
  const message = entry.message
  const mine = message.info?.role === "user"
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    },
    [],
  )
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
    // Plain title, not the main bubble's Tip: the tooltip portals, and
    // this read-only transcript is also server-rendered in tests.
    <IconButton
      size="small"
      title={copied ? THREADS_UI.copiedMessage : THREADS_UI.copyMessage}
      aria-label={THREADS_UI.copyMessage}
      onClick={copyMessage}
    >
      {copied ? (
        <CheckCircleIcon width={15} height={15} />
      ) : (
        <ContentCopyIcon width={15} height={15} />
      )}
    </IconButton>
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
          {message.text.trim() ? <ChatMarkdown text={message.text} /> : null}
          {message.images.map((src) => (
            <MediaImage key={src} src={src} />
          ))}
        </div>
      </Box>
      {mine ? (
        <div className="ob-msg-meta ob-msg-meta-user">
          {timeMark}
          {copyButton}
        </div>
      ) : copyButton || timeMark ? (
        <div className="ob-msg-meta">
          {copyButton}
          {timeMark}
        </div>
      ) : null}
    </div>
  )
}

// The main thread's derived rows for one member: burst-merged bubbles
// (transcriptBubbles, no receipts on a read-only transcript) interleaved
// with one WorkLine per assistant turn — the tool calls a member made,
// previously invisible here. `startUserCount` anchors the lazily loaded
// window exactly like the main log.
function councilTimelineRows(
  messages: ChatMessage[],
  startUserCount: number,
  running: boolean,
): TimelineRow[] {
  const entries = transcriptBubbles(messages, [], undefined, startUserCount)
  return timelineRows(entries, messages, { live: running })
}

function CouncilRows({ rows }: { rows: TimelineRow[] }) {
  return (
    <>
      {rows.map((row) =>
        row.kind === "work" ? (
          <WorkLine key={row.key} work={row.work} />
        ) : (
          <CouncilBubble
            key={row.entry.message.info?.id ?? `bubble-${row.index}`}
            entry={row.entry}
          />
        ),
      )}
    </>
  )
}

/** A member transcript rendered exactly like the main message thread. */
export function CouncilTimeline({
  messages,
  startUserCount,
  running = false,
}: {
  messages: ChatMessage[]
  startUserCount: number
  running?: boolean
}) {
  const rows = useMemo(
    () => councilTimelineRows(messages, startUserCount, running),
    [messages, startUserCount, running],
  )
  return <CouncilRows rows={rows} />
}

// Read-only transcript of one council member: the main thread's timeline
// UI (burst-merged bubbles + per-turn work rows with the tool calls),
// fed by the same message route the dashboard polls, live-updated from
// the shared event stream. `running` is the member's own busy state —
// it marks the last turn's work row as still in progress.
function MemberTranscript({
  sessionId,
  subscribe,
  live,
  running,
}: {
  sessionId: string
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  live: boolean
  running: boolean
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const messagesRef = useRef<ChatMessage[]>([])
  // Lazy history like the main chat: newest page first, older pages
  // prepended on scroll, meta describes where the window starts.
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
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  // Stick-to-bottom like the main chat: pin on new content only while the
  // reader is at the bottom, so scrolling up to read history survives
  // streaming deltas and debounced refetches.
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  // Guard: a load for the previous member must not paint after the switch —
  // same race as the main chat's tick.
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])
  const loadGuard = useRef(createLatestGuard())

  const load = useCallback(async () => {
    const id = sessionId
    const seq = loadGuard.current.begin()
    const isCurrent = () =>
      loadGuard.current.isCurrent(seq) && sessionIdRef.current === id
    try {
      const res = await fetch(
        messagePageUrl(id, tailLimit(messagesRef.current.length)),
      )
      const body = await res.json()
      if (!isCurrent()) return
      const page = parseMessagePage(body)
      const merged = mergeTailPage(messagesRef.current, page)
      messagesRef.current = merged.messages
      setMessages(merged.messages)
      applyPageMeta(
        merged.keptPrefix
          ? { ...pageMetaRef.current, total: page.total }
          : pageMeta(page),
      )
      setError("")
    } catch {
      if (!isCurrent()) return
      setError("could not load this member's thread")
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [sessionId, applyPageMeta])

  useEffect(() => {
    messagesRef.current = []
    setMessages([])
    setLoading(true)
    setError("")
    applyPageMeta(EMPTY_PAGE_META)
    olderGuard.current.begin()
    olderLoadingRef.current = false
    setOlderLoading(false)
    setOlderError(false)
    prependScrollRef.current = null
    void load()
  }, [load, applyPageMeta])

  // Pull one older page in front of the window (see Workspace.loadOlder):
  // tool-only pages render nothing, so the walk continues, bounded,
  // until a visible bubble lands.
  const loadOlder = useCallback(async () => {
    const id = sessionId
    if (olderLoadingRef.current) return
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
        const el = scrollRef.current
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
        setMessages(nextWindow)
      }
      applyPageMeta(nextMeta)
    } catch {
      if (isCurrent()) setOlderError(true)
    } finally {
      olderLoadingRef.current = false
      if (isCurrent()) setOlderLoading(false)
    }
  }, [sessionId, applyPageMeta])

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length and loading re-observe once the sentinel node (re)mounts
  useEffect(() => {
    const node = topSentinelRef.current
    const root = scrollRef.current
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
  }, [loadOlder, pageMetaState.hasMore, olderError, messages.length, loading])

  // Keep the reader's place when an older page prepends above them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is the trigger — the effect only reads refs and the DOM
  useLayoutEffect(() => {
    const pending = prependScrollRef.current
    if (!pending) return
    prependScrollRef.current = null
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = pending.top + (el.scrollHeight - pending.height)
  }, [messages])

  useEffect(() => {
    if (!live) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refetch = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 300)
    }
    const unsubscribe = subscribe((event) => {
      const type = event.type ?? ""
      if (
        (type === "message.updated" || type === "message.part.updated") &&
        eventTouchesSession(event, sessionId)
      ) {
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
          setMessages(next)
        } else if (!next) {
          refetch()
        }
        return
      }
      if (
        (type === "message.removed" || type === "session.idle") &&
        eventTouchesSession(event, sessionId)
      ) {
        refetch()
      }
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [subscribe, live, sessionId, load])

  useEffect(() => {
    if (loading) return
    observerRef.current?.disconnect()
    observerRef.current = null
    const node = innerRef.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current
      if (!el || !stickRef.current) return
      el.scrollTop = el.scrollHeight
    })
    observer.observe(node)
    observerRef.current = observer
    return () => {
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [loading])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const rows = useMemo(
    () => councilTimelineRows(messages, pageMetaState.startUserCount, running),
    [messages, pageMetaState.startUserCount, running],
  )
  if (loading) {
    return (
      <Stack sx={{ flex: 1, minHeight: 120, p: 1 }}>
        <MessageSkeletons rows={4} label="Loading messages…" />
      </Stack>
    )
  }
  if (error) {
    return (
      <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
        {error}
      </Typography>
    )
  }
  return (
    <Box
      sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current
        if (!el) return
        const stick = nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)
        stickRef.current = stick
        setAtBottom(stick)
      }}
    >
      <Stack spacing={1} sx={{ p: 1 }} ref={innerRef}>
        {pageMetaState.hasMore ? (
          <div ref={topSentinelRef} className="ob-load-older">
            {olderLoading ? (
              <MessageSkeletons rows={3} label="Loading older messages…" />
            ) : olderError ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => void loadOlder()}
              >
                Could not load older messages. Retry
              </Button>
            ) : (
              <Button
                size="small"
                variant="text"
                onClick={() => void loadOlder()}
              >
                Load older messages
              </Button>
            )}
          </div>
        ) : null}
        {rows.length === 0 && !pageMetaState.hasMore ? (
          <Typography variant="body2" color="textSecondary">
            No messages yet.
          </Typography>
        ) : rows.length === 0 ? null : (
          <CouncilRows rows={rows} />
        )}
      </Stack>
      {!atBottom && rows.length > 0 ? (
        <div className="ob-jump-wrap">
          <button
            type="button"
            className="ob-jump-latest"
            onClick={() => {
              const el = scrollRef.current
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
  )
}

export function CouncilRail({
  data,
  selectedId,
  statusOf,
  onSelect,
}: {
  data: CouncilData
  selectedId: string
  statusOf: (sessionId: string) => { type?: string } | undefined
  onSelect: (sessionId: string) => void
}) {
  const subagents = data.subagents ?? []
  return (
    <Stack
      spacing={0.5}
      sx={{ flexShrink: 0, minWidth: 170, maxWidth: 220, overflowY: "auto" }}
    >
      {data.members.length === 0 ? (
        <Typography variant="body2" color="textSecondary" sx={{ p: 1 }}>
          No members in this council.
        </Typography>
      ) : (
        data.members.map((member) => {
          const selected = member.sessionId === selectedId
          return (
            <Button
              key={member.sessionId}
              size="small"
              variant={selected ? "contained" : "text"}
              onClick={() => onSelect(member.sessionId)}
              sx={{
                justifyContent: "flex-start",
                textTransform: "none",
                px: 1,
                minWidth: 0,
              }}
              startIcon={
                <CouncilDot live={councilRunning(statusOf(member.sessionId))} />
              }
            >
              <Box
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                }}
              >
                {memberLabel(member)}
                {memberMetaText(member) ? (
                  <Typography
                    variant="caption"
                    component="div"
                    color={selected ? undefined : "textSecondary"}
                    sx={{
                      opacity: 0.75,
                      textTransform: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {memberMetaText(member)}
                  </Typography>
                ) : null}
              </Box>
            </Button>
          )
        })
      )}
      {subagents.length > 0 ? (
        <>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ px: 1, pt: 0.5 }}
          >
            Subagents
          </Typography>
          {subagents.map((sub) => {
            const selected = sub.sessionId === selectedId
            return (
              <Button
                key={sub.sessionId}
                size="small"
                variant={selected ? "contained" : "text"}
                onClick={() => onSelect(sub.sessionId)}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  px: 1,
                  minWidth: 0,
                }}
                startIcon={
                  <CouncilDot live={councilRunning(statusOf(sub.sessionId))} />
                }
              >
                <Box
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  }}
                >
                  {subagentLabel(sub)}
                </Box>
              </Button>
            )
          })}
        </>
      ) : null}
    </Stack>
  )
}

// Mobile member picker: one horizontally scrollable chip row above the
// transcript — the desktop rail's 170px sidebar would leave a phone with
// almost no transcript width. Chips keep the live dot; subagents trail.
export function CouncilStrip({
  data,
  selectedId,
  statusOf,
  onSelect,
}: {
  data: CouncilData
  selectedId: string
  statusOf: (sessionId: string) => { type?: string } | undefined
  onSelect: (sessionId: string) => void
}) {
  const subagents = data.subagents ?? []
  if (data.members.length === 0 && subagents.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" sx={{ flexShrink: 0 }}>
        No members in this council.
      </Typography>
    )
  }
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      className="ob-council-strip"
      sx={{ flexShrink: 0, minWidth: 0 }}
    >
      {data.members.map((member) => (
        <ChipButton
          key={member.sessionId}
          label={memberLabel(member)}
          selected={member.sessionId === selectedId}
          live={councilRunning(statusOf(member.sessionId))}
          onClick={() => onSelect(member.sessionId)}
        />
      ))}
      {subagents.length > 0 ? (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ flexShrink: 0, px: 0.5 }}
        >
          Subagents
        </Typography>
      ) : null}
      {subagents.map((sub) => (
        <ChipButton
          key={sub.sessionId}
          label={subagentLabel(sub)}
          selected={sub.sessionId === selectedId}
          live={councilRunning(statusOf(sub.sessionId))}
          onClick={() => onSelect(sub.sessionId)}
        />
      ))}
    </Stack>
  )
}

function ChipButton({
  label,
  selected,
  live,
  onClick,
  pressed,
  title,
}: {
  label: string
  selected: boolean
  live: boolean
  onClick: () => void
  pressed?: boolean
  title?: string
}) {
  return (
    <Button
      size="small"
      variant={selected ? "contained" : "outlined"}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      sx={{
        flexShrink: 0,
        textTransform: "none",
        px: 1,
        minWidth: 0,
      }}
      startIcon={<CouncilDot live={live} />}
    >
      <Box
        sx={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 150,
        }}
      >
        {label}
      </Box>
    </Button>
  )
}

/**
 * URL patch for an in-viewer group switch. The workspace syncs the open
 * council from `?council=`, so the switch must write the new name there
 * (and drop the previous council's `?member=`) or the sync reverts it.
 */
export function councilSwitchPatch(
  name: string,
): Record<string, string | null> {
  return { [PARAM_COUNCIL]: name, [PARAM_MEMBER]: null }
}

// Council group switcher: one chip per council of the thread, rendered
// above the member group so switching teams never means closing the
// viewer and hunting for the floating Councils button. A thread with a
// single council has nothing to switch between — the row stays hidden.
export function CouncilGroupSwitcher({
  councils,
  selectedName,
  onSelect,
}: {
  councils: readonly CouncilGroupOption[]
  selectedName: string
  onSelect: (name: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Keep the open council's chip in view when the row overflows.
  useEffect(() => {
    if (!selectedName) return
    rootRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [selectedName])
  if (councils.length <= 1) return null
  const selected = selectedName.toLowerCase()
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      className="ob-council-strip ob-council-groups"
      sx={{ flexShrink: 0, minWidth: 0 }}
      ref={rootRef}
    >
      <Typography
        variant="caption"
        color="textSecondary"
        sx={{ flexShrink: 0, px: 0.5 }}
      >
        Councils
      </Typography>
      {councils.map((council) => {
        const open = council.name.toLowerCase() === selected
        return (
          <ChipButton
            key={council.name}
            label={
              council.members > 0
                ? `${council.name} · ${council.members}`
                : council.name
            }
            title={`${council.name} — ${council.members} member${council.members === 1 ? "" : "s"}${council.running > 0 ? `, ${council.running} working` : ""}`}
            selected={open}
            pressed={open}
            live={council.running > 0}
            onClick={() => onSelect(council.name)}
          />
        )
      })}
    </Stack>
  )
}

function councilBody(
  data: CouncilData,
  selectedId: string,
  statusOf: (sessionId: string) => { type?: string } | undefined,
  onSelect: (sessionId: string) => void,
  subscribe: (listener: (event: StreamEvent) => void) => () => void,
  live: boolean,
  mobile: boolean,
  // Council group switcher, shown over the member group when the thread
  // runs several councils (null when there is nothing to switch between).
  switcher: React.ReactNode = null,
) {
  const member =
    data.members.find((item) => item.sessionId === selectedId) ??
    (data.subagents ?? []).find((item) => item.sessionId === selectedId)
  const transcript = member ? (
    <MemberTranscript
      key={member.sessionId}
      sessionId={member.sessionId}
      subscribe={subscribe}
      live={live}
      running={councilRunning(statusOf(member.sessionId))}
    />
  ) : (
    <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
      Select a member to see what it is doing.
    </Typography>
  )
  if (mobile) {
    return (
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        {switcher}
        <CouncilStrip
          data={data}
          selectedId={selectedId}
          statusOf={statusOf}
          onSelect={onSelect}
        />
        {transcript}
      </Stack>
    )
  }
  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
      {switcher}
      <Stack
        direction="row"
        spacing={1}
        sx={{ flex: 1, minHeight: 0, alignItems: "stretch" }}
      >
        <CouncilRail
          data={data}
          selectedId={selectedId}
          statusOf={statusOf}
          onSelect={onSelect}
        />
        {transcript}
      </Stack>
    </Stack>
  )
}

export function CouncilPane({
  data,
  selectedId,
  statusOf,
  width,
  paneRef,
  onClose,
  onFullscreen,
  onDrag,
  onSelect,
  subscribe,
  live,
  mobile,
  councils,
  selectedCouncilName,
  onSelectCouncil,
  onStop,
}: {
  data: CouncilData
  selectedId: string
  statusOf: (sessionId: string) => { type?: string } | undefined
  width: number
  paneRef: React.Ref<HTMLDivElement>
  onClose: () => void
  onFullscreen: () => void
  onDrag: (event: React.PointerEvent<HTMLDivElement>) => void
  onSelect: (sessionId: string) => void
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  live: boolean
  mobile: boolean
  councils?: readonly CouncilGroupOption[]
  selectedCouncilName?: string
  onSelectCouncil?: (name: string) => void
  /** Aborts every running member/subagent turn (see CouncilStopButton). */
  onStop?: () => Promise<void>
}) {
  const runningCount = councilRunningIds(data, statusOf).length
  return (
    <>
      <div className="ob-preview-split" onPointerDown={onDrag} />
      <div ref={paneRef} className="ob-preview-pane" style={{ width }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          className="ob-preview-bar"
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Council {data.name}
            {runningCount > 0 ? ` — ${runningCount} working` : ""}
          </Typography>
          {onStop ? (
            <CouncilStopButton runningCount={runningCount} onStop={onStop} />
          ) : null}
          <Button size="small" variant="text" onClick={onFullscreen}>
            Full screen
          </Button>
          <Button size="small" variant="text" onClick={onClose}>
            Close
          </Button>
        </Stack>
        {councilBody(
          data,
          selectedId,
          statusOf,
          onSelect,
          subscribe,
          live,
          mobile,
          onSelectCouncil ? (
            <CouncilGroupSwitcher
              councils={councils ?? []}
              selectedName={selectedCouncilName ?? data.name}
              onSelect={onSelectCouncil}
            />
          ) : null,
        )}
      </div>
    </>
  )
}

export function CouncilOverlay({
  data,
  selectedId,
  statusOf,
  onClose,
  onSelect,
  subscribe,
  live,
  mobile,
  councils,
  selectedCouncilName,
  onSelectCouncil,
  onStop,
}: {
  data: CouncilData
  selectedId: string
  statusOf: (sessionId: string) => { type?: string } | undefined
  onClose: () => void
  onSelect: (sessionId: string) => void
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  live: boolean
  mobile: boolean
  councils?: readonly CouncilGroupOption[]
  selectedCouncilName?: string
  onSelectCouncil?: (name: string) => void
  /** Aborts every running member/subagent turn (see CouncilStopButton). */
  onStop?: () => Promise<void>
}) {
  const runningCount = councilRunningIds(data, statusOf).length
  return (
    <div className="ob-preview-overlay">
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
          Council {data.name}
          {runningCount > 0 ? ` — ${runningCount} working` : ""}
        </Typography>
        {onStop ? (
          <CouncilStopButton runningCount={runningCount} onStop={onStop} />
        ) : null}
        <Button size="small" variant="contained" onClick={onClose}>
          Close
        </Button>
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {councilBody(
          data,
          selectedId,
          statusOf,
          onSelect,
          subscribe,
          live,
          mobile,
          onSelectCouncil ? (
            <CouncilGroupSwitcher
              councils={councils ?? []}
              selectedName={selectedCouncilName ?? data.name}
              onSelect={onSelectCouncil}
            />
          ) : null,
        )}
      </Box>
    </div>
  )
}

export { clampPreviewWidth as clampCouncilWidth }
