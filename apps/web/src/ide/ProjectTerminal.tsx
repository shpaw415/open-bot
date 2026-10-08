import { useEffect, useRef } from "react"
import { monoFont, vscode } from "./theme"
import type { ProjectInfo } from "./types"

/**
 * One xterm session backed by a PTY in the desktop container, opened in the
 * project directory (/api/projects/<id>/terminal).
 */
export function ProjectTerminal({ project }: { project: ProjectInfo }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let term: import("@xterm/xterm").Terminal | null = null
    let fit: { fit: () => void } | null = null
    let ws: WebSocket | null = null
    let disposed = false

    const fitHost = () => {
      try {
        fit?.fit()
      } catch {
        // host not laid out yet
      }
    }
    const observer = new ResizeObserver(() => fitHost())
    observer.observe(host)

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      if (disposed) return
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: monoFont,
        scrollback: 4000,
        theme: {
          background: vscode.editorBg,
          foreground: vscode.editorFg,
          cursor: "#aeafad",
          selectionBackground: "#264f78",
          black: "#000000",
          red: "#cd3131",
          green: "#0dbc79",
          yellow: "#e5e510",
          blue: "#2472c8",
          magenta: "#bc3fbc",
          cyan: "#11a8cd",
          white: "#e5e5e5",
          brightBlack: "#666666",
          brightBlue: "#3b8eea",
          brightGreen: "#23d18b",
          brightCyan: "#29b8db",
        },
      })
      const addon = new FitAddon()
      fit = addon
      term.loadAddon(addon)
      term.open(host)
      fitHost()
      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(new TextEncoder().encode(data))
      })
      term.onResize(({ cols, rows }) => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ op: "resize", cols, rows }))
      })

      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(
        `${proto}//${location.host}/api/projects/${project.id}/terminal?cols=${term.cols || 80}&rows=${term.rows || 24}`,
      )
      ws.binaryType = "arraybuffer"
      ws.onopen = () => {
        fitHost()
        term?.focus()
      }
      ws.onmessage = (event) => {
        if (!term) return
        if (typeof event.data === "string") {
          try {
            const body = JSON.parse(event.data) as {
              op?: string
              code?: number | null
              note?: string
            }
            if (body.op === "exit") {
              if (body.note) term.write(`\r\n${body.note}\r\n`)
              term.write("\r\nshell exited\r\n")
            }
          } catch {
            // ignore malformed control frames
          }
          return
        }
        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new Uint8Array(0)
        if (bytes.length > 0) term.write(bytes)
      }
      ws.onerror = () => {
        term?.write("\r\nterminal connection failed\r\n")
      }
      ws.onclose = () => {
        if (!disposed) term?.write("\r\nconnection closed\r\n")
      }
      requestAnimationFrame(() => fitHost())
    })()

    return () => {
      disposed = true
      observer.disconnect()
      ws?.close()
      term?.dispose()
    }
  }, [project.id])

  return (
    <div
      ref={hostRef}
      style={{
        flex: 1,
        minHeight: 0,
        padding: "4px 8px 8px 8px",
        backgroundColor: vscode.editorBg,
      }}
    />
  )
}
