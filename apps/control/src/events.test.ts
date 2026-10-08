import { describe, expect, test } from "bun:test"
import type { HubEvent, HubSocket } from "./events"
import { createSseParser, EventHub, forwardable } from "./events"

function captureSocket(): { socket: HubSocket; frames: string[] } {
  const frames: string[] = []
  return {
    socket: {
      send(data: string) {
        frames.push(data)
      },
    },
    frames,
  }
}

function parsed(frames: string[]): { type: string; properties?: unknown }[] {
  return frames.map((frame) => JSON.parse(frame))
}

describe("sse parser", () => {
  test("parses multiple frames in one chunk", () => {
    const out: HubEvent[] = []
    const parser = createSseParser((event) => out.push(event))
    parser.push(
      'data: {"type":"session.idle","properties":{"sessionID":"s1"}}\n\ndata: {"type":"message.updated"}\n\n',
    )
    expect(out.map((event) => event.type)).toEqual([
      "session.idle",
      "message.updated",
    ])
  })

  test("reassembles frames split across chunks", () => {
    const out: HubEvent[] = []
    const parser = createSseParser((event) => out.push(event))
    parser.push('data: {"type":"session.st')
    parser.push(
      'atus","properties":{"sessionID":"s2","status":{"type":"busy"}}',
    )
    parser.push("}\n\n")
    expect(out).toEqual([
      {
        type: "session.status",
        properties: { sessionID: "s2", status: { type: "busy" } },
      },
    ])
  })

  test("supports crlf separators and multi-line data", () => {
    const out: HubEvent[] = []
    const parser = createSseParser((event) => out.push(event))
    parser.push('data: {"type":"message.updated",\r\ndata: "x":1}\r\n\r\n')
    // SSE joins data lines with \n, which stays valid JSON whitespace
    expect(out).toEqual([{ type: "message.updated", x: 1 } as HubEvent])
  })

  test("drops non-forwarded and malformed events", () => {
    const out: HubEvent[] = []
    const parser = createSseParser((event) => out.push(event))
    parser.push(
      [
        'data: {"type":"server.connected","properties":{}}',
        "",
        'data: {"type":"file.changed","properties":{}}',
        "",
        "data: not-json",
        "",
        'data: {"type":"message.part.updated","properties":{}}',
        "",
        "",
      ].join("\n"),
    )
    expect(out.map((event) => event.type)).toEqual(["message.part.updated"])
  })

  test("forwardable whitelist", () => {
    expect(forwardable("message.updated")).toBe(true)
    expect(forwardable("server.connected")).toBe(false)
    expect(forwardable(undefined)).toBe(false)
    expect(forwardable("file.watcher.updated")).toBe(true)
    expect(forwardable("file.edited")).toBe(true)
  })
})

describe("event hub", () => {
  test("streams forwarded events and lifecycle frames to attached sockets", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"server.connected","properties":{}}\n\n',
                ),
              )
              setTimeout(() => {
                try {
                  controller.enqueue(
                    encoder.encode(
                      'data: {"type":"message.updated","properties":{"sessionID":"s1"}}\n\n',
                    ),
                  )
                } catch {
                  // hub already detached and cancelled the stream
                }
              }, 20)
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
          },
        ),
    })
    try {
      const hub = new EventHub(async () => ({
        base: upstream.url.origin,
        auth: "Basic dGVzdDp0ZXN0",
      }))
      const first = captureSocket()
      hub.attach(first.socket, "user-1")
      const second = captureSocket()
      hub.attach(second.socket, "user-1")
      await Bun.sleep(120)
      const types = parsed(second.frames).map((event) => event.type)
      expect(types).toContain("message.updated")
      expect(types).not.toContain("server.connected")
      // second attach sees current state; first saw the transition to up
      expect(types).toContain("opencode.up")
      expect(parsed(first.frames).map((event) => event.type)).toContain(
        "opencode.up",
      )
      // per-user isolation
      const other = captureSocket()
      hub.attach(other.socket, "user-2")
      hub.emit("user-2", { type: "cron.changed" })
      await Bun.sleep(20)
      expect(parsed(other.frames)).toContainEqual({ type: "cron.changed" })
      expect(
        parsed(second.frames).some(
          (event) => (event as { type: string }).type === "cron.changed",
        ),
      ).toBe(false)
      hub.detach(first.socket)
      hub.detach(second.socket)
      hub.detach(other.socket)
    } finally {
      upstream.stop(true)
    }
  })

  test("reports down when the desktop is not running", async () => {
    const hub = new EventHub(async () => null)
    const client = captureSocket()
    hub.attach(client.socket, "user-1")
    await Bun.sleep(10)
    expect(parsed(client.frames)).toContainEqual({ type: "opencode.down" })
    hub.detach(client.socket)
  })
})
