import { useCallback, useEffect, useRef, useState } from "react"
import type { StreamEvent } from "./chat-view"

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

export function useEventStream(enabled: boolean): EventStream {
  const [live, setLive] = useState(false)
  const listeners = useRef(new Set<(event: StreamEvent) => void>())
  const connected = useRef(false)
  const upstream = useRef(false)

  const update = useCallback(() => {
    setLive(connected.current && upstream.current)
  }, [])

  const subscribe = useCallback((listener: (event: StreamEvent) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      connected.current = false
      upstream.current = false
      update()
      return
    }
    let closed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    const dispatch = (raw: string) => {
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
      if (type === "opencode.up" && !upstream.current) {
        upstream.current = true
        update()
      }
      if (type === "opencode.down" && upstream.current) {
        upstream.current = false
        update()
      }
      if (
        upstream.current === false &&
        (type.startsWith("message.") || type.startsWith("session."))
      ) {
        upstream.current = true
        update()
      }
      for (const listener of [...listeners.current]) {
        try {
          listener({ type, properties: event.properties })
        } catch {
          // a broken listener must not break the stream
        }
      }
    }
    const connect = () => {
      if (closed) return
      const protocol = location.protocol === "https:" ? "wss" : "ws"
      socket = new WebSocket(`${protocol}://${location.host}/api/events`)
      socket.onopen = () => {
        attempt = 0
        connected.current = true
        update()
      }
      socket.onmessage = (message) => {
        if (typeof message.data === "string") dispatch(message.data)
      }
      socket.onclose = () => {
        connected.current = false
        upstream.current = false
        update()
        if (closed) return
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 30_000))
        attempt += 1
      }
    }
    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      socket?.close()
      connected.current = false
      upstream.current = false
      update()
    }
  }, [enabled, update])

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
