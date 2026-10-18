import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { Chip } from "./chip"
import { type InstalledPluginInfo, usePlugins } from "./plugin-ui"
import Stack from "./stack"

type PagesStatus = {
  pages: { pluginId: string; running: boolean }[]
  desktop: "starting" | "running" | "sleeping"
}

type WebhookState = { enabled: boolean; secured: boolean; path: string }

function EndpointCard({
  plugin,
  running,
  desktop,
}: {
  plugin: InstalledPluginInfo
  running: boolean | null
  desktop: string
}) {
  const [state, setState] = useState<WebhookState | null>(null)
  const [secret, setSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [test, setTest] = useState("")

  useEffect(() => {
    api<WebhookState>(
      `/api/plugins/installed/${encodeURIComponent(plugin.pluginId)}/webhook`,
    )
      .then((body) => setState(body.enabled ? body : null))
      .catch(() => setError("could not load the endpoint state"))
  }, [plugin.pluginId])

  async function saveSecret(next: string) {
    setBusy(true)
    setError("")
    try {
      const body = await api<{ secured: boolean }>(
        `/api/plugins/installed/${encodeURIComponent(plugin.pluginId)}/webhook`,
        { method: "POST", body: JSON.stringify({ secret: next }) },
      )
      setState((prev) => (prev ? { ...prev, secured: body.secured } : prev))
      setSecret("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not save")
    } finally {
      setBusy(false)
    }
  }

  function generateSecret() {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    setSecret(
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  }

  async function runTest(url: string) {
    setTest("")
    setError("")
    try {
      const response = await fetch(url)
      await response.arrayBuffer().catch(() => {})
      setTest(
        `test request answered HTTP ${response.status}` +
          (desktop !== "running" ? " (the desktop woke up for it)" : ""),
      )
    } catch {
      setTest("test request failed — is the desktop reachable?")
    }
  }

  if (!state) {
    return error ? <Alert severity="error">{error}</Alert> : null
  }
  const url = `${window.location.origin}${state.path}`
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          sx={{ flexWrap: "wrap", gap: 1 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1">{plugin.name}</Typography>
            <Chip
              label={state.secured ? "secret-protected" : "public"}
              size="small"
              color={state.secured ? "success" : undefined}
            />
            <Chip
              label={running === null ? desktop : running ? "running" : "idle"}
              size="small"
              color={running ? "primary" : undefined}
            />
          </Stack>
          <Typography variant="caption" color="textSecondary">
            {plugin.pluginId}
          </Typography>
        </Stack>
        {plugin.description ? (
          <Typography variant="body2" color="textSecondary">
            {plugin.description}
          </Typography>
        ) : null}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap", gap: 1 }}
        >
          <TextField
            label="Endpoint URL"
            value={url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onChange={() => {}}
            sx={{ flexGrow: 1, minWidth: 240 }}
          />
          <Button
            disabled={busy}
            onClick={() => void navigator.clipboard.writeText(url)}
          >
            Copy
          </Button>
          <Button disabled={busy} onClick={() => void runTest(url)}>
            Test
          </Button>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap", gap: 1 }}
        >
          <TextField
            label="Optional secret"
            value={secret}
            disabled={busy}
            type="password"
            onChange={(event) => setSecret(event.currentTarget.value)}
            sx={{ flexGrow: 1, minWidth: 240 }}
          />
          <Button disabled={busy} onClick={generateSecret}>
            Generate
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void saveSecret(secret)}
          >
            {state.secured ? "Replace" : "Set"}
          </Button>
          {state.secured ? (
            <Button
              disabled={busy}
              color="error"
              onClick={() => void saveSecret("")}
            >
              Remove
            </Button>
          ) : null}
        </Stack>
        <Typography variant="caption" color="textSecondary">
          Requests wake the desktop if it is asleep and are forwarded to the
          plugin like a normal web server (pages, APIs, streams, WebSockets).
          With a secret set, callers authenticate via the
          X-Open-Bot-Webhook-Secret header or ?secret= query parameter. Append
          ?ob_async=1 to the URL to answer 202 and process in the background.
        </Typography>
        {test ? <Typography variant="body2">{test}</Typography> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  )
}

export function Endpoints() {
  const {
    plugins,
    status: pluginsStatus,
    error: pluginsError,
    refresh: refreshPlugins,
  } = usePlugins()
  const [status, setStatus] = useState<PagesStatus | null>(null)
  const [error, setError] = useState("")

  const loadStatus = useCallback(() => {
    setError("")
    api<PagesStatus>("/api/pages")
      .then(setStatus)
      .catch(() => setError("could not load the endpoint status"))
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const endpoints = plugins.filter(
    (plugin) =>
      plugin.enabled && plugin.manifest.dashboard?.pages?.public === true,
  )

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <Typography variant="h6" component="h1">
          Public endpoints
        </Typography>
        {status ? (
          <Chip
            size="small"
            label={`desktop ${status.desktop}`}
            color={status.desktop === "running" ? "primary" : undefined}
          />
        ) : null}
      </Stack>
      <Typography variant="body2" color="textSecondary">
        Every plugin that opted into a public endpoint (dashboard.pages.public).
        Each URL is reachable from the internet, wakes the desktop on request,
        and forwards to the plugin's server.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {pluginsStatus === "loading" ? (
        <Box aria-busy="true">
          <CircularProgress size={1} />
        </Box>
      ) : null}
      {pluginsStatus === "error" ? (
        <Alert
          severity="error"
          action={
            <Button size="small" onClick={() => void refreshPlugins()}>
              Retry
            </Button>
          }
        >
          {pluginsError || "The installed plugin list did not load."}
        </Alert>
      ) : null}
      {pluginsStatus === "ready" && endpoints.length === 0 ? (
        <Alert severity="info">
          No plugins expose a public endpoint. Plugins opt in by declaring
          dashboard.pages.public: true in their manifest.
        </Alert>
      ) : null}
      {endpoints.map((plugin) => (
        <EndpointCard
          key={plugin.pluginId}
          plugin={plugin}
          running={
            status?.pages.find((page) => page.pluginId === plugin.pluginId)
              ?.running ?? null
          }
          desktop={status?.desktop ?? "unknown"}
        />
      ))}
    </Stack>
  )
}
