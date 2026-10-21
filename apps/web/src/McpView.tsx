import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
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
import {
  type DirectoryGroup,
  DirectorySection,
  useCollapsedDirs,
} from "./directory-sections"
import { confirmDiscard, snapshotDirty } from "./discard-guard"
import { useEventStream } from "./hooks"
import { HubIcon } from "./icons"
import Stack from "./stack"
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

type CatalogDir = { id: string; kind: string; label: string; position: number }

const UNGROUPED_LABEL = "Ungrouped"

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
  // The draft as it opened: closing asks before dropping real edits.
  const [pristine, setPristine] = useState<Draft | null>(null)
  const titleId = useId()
  const groupTitleId = useId()
  const moveTitleId = useId()
  const [confirmName, setConfirmName] = useState("")
  const [groupConfirm, setGroupConfirm] = useState("")
  const reloading = useRef(false)
  const [dirs, setDirs] = useState<CatalogDir[]>([])
  const [dirOf, setDirOf] = useState<Map<string, string>>(new Map())
  const [groupDraft, setGroupDraft] = useState<{
    id: string | null
    label: string
  } | null>(null)
  const [moveServer, setMoveServer] = useState<string | null>(null)
  const [collapsed, toggleCollapsed] = useCollapsedDirs("ob.dirs.collapsed.mcp")

  const loadDirs = useCallback(async () => {
    try {
      const body = await api<{
        dirs?: CatalogDir[]
        items?: { name: string; dirId: string }[]
      }>("/api/catalog/dirs?kind=mcp")
      setDirs(body.dirs ?? [])
      setDirOf(
        new Map((body.items ?? []).map((item) => [item.name, item.dirId])),
      )
    } catch {
      setDirs([])
      setDirOf(new Map())
    }
  }, [])

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
    void loadDirs()
  }, [load, loadDirs])

  const { subscribe } = useEventStream(true)
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "mcp.changed") void load()
      if (event.type === "catalog.changed") void loadDirs()
    })
  }, [subscribe, load, loadDirs])

  function openNew() {
    setError("")
    setSaved("")
    setConfirmName("")
    setDraft(emptyDraft)
    setPristine(emptyDraft)
  }

  function openEdit(server: McpServer) {
    setError("")
    setSaved("")
    setConfirmName("")
    const next: Draft = {
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
    }
    setDraft(next)
    setPristine(next)
  }

  /** Escape, backdrop and Cancel share this: real edits ask first. */
  function requestClose() {
    if (busy) return
    if (
      snapshotDirty(
        pristine as Record<string, unknown> | null,
        (draft ?? null) as Record<string, unknown> | null,
      ) &&
      !confirmDiscard()
    )
      return
    setDraft(null)
    setPristine(null)
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
      setPristine(null)
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

  async function saveGroup() {
    if (!groupDraft) return
    const label = groupDraft.label.trim()
    if (!label) return
    setBusy(true)
    setError("")
    try {
      if (groupDraft.id) {
        await api(`/api/catalog/dirs/${encodeURIComponent(groupDraft.id)}`, {
          method: "PUT",
          body: JSON.stringify({ label }),
        })
        setSaved("Group renamed.")
      } else {
        await api("/api/catalog/dirs", {
          method: "POST",
          body: JSON.stringify({ kind: "mcp", label }),
        })
        setSaved("Group created. Move servers into it from their card.")
      }
      setGroupDraft(null)
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function removeGroup(id: string) {
    setBusy(true)
    setError("")
    try {
      await api(`/api/catalog/dirs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      setGroupConfirm("")
      setSaved("Group removed. Its servers moved to the ungrouped list.")
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  async function reorderGroups(ids: string[]) {
    setBusy(true)
    setError("")
    try {
      await api("/api/catalog/dirs/reorder", {
        method: "PUT",
        body: JSON.stringify({ kind: "mcp", ids }),
      })
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reorder failed")
    } finally {
      setBusy(false)
    }
  }

  async function assign(name: string, dirId: string | null) {
    setBusy(true)
    setError("")
    try {
      await api("/api/catalog/dirs/assign", {
        method: "PUT",
        body: JSON.stringify({ kind: "mcp", names: [name], dirId }),
      })
      setMoveServer(null)
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "move failed")
    } finally {
      setBusy(false)
    }
  }

  // Sections: plugin groups (locked) → user groups (position order) →
  // Ungrouped (always last). Grouping is dashboard-side only — it never
  // touches opencode.json.
  const sections = useMemo(() => {
    type Bucket = {
      key: string
      group: DirectoryGroup
      servers: McpServer[]
    }
    const userBuckets = new Map<string, Bucket>()
    for (const dir of dirs)
      userBuckets.set(`dir:${dir.id}`, {
        key: `dir:${dir.id}`,
        group: { id: dir.id, label: dir.label, count: 0 },
        servers: [],
      })
    const pluginBuckets = new Map<string, Bucket>()
    let ungrouped: Bucket | null = null
    const bucketFor = (server: McpServer): Bucket => {
      if (server.plugin) {
        const key = `plugin:${server.plugin.id}`
        let bucket = pluginBuckets.get(key)
        if (!bucket) {
          bucket = {
            key,
            group: {
              id: null,
              label: `From ${server.plugin.name}`,
              count: 0,
              locked: true,
              badge: <PluginBadge plugin={server.plugin} />,
            },
            servers: [],
          }
          pluginBuckets.set(key, bucket)
        }
        return bucket
      }
      const dirId = dirOf.get(server.name)
      const bucket = dirId ? userBuckets.get(`dir:${dirId}`) : undefined
      if (bucket) return bucket
      if (!ungrouped)
        ungrouped = {
          key: "ungrouped",
          group: { id: null, label: UNGROUPED_LABEL, count: 0 },
          servers: [],
        }
      return ungrouped
    }
    for (const server of servers) {
      const bucket = bucketFor(server)
      bucket.servers.push(server)
      bucket.group.count++
    }
    return [
      ...[...pluginBuckets.values()].sort((a, b) =>
        a.group.label.localeCompare(b.group.label),
      ),
      ...userBuckets.values(),
      ...(ungrouped ? [ungrouped] : []),
    ]
  }, [servers, dirs, dirOf])

  const groupActions = (dir: CatalogDir, index: number) => (
    <Stack direction="row" spacing={0.25} alignItems="center">
      <Button
        size="small"
        variant="text"
        disabled={busy || index === 0}
        aria-label={`Move ${dir.label} up`}
        onClick={() => {
          const ids = dirs.map((d) => d.id)
          ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
          void reorderGroups(ids)
        }}
      >
        ↑
      </Button>
      <Button
        size="small"
        variant="text"
        disabled={busy || index === dirs.length - 1}
        aria-label={`Move ${dir.label} down`}
        onClick={() => {
          const ids = dirs.map((d) => d.id)
          ;[ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]
          void reorderGroups(ids)
        }}
      >
        ↓
      </Button>
      <Button
        size="small"
        variant="text"
        disabled={busy}
        onClick={() => setGroupDraft({ id: dir.id, label: dir.label })}
      >
        Rename
      </Button>
      <Button
        size="small"
        variant="text"
        color="error"
        disabled={busy}
        onClick={() => {
          if (groupConfirm === dir.id) {
            void removeGroup(dir.id)
            return
          }
          setGroupConfirm(dir.id)
        }}
      >
        {groupConfirm === dir.id ? "Confirm delete" : "Delete"}
      </Button>
    </Stack>
  )

  const serverCard = (server: McpServer) => {
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
            <Tip title={server.error || `Status: ${meta.label.toLowerCase()}`}>
              <Chip
                size="small"
                color={meta.color}
                sx={{ height: 22, borderRadius: "8px" }}
              >
                {meta.label}
              </Chip>
            </Tip>
            {server.plugin ? <PluginBadge plugin={server.plugin} /> : null}
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
            {managed ? null : (
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => setMoveServer(server.name)}
              >
                Move
              </Button>
            )}
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
              {confirmName === server.name ? "Confirm delete" : "Delete"}
            </Button>
          </>
        }
      />
    )
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
          <Stack spacing={2}>
            {sections.map((section) => {
              const dirIndex =
                section.group.id !== null
                  ? dirs.findIndex((d) => d.id === section.group.id)
                  : -1
              return (
                <DirectorySection
                  key={section.key}
                  group={
                    section.group.id !== null && dirIndex >= 0
                      ? {
                          ...section.group,
                          actions: groupActions(
                            dirs[dirIndex] as CatalogDir,
                            dirIndex,
                          ),
                        }
                      : section.group
                  }
                  collapsed={collapsed}
                  onToggle={toggleCollapsed}
                  emptyText={
                    section.group.locked
                      ? "No servers in this group yet."
                      : section.group.id !== null
                        ? "No servers here — use Move on a server card."
                        : "Everything not in a group lands here."
                  }
                >
                  {section.servers.map(serverCard)}
                </DirectorySection>
              )
            })}
          </Stack>
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
            aria-labelledby={titleId}
            slotProps={{ paper: { sx: { maxWidth: 720, minWidth: "45%" } } }}
            onClose={requestClose}
          >
            <DialogTitle id={titleId}>
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
              <Button variant="text" disabled={busy} onClick={requestClose}>
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
        {groupDraft ? (
          <AccessibleDialog
            open
            aria-labelledby={groupTitleId}
            onClose={() => setGroupDraft(null)}
          >
            <DialogTitle id={groupTitleId}>
              {groupDraft.id ? "Rename group" : "New group"}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Label"
                  value={groupDraft.label}
                  placeholder="Data sources, Browsers…"
                  autoFocus
                  onChange={(event) =>
                    setGroupDraft({
                      ...groupDraft,
                      label: event.currentTarget.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void saveGroup()
                    }
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  Organization only — groups live in the dashboard and never
                  touch opencode.json.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => setGroupDraft(null)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={busy || !groupDraft.label.trim()}
                onClick={() => void saveGroup()}
              >
                {groupDraft.id ? "Save" : "Create group"}
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        {moveServer ? (
          <AccessibleDialog
            open
            aria-labelledby={moveTitleId}
            onClose={() => setMoveServer(null)}
          >
            <DialogTitle id={moveTitleId}>Move « {moveServer} »</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Select
                  name="move-server-dir"
                  label="Group"
                  value={dirOf.get(moveServer) ?? ""}
                  onSelect={(value: string) => {
                    void assign(moveServer, value || null)
                  }}
                >
                  {[
                    <option key="none" value="">
                      {UNGROUPED_LABEL}
                    </option>,
                    ...dirs.map((dir) => (
                      <option key={dir.id} value={dir.id}>
                        {dir.label}
                      </option>
                    )),
                  ]}
                </Select>
                <Typography variant="caption" color="textSecondary">
                  Picking a group moves the server immediately.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="text" onClick={() => setMoveServer(null)}>
                Close
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || loading}
            onClick={openNew}
          >
            Add MCP server
          </Button>
          <Button
            variant="text"
            disabled={busy || loading}
            onClick={() => setGroupDraft({ id: null, label: "" })}
          >
            New group
          </Button>
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
