import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import {
  applyMessageDelta,
  chatImageUrl,
  eventTouchesSession,
  type StreamEvent,
  visibleMessages,
} from "./chat-view"
import { MarkdownCodeBlock } from "./code-copy"
import { createLatestGuard } from "./latest-guard"
import { clampPreviewWidth } from "./PreviewView"
import Stack from "./stack"

export type CouncilMemberInfo = {
  sessionId: string
  role: string
  title: string
  createdAt: number
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

export function councilRunning(status: { type?: string } | undefined): boolean {
  return Boolean(status && status.type !== "idle")
}

function memberLabel(member: CouncilMemberInfo): string {
  const title = member.title.replace(/^worker:/, "").trim()
  const role = member.role.trim()
  return title || role || member.sessionId.slice(0, 12)
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

const councilMarkdownComponents = {
  pre: MarkdownCodeBlock,
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    const resolved = typeof src === "string" ? chatImageUrl(src) : ""
    if (!resolved) return null
    return (
      <div className="ob-media-wrap">
        <img src={resolved} alt={alt ?? ""} />
      </div>
    )
  },
}

function CouncilMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      urlTransform={(url) => (chatImageUrl(url) ? url : "")}
      components={councilMarkdownComponents}
    >
      {text}
    </Markdown>
  )
}

// Read-only transcript of one council member: same markdown surface as the
// main chat (minus plugin cards), fed by the same message route the dashboard
// polls, live-updated from the shared event stream.
function MemberTranscript({
  sessionId,
  subscribe,
  live,
}: {
  sessionId: string
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  live: boolean
}) {
  const [messages, setMessages] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const messagesRef = useRef<unknown[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
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
        `/api/opencode/session/${encodeURIComponent(id)}/message`,
      )
      const body = await res.json()
      if (!isCurrent()) return
      const next = Array.isArray(body) ? body : []
      messagesRef.current = next
      setMessages(next)
      setError("")
    } catch {
      if (!isCurrent()) return
      setError("could not load this member's thread")
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    messagesRef.current = []
    setMessages([])
    setLoading(true)
    setError("")
    void load()
  }, [load])

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
        const next = applyMessageDelta(
          messagesRef.current as never,
          event as never,
        )
        if (next && next !== messagesRef.current) {
          messagesRef.current = next as unknown[]
          setMessages(next as unknown[])
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the transcript changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const bubbles = visibleMessages(messages as never)
  if (loading) {
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{ flex: 1, minHeight: 120 }}
      >
        <CircularProgress size={1.2} />
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
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }} ref={scrollRef}>
      <Stack spacing={1} sx={{ p: 1 }}>
        {bubbles.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No messages yet.
          </Typography>
        ) : (
          bubbles.map((entry, index) => {
            const mine = entry.info?.role === "user"
            return (
              <Box
                key={entry.info?.id ?? index}
                className={`ob-bubble ${mine ? "ob-bubble-user" : "ob-bubble-assistant"}`}
                sx={{
                  bgcolor: mine ? "primary.main" : undefined,
                  color: mine ? "primary.contrastText" : "text.primary",
                  border: mine ? "none" : "1px solid",
                  borderColor: mine ? undefined : "divider",
                }}
              >
                <div className="ob-md">
                  {entry.text.trim() ? (
                    <CouncilMarkdown text={entry.text} />
                  ) : null}
                </div>
              </Box>
            )
          })
        )}
      </Stack>
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
                {member.role.trim() && member.title.trim() ? (
                  <Typography
                    variant="caption"
                    component="div"
                    color={selected ? undefined : "textSecondary"}
                    sx={{ opacity: 0.75, textTransform: "none" }}
                  >
                    {member.role}
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
}: {
  label: string
  selected: boolean
  live: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="small"
      variant={selected ? "contained" : "outlined"}
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

function councilBody(
  data: CouncilData,
  selectedId: string,
  statusOf: (sessionId: string) => { type?: string } | undefined,
  onSelect: (sessionId: string) => void,
  subscribe: (listener: (event: StreamEvent) => void) => () => void,
  live: boolean,
  mobile: boolean,
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
    />
  ) : (
    <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
      Select a member to see what it is doing.
    </Typography>
  )
  if (mobile) {
    return (
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
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
}) {
  const subagents = data.subagents ?? []
  const runningCount = [...data.members, ...subagents].filter((member) =>
    councilRunning(statusOf(member.sessionId)),
  ).length
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
}: {
  data: CouncilData
  selectedId: string
  statusOf: (sessionId: string) => { type?: string } | undefined
  onClose: () => void
  onSelect: (sessionId: string) => void
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  live: boolean
  mobile: boolean
}) {
  return (
    <div className="ob-preview-overlay">
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
          Council {data.name}
        </Typography>
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
        )}
      </Box>
    </div>
  )
}

export { clampPreviewWidth as clampCouncilWidth }
