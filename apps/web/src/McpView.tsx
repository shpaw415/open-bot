import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { api } from "./api"
import {
  ConfigItemCard,
  EmptyState,
  GhostCards,
  ItemAvatar,
  PluginBadge,
} from "./ConfigList"
import { ConfigSection } from "./ConfigSection"
import { Chip } from "./chip"
import { useEventStream } from "./hooks"
import { HubIcon } from "./icons"
import { Tip } from "./Tip"

type McpServer = {
  name: string
  type: "local" | "remote"
  target: string
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
  enabled: boolean
  status:
    | "connected"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration"
    | "unknown"
  error: string | null
  plugin?: { id: string; name: string } | null
}

const STATUS_META: Record<
  McpServer["status"],
  { label: string; color?: "success" | "warning" | "error" }
> = {
  connected: { label: "Connected", color: "success" },
  disabled: { label: "Disabled" },
  failed: { label: "Failed", color: "error" },
  needs_auth: { label: "Needs auth", color: "warning" },
  needs_client_registration: { label: "Needs client", color: "warning" },
  unknown: { label: "Unknown" },
}

type Draft = {
  previousName: string
  name: string
  type: "local" | "remote"
  command: string
  url: string
  environment: string
  headers: string
}

const emptyDraft: Draft = {
  previousName: "",
  name: "",
  type: "local",
  command: "",
  url: "",
  environment: "",
  headers: "",
}

function parseStringMap(text: string, label: string) {
  if (!text.trim()) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`)
  for (const value of Object.values(parsed as Record<string, unknown>))
    if (typeof value !== "string")
      throw new Error(`${label} values must be strings`)
  return parsed as Record<string, string>
}

export function McpView() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmName, setConfirmName] = useState("")
  const reloading = useRef(false)

  const load = useCallback(async () => {
    if (reloading.current) return
    reloading.current = true
    try {
      const body = await api<{ servers?: McpServer[]; live?: boolean }>(
        "/api/mcp",
      )
      setServers(body.servers ?? [])
      setLive(body.live !== false)
      setError("")
    } catch (caught) {
      setServers([])
      setError(
        caught instanceof Error ? caught.message : "failed to load MCP servers",
      )
    } finally {
      setLoading(false)
      reloading.current = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const { subscribe } = useEventStream(true)
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "mcp.changed") void load()
    })
  }, [subscribe, load])

  function openNew() {
    setError("")
    setSaved("")
    setConfirmName("")
    setDraft(emptyDraft)
  }

  function openEdit(server: McpServer) {
    setError("")
    setSaved("")
    setConfirmName("")
    setDraft({
      previousName: server.name,
      name: server.name,
      type: server.type,
      command:
        server.type === "local"
          ? (server.command ?? []).join(" ") || server.target
          : "",
      url: server.type === "remote" ? (server.url ?? server.target) : "",
      environment: server.environment
        ? JSON.stringify(server.environment, null, 2)
        : "",
      headers: server.headers ? JSON.stringify(server.headers, null, 2) : "",
    })
  }

  async function save() {
    if (!draft) return
    setError("")
    setSaved("")
    setBusy(true)
    try {
      let environment: Record<string, string> | undefined
      let headers: Record<string, string> | undefined
      try {
        environment = parseStringMap(draft.environment, "Environment")
        headers = parseStringMap(draft.headers, "Headers")
      } catch (caught) {
        throw new Error(
          caught instanceof Error ? caught.message : "invalid JSON",
        )
      }
      const server =
        draft.type === "local"
          ? {
              type: "local",
              command: draft.command.trim().split(/\s+/).filter(Boolean),
              environment: Object.keys(environment ?? {}).length
                ? environment
                : undefined,
            }
          : {
              type: "remote",
              url: draft.url.trim(),
              headers: Object.keys(headers ?? {}).length ? headers : undefined,
            }
      await api(`/api/mcp/${encodeURIComponent(draft.name.trim())}`, {
        method: "PUT",
        body: JSON.stringify(server),
      })
      setDraft(null)
      setSaved("Saved. OpenCode restarts to pick up the change.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(server: McpServer, enable: boolean) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api(
        `/api/mcp/${encodeURIComponent(server.name)}/${enable ? "enable" : "disable"}`,
        {
          method: "POST",
        },
      )
      setSaved("Saved. OpenCode restarts to pick up the change.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "change failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove(name: string) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api(`/api/mcp/${encodeURIComponent(name)}`, { method: "DELETE" })
      setConfirmName("")
      setSaved("Removed. OpenCode restarts to pick up the change.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={<HubIcon />}
      title="MCP servers"
      description="Model Context Protocol servers the desktop agent can call. Changes update opencode.json and restart OpenCode; plugins manage their own entries."
      status={
        !loading && servers.length > 0 ? { label: `${servers.length}` } : null
      }
    >
      <Stack spacing={1.5}>
        {error && !draft ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {loading && servers.length === 0 ? (
          <>
            <Alert severity="info">
              Loading MCP servers — this starts your desktop if it was asleep…
            </Alert>
            <GhostCards />
          </>
        ) : servers.length === 0 ? (
          <EmptyState
            icon={<HubIcon width={24} height={24} />}
            title="No MCP servers"
            subtext="Add one below to give the agent more tools. Plugins can bring their own servers."
          />
        ) : (
          servers.map((server) => {
            const meta = STATUS_META[server.status]
            const managed = Boolean(server.plugin)
            return (
              <ConfigItemCard
                key={server.name}
                avatar={
                  <ItemAvatar tone={managed ? "secondary" : "primary"}>
                    <HubIcon width={20} height={20} />
                  </ItemAvatar>
                }
                title={server.name}
                badge={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Tip
                      title={
                        server.error || `Status: ${meta.label.toLowerCase()}`
                      }
                    >
                      <Chip
                        size="small"
                        color={meta.color}
                        sx={{ height: 22, borderRadius: "8px" }}
                      >
                        {meta.label}
                      </Chip>
                    </Tip>
                    {server.plugin ? (
                      <PluginBadge plugin={server.plugin} />
                    ) : null}
                  </Stack>
                }
                description={`${server.type === "remote" ? "Remote" : "Local"} · ${server.target || "(no target)"}`}
                pluginOwned={managed}
                actions={
                  <>
                    <Tip
                      title={
                        managed
                          ? `Managed by the ${server.plugin?.name} plugin — toggle it on the Plugins tab`
                          : server.enabled
                            ? "Disable this server"
                            : "Enable this server"
                      }
                    >
                      <Switch
                        checked={server.enabled}
                        disabled={busy || managed || !live}
                        onChange={(event) =>
                          void toggle(server, event.currentTarget.checked)
                        }
                      />
                    </Tip>
                    <Button
                      size="small"
                      variant="text"
                      disabled={busy || managed || !live}
                      onClick={() => openEdit(server)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      color="error"
                      disabled={busy || managed || !live}
                      onClick={() => {
                        if (confirmName === server.name) {
                          void remove(server.name)
                          return
                        }
                        setConfirmName(server.name)
                      }}
                    >
                      {confirmName === server.name
                        ? "Confirm delete"
                        : "Delete"}
                    </Button>
                  </>
                }
              />
            )
          })
        )}
        {!live && servers.length > 0 ? (
          <Typography variant="caption" color="textSecondary">
            Live status is unavailable right now — the desktop agent is still
            starting or restarting.
          </Typography>
        ) : null}
        {draft ? (
          <AccessibleDialog
            open
            fullWidth
            scroll="paper"
            slotProps={{ paper: { sx: { maxWidth: 720, minWidth: "45%" } } }}
            onClose={() => {
              if (!busy) setDraft(null)
            }}
          >
            <DialogTitle>
              {draft.previousName
                ? `Edit ${draft.previousName}`
                : "New MCP server"}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Name"
                  value={draft.name}
                  placeholder="my-server"
                  disabled={Boolean(draft.previousName)}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
                <Typography variant="caption" color="textSecondary">
                  Letters, digits, dots, dashes, or underscores — up to 64.
                </Typography>
                {draft.previousName ? null : (
                  <Select
                    name="mcp-type"
                    label="Type"
                    value={draft.type}
                    onSelect={(value: string) =>
                      setDraft({ ...draft, type: value as Draft["type"] })
                    }
                  >
                    <option value="local">Local — run a command</option>
                    <option value="remote">Remote — connect to a URL</option>
                  </Select>
                )}
                {draft.type === "local" ? (
                  <TextField
                    label="Command"
                    value={draft.command}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem /home/agent/workspace"
                    onChange={(event) =>
                      setDraft({ ...draft, command: event.currentTarget.value })
                    }
                  />
                ) : (
                  <TextField
                    label="URL"
                    value={draft.url}
                    placeholder="https://example.com/mcp"
                    onChange={(event) =>
                      setDraft({ ...draft, url: event.currentTarget.value })
                    }
                  />
                )}
                {draft.type === "local" ? (
                  <TextField
                    label="Environment (JSON, optional)"
                    value={draft.environment}
                    multiline
                    rows={3}
                    placeholder={'{"API_KEY": "…"}'}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        environment: event.currentTarget.value,
                      })
                    }
                  />
                ) : (
                  <TextField
                    label="Headers (JSON, optional)"
                    value={draft.headers}
                    multiline
                    rows={3}
                    placeholder={'{"Authorization": "Bearer …"}'}
                    onChange={(event) =>
                      setDraft({ ...draft, headers: event.currentTarget.value })
                    }
                  />
                )}
                <Typography variant="caption" color="textSecondary">
                  Saving restarts OpenCode. Running threads finish first.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={
                  busy ||
                  !draft.name.trim() ||
                  (draft.type === "local"
                    ? !draft.command.trim()
                    : !draft.url.trim())
                }
                onClick={() => void save()}
              >
                Save server
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        <Button
          variant="contained"
          disabled={busy || loading}
          onClick={openNew}
        >
          Add MCP server
        </Button>
      </Stack>
    </ConfigSection>
  )
}
