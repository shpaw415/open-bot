import { trimDashboardEvent } from "./messages-trim"

export type EventsSocketData = { kind: "events"; userId: string }

export type HubSocket = { send(data: string): unknown }

export type HubEvent = { type: string; properties?: unknown }

export type Upstream = { base: string; auth: string }

const FORWARDED = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.idle",
  "session.status",
  "session.error",
  "message.updated",
  "message.removed",
  "message.part.updated",
  "file.edited",
  "file.watcher.updated",
])

const PING_MS = 30_000
const RETRY_MAX_MS = 15_000
// Background pumps (no dashboard attached) poll slowly — they only need to
// notice a started desktop within a minute and feed event observers.
const BACKGROUND_POLL_MS = 60_000

export function forwardable(type: unknown): boolean {
  return typeof type === "string" && FORWARDED.has(type)
}

/** Split an SSE byte stream into forwarded JSON events carried in `data:` lines. */
export function createSseParser(onEvent: (event: HubEvent) => void) {
  let buffer = ""
  const handle = (raw: string) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) =>
        line.startsWith("data: ") ? line.slice(6) : line.slice(5),
      )
      .join("\n")
    if (!data) return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    const event = parsed as HubEvent
    if (forwardable(event.type)) onEvent(event)
  }
  return {
    push(chunk: string) {
      buffer += chunk
      for (;;) {
        const crlf = buffer.indexOf("\r\n\r\n")
        const lf = buffer.indexOf("\n\n")
        if (crlf === -1 && lf === -1) return
        const useCrlf = crlf !== -1 && (lf === -1 || crlf < lf)
        const raw = useCrlf ? buffer.slice(0, crlf) : buffer.slice(0, lf)
        buffer = useCrlf ? buffer.slice(crlf + 4) : buffer.slice(lf + 2)
        handle(raw)
      }
    },
  }
}

type Pump = {
  sockets: Set<HubSocket>
  abort: AbortController
  attempts: number
  up: boolean
  started: boolean
  /** True once every dashboard socket left: the pump keeps running so
   * observers (plugin hooks, media capture) still see desktop events. */
  background: boolean
  retry: ReturnType<typeof setTimeout> | null
  ping: ReturnType<typeof setInterval>
}

/**
 * Fans a single upstream opencode `/event` SSE stream per user out to every
 * connected dashboard socket, and delivers in-process events (cron, notices).
 */
export class EventHub {
  private users = new Map<string, Pump>()

  constructor(
    private readonly resolve: (userId: string) => Promise<Upstream | null>,
    private readonly observe?: (userId: string, event: HubEvent) => void,
  ) {}

  attach(ws: HubSocket, userId: string) {
    let pump = this.users.get(userId)
    if (!pump) {
      const created: Pump = {
        sockets: new Set(),
        abort: new AbortController(),
        attempts: 0,
        up: false,
        started: false,
        background: false,
        retry: null,
        ping: setInterval(() => {
          if (created.sockets.size > 0) this.deliver(userId, { type: "ping" })
        }, PING_MS),
      }
      pump = created
      this.users.set(userId, pump)
    }
    pump.sockets.add(ws)
    try {
      ws.send(
        JSON.stringify({ type: pump.up ? "opencode.up" : "opencode.down" }),
      )
    } catch {
      // socket already closed; its close handler detaches it
    }
    if (!pump.started) {
      pump.started = true
      void this.stream(userId, pump)
    }
  }

  detach(ws: HubSocket) {
    for (const [, pump] of this.users) {
      if (!pump.sockets.delete(ws)) continue
      if (pump.sockets.size === 0) {
        // Last dashboard socket left: keep the upstream pump alive in the
        // background so observers (plugin hooks, media capture) still see
        // desktop events while the desktop runs.
        pump.background = true
        pump.attempts = 0
      }
      return
    }
  }

  emit(userId: string, event: HubEvent) {
    this.deliver(userId, event)
  }

  private deliver(userId: string, event: HubEvent) {
    const pump = this.users.get(userId)
    if (!pump) return
    // Socket payloads only — observers (plugin hooks, media capture) already
    // saw the raw event above and keep full content.
    this.broadcast(pump, trimDashboardEvent(event))
  }

  private broadcast(pump: Pump, event: HubEvent) {
    const frame = JSON.stringify(event)
    for (const ws of [...pump.sockets]) {
      try {
        ws.send(frame)
      } catch {
        // socket already closed; its close handler detaches it
      }
    }
  }

  /** Start (or keep) the upstream pump without a dashboard socket, so event
   * observers (plugin hooks, media capture) work even when nobody is
   * watching the dashboard. */
  ensurePump(userId: string) {
    if (this.users.has(userId)) return
    const created: Pump = {
      sockets: new Set(),
      abort: new AbortController(),
      attempts: 0,
      up: false,
      started: false,
      background: true,
      retry: null,
      ping: setInterval(() => {
        if (created.sockets.size > 0) this.deliver(userId, { type: "ping" })
      }, PING_MS),
    }
    this.users.set(userId, created)
    created.started = true
    void this.stream(userId, created)
  }

  /** Full teardown (user deleted / desktop removed): stops the pump. */
  forget(userId: string) {
    const pump = this.users.get(userId)
    if (!pump) return
    clearInterval(pump.ping)
    if (pump.retry) clearTimeout(pump.retry)
    pump.abort.abort()
    this.users.delete(userId)
  }

  private async stream(userId: string, pump: Pump) {
    const decoder = new TextDecoder()
    while (!pump.abort.signal.aborted) {
      let upstream: Upstream | null = null
      try {
        upstream = await this.resolve(userId)
      } catch {
        upstream = null
      }
      if (pump.abort.signal.aborted) return
      if (!upstream) {
        this.markDown(pump)
        await this.wait(pump)
        continue
      }
      let connected = false
      try {
        const response = await fetch(`${upstream.base}/event`, {
          headers: { authorization: upstream.auth },
          signal: pump.abort.signal,
        })
        if (response.ok && response.body) {
          connected = true
          pump.attempts = 0
          this.markUp(pump)
          const parser = createSseParser((event) => {
            try {
              this.observe?.(userId, event)
            } catch {
              // observers are best-effort; forwarding never depends on them
            }
            this.deliver(userId, event)
          })
          for await (const chunk of response.body) {
            parser.push(decoder.decode(chunk, { stream: true }))
          }
        }
      } catch {
        if (pump.abort.signal.aborted) return
      }
      if (connected) pump.attempts = 0
      this.markDown(pump)
      await this.wait(pump)
    }
  }

  private markUp(pump: Pump) {
    if (pump.up) return
    pump.up = true
    this.broadcast(pump, { type: "opencode.up" })
  }

  private markDown(pump: Pump) {
    if (!pump.up) return
    pump.up = false
    this.broadcast(pump, { type: "opencode.down" })
  }

  private async wait(pump: Pump) {
    const delay =
      pump.background && pump.sockets.size === 0
        ? BACKGROUND_POLL_MS
        : Math.min(1000 * 2 ** pump.attempts, RETRY_MAX_MS)
    pump.attempts += 1
    await new Promise<void>((resolve) => {
      pump.retry = setTimeout(() => {
        pump.retry = null
        resolve()
      }, delay)
    })
  }
}
