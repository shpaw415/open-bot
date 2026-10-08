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
  ) {}

  attach(ws: HubSocket, userId: string) {
    let pump = this.users.get(userId)
    if (!pump) {
      pump = {
        sockets: new Set(),
        abort: new AbortController(),
        attempts: 0,
        up: false,
        started: false,
        retry: null,
        ping: setInterval(
          () => this.deliver(userId, { type: "ping" }),
          PING_MS,
        ),
      }
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
    for (const [userId, pump] of this.users) {
      if (!pump.sockets.delete(ws)) continue
      if (pump.sockets.size === 0) this.destroy(userId, pump)
      return
    }
  }

  emit(userId: string, event: HubEvent) {
    this.deliver(userId, event)
  }

  private deliver(userId: string, event: HubEvent) {
    const pump = this.users.get(userId)
    if (!pump) return
    this.broadcast(pump, event)
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

  private destroy(userId: string, pump: Pump) {
    clearInterval(pump.ping)
    if (pump.retry) clearTimeout(pump.retry)
    pump.abort.abort()
    this.users.delete(userId)
  }

  private async stream(userId: string, pump: Pump) {
    const decoder = new TextDecoder()
    while (pump.sockets.size > 0) {
      let upstream: Upstream | null = null
      try {
        upstream = await this.resolve(userId)
      } catch {
        upstream = null
      }
      if (pump.sockets.size === 0) return
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
          const parser = createSseParser((event) => this.deliver(userId, event))
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
    const delay = Math.min(1000 * 2 ** pump.attempts, RETRY_MAX_MS)
    pump.attempts += 1
    await new Promise<void>((resolve) => {
      pump.retry = setTimeout(() => {
        pump.retry = null
        resolve()
      }, delay)
    })
  }
}
