import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@shpaw415/mui-lite/List"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import type { Terminal } from "@xterm/xterm"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, waitForDesktop } from "./api"
import { useMobile } from "./hooks"
import { CheckCircleIcon, LoginIcon, LogoutIcon, RefreshIcon } from "./icons"
import "@xterm/xterm/css/xterm.css"

type AuthMethod = { type?: string; label?: string }
type ProviderAuth = Record<string, AuthMethod[]>

function LoginTerminal({
  loginId,
  onExit,
}: {
  loginId: string
  onExit: (code: number | null) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let term: Terminal | null = null
    let fit: { fit: () => void } | null = null
    let ws: WebSocket | null = null
    let disposed = false
    let sawExit = false
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
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: {
          background: "#111111",
          foreground: "#e6e6e6",
          cursor: "#e6e6e6",
        },
        scrollback: 1000,
      })
      const addon = new FitAddon()
      fit = addon
      term.loadAddon(addon)
      term.open(host)
      fitHost()
      const cols = term.cols || 80
      const rows = term.rows || 24
      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(
        `${proto}//${location.host}/api/providers/login/${loginId}/tty?cols=${cols}&rows=${rows}`,
      )
      ws.binaryType = "arraybuffer"
      ws.onopen = () => {
        fitHost()
        term?.focus()
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              op: "resize",
              cols: term?.cols || cols,
              rows: term?.rows || rows,
            }),
          )
        }
      }
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const body = JSON.parse(event.data) as {
              op?: string
              code?: number | null
              note?: string
            }
            if (body.op === "exit") {
              sawExit = true
              if (body.note) term?.write(`\r\n${body.note}\r\n`)
              onExit(typeof body.code === "number" ? body.code : null)
            }
          } catch {
            // ignore malformed control frames
          }
          return
        }
        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data
        term?.write(bytes)
      }
      ws.onerror = () => {
        term?.write("\r\nterminal connection failed\r\n")
      }
      ws.onclose = () => {
        if (!sawExit && !disposed) term?.write("\r\nconnection closed\r\n")
      }
      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(new TextEncoder().encode(data))
      })
      term.onResize(({ cols: nextCols, rows: nextRows }) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ op: "resize", cols: nextCols, rows: nextRows }),
          )
        }
      })
      requestAnimationFrame(() => fitHost())
    })()
    return () => {
      disposed = true
      observer.disconnect()
      ws?.close()
      term?.dispose()
    }
  }, [loginId, onExit])
  return <div ref={hostRef} className="ob-tty" />
}

export function Providers() {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState("")
  const [method, setMethod] = useState("")
  const [auth, setAuth] = useState<ProviderAuth>({})
  const [connected, setConnected] = useState<string[]>([])
  const [loginId, setLoginId] = useState("")
  const [loginBusy, setLoginBusy] = useState(false)
  const mobile = useMobile()

  const providerIds = Object.keys(auth)
  const methods = provider && auth[provider] ? auth[provider] : []

  async function load() {
    setError("")
    setLoading(true)
    try {
      await api("/api/desktop/start", { method: "POST" })
      await waitForDesktop()
      const body = await api<{
        providers?: { connected?: string[] }
        auth?: ProviderAuth
      }>("/api/providers")
      setConnected(body.providers?.connected ?? [])
      setAuth(body.auth ?? {})
      const ids = Object.keys(body.auth ?? {})
      if (ids.length > 0 && !ids.includes(provider)) {
        setProvider(ids[0] ?? "")
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  async function startLogin() {
    if (!provider) {
      setError("pick a provider first")
      return
    }
    setError("")
    setLoginBusy(true)
    try {
      const body = await api<{ id: string }>("/api/providers/login", {
        method: "POST",
        body: JSON.stringify({
          provider,
          method: method || undefined,
        }),
      })
      setLoginId(body.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "login failed")
    } finally {
      setLoginBusy(false)
    }
  }

  async function logoutProvider(id: string) {
    setError("")
    try {
      await api("/api/providers/logout", {
        method: "POST",
        body: JSON.stringify({ provider: id }),
      })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "logout failed")
    }
  }

  const onLoginExit = useCallback((code: number | null) => {
    if (code !== 0) return
    void api<{ providers?: { connected?: string[] } }>("/api/providers")
      .then((body) => setConnected(body.providers?.connected ?? []))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "failed"),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load only
  useEffect(() => {
    void load()
  }, [])

  return (
    <Box className="ob-providers">
      <Stack
        spacing={1.5}
        sx={{
          p: mobile ? 1 : 2,
          maxWidth: 1100,
          mx: "auto",
          width: "100%",
          flex: 1,
          minHeight: 0,
        }}
      >
        {error ? (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Connecting…" : "Connect & reload"}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ alignSelf: "center" }}
          >
            {connected.length} connected
          </Typography>
        </Stack>

        <Stack
          direction={mobile ? "column" : "row"}
          spacing={1.5}
          sx={{ alignItems: "stretch", flex: 1, minHeight: 0 }}
        >
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              flex: mobile ? "0 0 auto" : "0 0 340px",
              maxHeight: mobile ? 180 : "none",
              minWidth: 0,
              overflow: "auto",
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1" sx={{ flex: 1 }}>
                Connected
              </Typography>
              <Chip size="small">{connected.length}</Chip>
            </Stack>
            {loading ? (
              <Stack spacing={1}>
                <Skeleton height={32} />
                <Skeleton height={32} />
              </Stack>
            ) : connected.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                No providers connected yet. Pick one on the right to sign in
                with `opencode auth login`.
              </Typography>
            ) : (
              <List dense disablePadding>
                {connected.map((id, index) => (
                  <ListItem
                    key={id}
                    sx={{
                      gap: 1,
                      pr: 1,
                      py: 0.75,
                      alignItems: "center",
                      borderBottom:
                        index < connected.length - 1
                          ? "1px solid var(--mui-palette-divider, rgba(0,0,0,0.12))"
                          : "none",
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircleIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={id}
                      secondary="opencode auth connected"
                      sx={{ flex: 1, minWidth: 0 }}
                      SlotProps={{
                        primary: {
                          sx: {
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                        secondary: {
                          sx: {
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                      }}
                    />
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<LogoutIcon />}
                      onClick={() => void logoutProvider(id)}
                      sx={{ flexShrink: 0 }}
                    >
                      Log out
                    </Button>
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Add provider
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              Chat models come from the providers connected here.
            </Typography>
            <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
              {loading ? (
                <Stack spacing={1}>
                  <Skeleton height={44} />
                  <Skeleton height={44} />
                </Stack>
              ) : providerIds.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  Press “Connect & reload” to list provider ids.
                </Typography>
              ) : (
                <>
                  <Select
                    name="provider"
                    label="Provider"
                    value={provider}
                    onSelect={(value) => {
                      setProvider(value)
                      setMethod("")
                    }}
                  >
                    {providerIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </Select>
                  <Select
                    name="method"
                    label="Method (optional)"
                    value={method}
                    onSelect={setMethod}
                  >
                    {[
                      <option key="default" value="">
                        default
                      </option>,
                      ...methods.map((item, index) => (
                        <option
                          key={`${item.label ?? item.type ?? index}`}
                          value={item.label ?? item.type ?? ""}
                        >
                          {item.label ?? item.type ?? `method ${index + 1}`}
                        </option>
                      )),
                    ]}
                  </Select>
                </>
              )}
              <Button
                variant="contained"
                startIcon={<LoginIcon />}
                onClick={() => void startLogin()}
                disabled={!provider || loginBusy}
              >
                {loginBusy ? "Starting…" : "opencode auth login"}
              </Button>

              <Box
                sx={{
                  flex: 1,
                  minHeight: mobile ? 220 : 280,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {loginId ? (
                  <LoginTerminal loginId={loginId} onExit={onLoginExit} />
                ) : (
                  <Typography variant="body2" color="textSecondary">
                    Start login to open the terminal.
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" color="textSecondary">
                Keys go straight through to `opencode auth login` in your
                desktop. A success restarts OpenCode.
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  )
}
