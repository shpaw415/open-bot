import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Snackbar from "@shpaw415/mui-lite/Snackbar"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import type { ChatMessage } from "./chat-view"
import { useEventStream, useMobile } from "./hooks"
import {
  NotificationsIcon,
  NotificationsNoneIcon,
  NotificationsOffIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "./icons"
import {
  armsSession,
  claimNotice,
  freshReply,
  getNoticeFocus,
  idleSessionId,
  type NativePermission,
  noteThreadUnread,
  readNativePermission,
  shouldNotify,
} from "./notify"
import {
  playNotifySound,
  readNotifySound,
  writeNotifySound,
} from "./notify-sound"
import { Tip } from "./Tip"

type Toast = {
  id: string
  title: string
  body: string
  sessionId: string
}

function sessionTitle(body: unknown): string {
  if (!body || typeof body !== "object") return "open-bot"
  const title = (body as { title?: unknown }).title
  return typeof title === "string" && title.trim() ? title.trim() : "open-bot"
}

function watching(sessionId: string): boolean {
  const focus = getNoticeFocus()
  return !shouldNotify({
    hidden: document.hidden,
    path: focus.path,
    tab: focus.tab,
    viewingSessionId: focus.sessionId,
    replySessionId: sessionId,
  })
}

function showNative(
  title: string,
  body: string,
  sessionId: string,
  onOpen: (sessionId: string) => void,
) {
  if (readNativePermission() !== "granted") return
  try {
    const note = new Notification(title, { body, tag: `ob-${sessionId}` })
    note.onclick = () => {
      window.focus()
      onOpen(sessionId)
      note.close()
    }
  } catch {}
}

async function deliverReply(
  sessionId: string,
  armedAt: number,
  onOpen: (sessionId: string) => void,
  push: (toast: Toast) => void,
) {
  if (watching(sessionId)) return
  const [messageBody, sessionBody] = await Promise.all([
    api<unknown>(`/api/opencode/session/${sessionId}/message`).catch(
      () => null,
    ),
    api<unknown>(`/api/opencode/session/${sessionId}`).catch(() => null),
  ])
  if (!Array.isArray(messageBody)) return
  const reply = freshReply(messageBody as ChatMessage[], armedAt)
  if (!reply || watching(sessionId)) return
  noteThreadUnread(sessionId)
  if (!claimNotice(localStorage, reply.id)) return
  playNotifySound()
  const title = sessionTitle(sessionBody)
  push({ id: reply.id, title, body: reply.text, sessionId })
  showNative(title, reply.text, sessionId, onOpen)
}

export function AgentNotices({
  onOpen,
}: {
  onOpen: (sessionId: string) => void
}) {
  const { subscribe } = useEventStream(true)
  const armed = useRef(new Map<string, number>())
  const onOpenRef = useRef(onOpen)
  const [toast, setToast] = useState<Toast | null>(null)
  const mobile = useMobile()
  const closeToast = useCallback(() => setToast(null), [])
  onOpenRef.current = onOpen

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "security.notice") {
        const props = event.properties as
          | {
              findingId?: unknown
              severity?: unknown
              title?: unknown
              sessionId?: unknown
              action?: unknown
            }
          | undefined
        const severity =
          typeof props?.severity === "string" ? props.severity : "finding"
        const title =
          typeof props?.title === "string" && props.title.trim()
            ? props.title.trim().slice(0, 160)
            : "suspicious activity detected"
        const stopped = props?.action === "stopped"
        const heading = `Watchdog (${severity})${stopped ? " — turn stopped" : ""}`
        const id = `security-notice-${String(props?.findingId ?? "x")}-${Date.now()}`
        setToast({ id, title: heading, body: title, sessionId: "" })
        playNotifySound()
        showNative(heading, title, "watchdog", () => {})
        return
      }
      if (event.type === "plugin.notice") {
        const props = event.properties as
          | {
              pluginId?: unknown
              name?: unknown
              title?: unknown
              body?: unknown
            }
          | undefined
        const name =
          typeof props?.name === "string" && props.name.trim()
            ? props.name.trim()
            : typeof props?.pluginId === "string"
              ? props.pluginId
              : "plugin"
        const heading =
          typeof props?.title === "string" && props.title.trim()
            ? props.title.trim().slice(0, 120)
            : "notification"
        const detail =
          typeof props?.body === "string" && props.body.trim()
            ? props.body.trim().slice(0, 500)
            : ""
        const id = `plugin-notice-${props?.pluginId ?? "x"}-${Date.now()}`
        const toast: Toast = {
          id,
          title: `${name}: ${heading}`,
          body: detail,
          sessionId: "",
        }
        setToast(toast)
        playNotifySound()
        showNative(
          `${name}: ${heading}`,
          detail,
          `plugin-${props?.pluginId ?? "x"}`,
          () => {},
        )
        return
      }
      const armId = armsSession(event)
      if (armId && !armed.current.has(armId)) {
        armed.current.set(armId, Date.now())
      }
      const idleId = idleSessionId(event)
      if (!idleId) return
      const armedAt = armed.current.get(idleId)
      if (armedAt == null) return
      armed.current.delete(idleId)
      void deliverReply(
        idleId,
        armedAt,
        (id) => onOpenRef.current(id),
        setToast,
      ).catch(() => {})
    })
  }, [subscribe])

  return (
    <Snackbar
      key={toast?.id ?? "closed"}
      className="ob-reply-snack"
      open={toast != null}
      position={mobile ? "bottom-center" : "bottom-right"}
      autoHideDuration={6000}
      onClose={closeToast}
      message={
        toast ? (
          <span>
            <strong>{toast.title}</strong>
            <br />
            {toast.body}
          </span>
        ) : (
          ""
        )
      }
      action={
        toast?.sessionId ? (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              onOpen(toast.sessionId)
              setToast(null)
            }}
          >
            Open
          </Button>
        ) : undefined
      }
    />
  )
}

export function SoundBell() {
  const [on, setOn] = useState(() => readNotifySound())
  const label = on ? "Reply sound on" : "Reply sound off"
  return (
    <Tip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => {
          const next = !on
          writeNotifySound(next)
          setOn(next)
          if (next) playNotifySound()
        }}
      >
        {on ? <VolumeUpIcon /> : <VolumeOffIcon />}
      </IconButton>
    </Tip>
  )
}

function bellCopy(permission: NativePermission): string {
  if (permission === "unsupported") return "Notifications need HTTPS"
  if (permission === "denied") return "Notifications blocked in the browser"
  if (permission === "granted") return "Notifications on"
  return "Turn on notifications"
}

export function NoticeBell() {
  const [permission, setPermission] = useState<NativePermission>(() =>
    readNativePermission(),
  )
  const label = bellCopy(permission)
  const blocked = permission === "unsupported" || permission === "denied"
  return (
    <Tip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          disabled={blocked}
          onClick={() => {
            if (permission !== "default" || typeof Notification === "undefined")
              return
            void Notification.requestPermission().then((next) => {
              setPermission(
                next === "granted" || next === "denied" ? next : "default",
              )
            })
          }}
        >
          {permission === "granted" ? (
            <NotificationsIcon />
          ) : permission === "default" ? (
            <NotificationsNoneIcon />
          ) : (
            <NotificationsOffIcon />
          )}
        </IconButton>
      </span>
    </Tip>
  )
}
