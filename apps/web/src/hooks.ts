import { useCallback, useEffect, useRef, useState } from "react"
import type { StreamEvent } from "./chat-view"
import { readUnread, subscribeUnread } from "./notify"

export function useMobile(breakpoint = 899): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint,
  )
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [breakpoint])
  return mobile
}

export function useUnreadThreads(): ReadonlySet<string> {
  const [ids, setIds] = useState(
    () =>
      new Set(
        typeof localStorage === "undefined" ? [] : readUnread(localStorage),
      ),
  )
  useEffect(() => {
    const sync = () => setIds(new Set(readUnread(localStorage)))
    sync()
    return subscribeUnread(sync)
  }, [])
  return ids
}

export function usePath(path: string, setPath: (next: string) => void) {
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [setPath])
  void path
}

export type EventStream = {
  /** True only while the socket is open and the desktop's event stream is up. */
  live: boolean
  subscribe: (listener: (event: StreamEvent) => void) => () => void
}

type StreamListener = (event: StreamEvent) => void

type StreamInstance = {
  listeners: Set<StreamListener>
  notify: (live: boolean) => void
}

// One shared /api/events socket per tab, refcounted across consumers
// (Workspace while running, AgentNotices always) instead of one socket each.
const streamInstances = new Set<StreamInstance>()
const stream = {
  consumers: 0,
  socket: null as WebSocket | null,
  timer: null as ReturnType<typeof setTimeout> | null,
  attempt: 0,
  connected: false,
  upstream: false,
  live: false,
}

function streamSetLive(live: boolean) {
  if (stream.live === live) return
  stream.live = live
  for (const instance of streamInstances) {
    instance.notify(live)
  }
}

function streamDispatch(raw: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
  const event = parsed as { type?: unknown; properties?: unknown }
  if (typeof event.type !== "string") return
  const type = event.type
  if (type === "ping") return
  if (type === "opencode.up" && !stream.upstream) {
    stream.upstream = true
    streamSetLive(stream.connected && stream.upstream)
  }
  if (type === "opencode.down" && stream.upstream) {
    stream.upstream = false
    streamSetLive(stream.connected && stream.upstream)
  }
  if (
    stream.upstream === false &&
    (type.startsWith("message.") || type.startsWith("session."))
  ) {
    stream.upstream = true
    streamSetLive(stream.connected && stream.upstream)
  }
  for (const instance of streamInstances) {
    for (const listener of [...instance.listeners]) {
      try {
        listener({ type, properties: event.properties })
      } catch {
        // a broken listener must not break the stream
      }
    }
  }
}

function streamConnect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws"
  const socket = new WebSocket(`${protocol}://${location.host}/api/events`)
  stream.socket = socket
  socket.onopen = () => {
    if (stream.socket !== socket) return
    stream.attempt = 0
    stream.connected = true
    streamSetLive(stream.connected && stream.upstream)
  }
  socket.onmessage = (message) => {
    if (typeof message.data === "string") streamDispatch(message.data)
  }
  socket.onclose = () => {
    if (stream.socket !== socket) return
    stream.socket = null
    stream.connected = false
    stream.upstream = false
    streamSetLive(false)
    if (stream.consumers === 0) return
    stream.timer = setTimeout(
      streamConnect,
      Math.min(1000 * 2 ** stream.attempt, 30_000),
    )
    stream.attempt += 1
  }
}

function streamAttach() {
  stream.consumers += 1
  if (stream.consumers > 1) return
  stream.attempt = 0
  streamConnect()
}

function streamDetach() {
  stream.consumers -= 1
  if (stream.consumers > 0) return
  if (stream.timer) clearTimeout(stream.timer)
  stream.timer = null
  const socket = stream.socket
  stream.socket = null
  stream.connected = false
  stream.upstream = false
  streamSetLive(false)
  socket?.close()
}

export function useEventStream(enabled: boolean): EventStream {
  const [live, setLive] = useState(false)
  const listeners = useRef(new Set<StreamListener>())
  const instance = useRef<StreamInstance | null>(null)
  instance.current ??= {
    listeners: listeners.current,
    notify: (value) => setLive(value),
  }
  const self = instance.current

  useEffect(() => {
    if (!enabled) {
      self.notify(false)
      return
    }
    streamInstances.add(self)
    streamAttach()
    self.notify(stream.live)
    return () => {
      streamInstances.delete(self)
      streamDetach()
    }
  }, [enabled, self])

  const subscribe = useCallback((listener: StreamListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  return { live, subscribe }
}

/** Collapse bursts of stream events into a single trailing callback. */
export function useDebounced<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const latest = useRef(callback)
  latest.current = callback
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        latest.current(...args)
      }, delay)
    },
    [delay],
  )
}
