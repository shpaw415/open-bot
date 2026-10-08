import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, { DialogActions } from "@shpaw415/mui-lite/Dialog"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { DeleteIcon, ExtensionIcon, RefreshIcon } from "./icons"
import {
  type InstalledPluginInfo,
  PluginBadges,
  useInstalledPlugins,
} from "./plugin-ui"

type MarketPlugin = {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string
  category: string
  tags: string[]
  status: "pending" | "approved" | "rejected"
  downloads: number
}

type MarketComment = {
  id: string
  author: string
  authorKind: string
  body: string
  createdAt: number
}

function PluginHeader({
  plugin,
}: {
  plugin: { name: string; pluginId: string; version: string }
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="subtitle2">{plugin.name}</Typography>
      <Typography variant="caption" color="textSecondary">
        {plugin.pluginId} · v{plugin.version}
      </Typography>
    </Stack>
  )
}

function InstallDialog({
  target,
  onClose,
  onInstalled,
}: {
  target: { id: string; name: string; version: string; permissions: string[] }
  onClose: () => void
  onInstalled: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function install() {
    setBusy(true)
    setError("")
    try {
      await api("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId: target.id, confirm: true }),
      })
      onInstalled()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "install failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth>
      <Stack spacing={2} sx={{ p: 3 }}>
        <Typography variant="h6">Install {target.name}?</Typography>
        <Typography variant="body2" color="textSecondary">
          v{target.version} · id {target.id}
        </Typography>
        <PluginBadges permissions={target.permissions} />
        <Typography variant="caption" color="textSecondary">
          Plugins can add skills, personalities, scheduled jobs, dashboard tabs,
          and desktop tools. Remove them any time from this page.
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void install()}
        >
          {busy ? "Installing…" : "Install"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function InstalledCard({
  plugin,
  busy,
  onToggle,
  onRemove,
  onSettings,
}: {
  plugin: InstalledPluginInfo
  busy: boolean
  onToggle: (plugin: InstalledPluginInfo) => void
  onRemove: (plugin: InstalledPluginInfo) => void
  onSettings: (plugin: InstalledPluginInfo) => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <PluginHeader plugin={plugin} />
            <Typography
              variant="body2"
              color="textSecondary"
              sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {plugin.description}
            </Typography>
          </Stack>
          <ToolTip title={plugin.enabled ? "Disable" : "Enable"}>
            <Switch
              checked={plugin.enabled}
              disabled={busy}
              onChange={() => onToggle(plugin)}
            />
          </ToolTip>
          <IconButton
            size="small"
            aria-label={`Remove ${plugin.name}`}
            disabled={busy}
            onClick={() => {
              if (confirm) {
                onRemove(plugin)
                setConfirm(false)
                return
              }
              setConfirm(true)
            }}
          >
            {confirm ? (
              <Typography variant="caption">sure?</Typography>
            ) : (
              <DeleteIcon />
            )}
          </IconButton>
        </Stack>
        {(plugin.manifest.configs?.length ?? 0) > 0 ? (
          <Button
            variant="text"
            disabled={busy}
            onClick={() => onSettings(plugin)}
          >
            Settings
          </Button>
        ) : null}
      </Stack>
    </Paper>
  )
}

function SettingsDialog({
  plugin,
  onClose,
}: {
  plugin: InstalledPluginInfo
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const config of plugin.manifest.configs ?? [])
      out[config.key] = config.def
    return out
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api(
        `/api/plugins/installed/${encodeURIComponent(plugin.pluginId)}/settings`,
        {
          method: "PUT",
          body: JSON.stringify({ settings: values }),
        },
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth>
      <Stack spacing={2} sx={{ p: 3 }}>
        <Typography variant="h6">{plugin.name} settings</Typography>
        {(plugin.manifest.configs ?? []).map((config) => (
          <TextField
            key={config.key}
            label={config.label}
            value={values[config.key] ?? ""}
            onChange={(event) =>
              setValues({ ...values, [config.key]: event.currentTarget.value })
            }
          />
        ))}
      </Stack>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MarketRow({
  plugin,
  installed,
  busy,
  onInstall,
}: {
  plugin: MarketPlugin
  installed: boolean
  busy: boolean
  onInstall: (plugin: MarketPlugin) => void
}) {
  return (
    <Stack spacing={0.5}>
      {installed ? <Divider /> : null}
      <Stack direction="row" spacing={1} alignItems="center">
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="baseline">
            <Typography variant="subtitle2">{plugin.name}</Typography>
            <Typography variant="caption" color="textSecondary">
              {plugin.id} · v{plugin.version} · {plugin.author}
            </Typography>
            {plugin.status !== "approved" ? (
              <Chip label={plugin.status} size="small" variant="outlined" />
            ) : null}
          </Stack>
          <Typography
            variant="body2"
            color="textSecondary"
            sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {plugin.description}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant={installed ? "text" : "outlined"}
          disabled={busy || installed}
          onClick={() => onInstall(plugin)}
        >
          {installed ? "Installed" : "Install"}
        </Button>
      </Stack>
    </Stack>
  )
}

function Discussion({ pluginId }: { pluginId: string }) {
  const [comments, setComments] = useState<MarketComment[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const body = await api<{ comments?: MarketComment[] }>(
        `/api/plugins/market/${encodeURIComponent(pluginId)}/comments`,
      )
      setComments(body.comments ?? [])
    } catch {
      setComments([])
    }
  }, [pluginId])

  useEffect(() => {
    void load()
  }, [load])

  async function post() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api(
        `/api/plugins/market/${encodeURIComponent(pluginId)}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body: text.trim() }),
        },
      )
      setText("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Discussion</Typography>
      {comments.map((comment) => (
        <Stack key={comment.id} spacing={0.25}>
          <Typography variant="caption" color="textSecondary">
            {comment.author} · {new Date(comment.createdAt).toLocaleString()}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {comment.body}
          </Typography>
        </Stack>
      ))}
      {comments.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          No comments yet. Agents can discuss this plugin with its creator.
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1}>
        <TextField
          label="Ask the creator"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="text"
          disabled={busy || !text.trim()}
          onClick={() => void post()}
        >
          Post
        </Button>
      </Stack>
    </Stack>
  )
}

export function Plugins({ isAdmin }: { isAdmin: boolean }) {
  const { plugins, policy, configured, refresh } = useInstalledPlugins()
  const [market, setMarket] = useState<MarketPlugin[]>([])
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [installTarget, setInstallTarget] = useState<{
    id: string
    name: string
    version: string
    permissions: string[]
  } | null>(null)
  const [settingsFor, setSettingsFor] = useState<InstalledPluginInfo | null>(
    null,
  )
  const [detailId, setDetailId] = useState<string | null>(null)

  const loadMarket = useCallback(async (q: string) => {
    setBusy(true)
    setError("")
    try {
      const suffix = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
      const body = await api<{ plugins?: MarketPlugin[] }>(
        `/api/plugins/market${suffix}`,
      )
      setMarket(body.plugins ?? [])
    } catch (caught) {
      setMarket([])
      setError(
        caught instanceof Error ? caught.message : "marketplace unavailable",
      )
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void loadMarket("")
  }, [loadMarket])

  const installedIds = useMemo(
    () => new Set(plugins.map((plugin) => plugin.pluginId)),
    [plugins],
  )

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await action()
      setNotice(message)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "action failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      className="ob-scroll"
      sx={{ p: 2, maxWidth: 860, mx: "auto", width: "100%" }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ExtensionIcon />
          <Typography variant="h6" sx={{ flex: 1 }}>
            Plugins
          </Typography>
          <Chip label={`policy: ${policy}`} size="small" variant="outlined" />
          {isAdmin ? (
            <Button
              size="small"
              variant="text"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    api("/api/plugins/policy", {
                      method: "PUT",
                      body: JSON.stringify({
                        policy: policy === "auto" ? "manual" : "auto",
                      }),
                    }),
                  "policy updated",
                )
              }
            >
              switch to {policy === "auto" ? "manual" : "auto"}
            </Button>
          ) : null}
        </Stack>
        {!configured ? (
          <Alert severity="info">
            The marketplace is not configured on this instance. Set
            OPEN_BOT_MARKETPLACE_URL and OPEN_BOT_MARKETPLACE_TOKEN on the
            control plane to browse and publish plugins.
          </Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success">{notice}</Alert> : null}

        <Typography variant="subtitle2">Installed</Typography>
        {plugins.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            Nothing installed yet. Ask the agent to build a plugin, or install
            one from the marketplace below.
          </Typography>
        ) : (
          plugins.map((plugin) => (
            <InstalledCard
              key={plugin.id}
              plugin={plugin}
              busy={busy}
              onToggle={(target) =>
                void act(
                  () =>
                    api(
                      `/api/plugins/installed/${encodeURIComponent(target.pluginId)}/${target.enabled ? "disable" : "enable"}`,
                      { method: "POST" },
                    ),
                  `${target.pluginId} ${target.enabled ? "disabled" : "enabled"}`,
                )
              }
              onRemove={(target) =>
                void act(
                  () =>
                    api(
                      `/api/plugins/installed/${encodeURIComponent(target.pluginId)}`,
                      { method: "DELETE" },
                    ),
                  `${target.pluginId} removed`,
                )
              }
              onSettings={setSettingsFor}
            />
          ))
        )}

        <Divider />
        <Typography variant="subtitle2">Marketplace</Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Search plugins"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadMarket(query)
            }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void loadMarket(query)}
          >
            Search
          </Button>
          <ToolTip title="Refresh">
            <IconButton
              aria-label="Refresh marketplace"
              onClick={() => void loadMarket(query)}
            >
              <RefreshIcon />
            </IconButton>
          </ToolTip>
        </Stack>
        {market.map((plugin) => (
          <MarketRow
            key={plugin.id}
            plugin={plugin}
            installed={installedIds.has(plugin.id)}
            busy={busy}
            onInstall={async (target) => {
              setError("")
              try {
                const probe = await api<{
                  needsConfirm?: boolean
                  permissions?: string[]
                }>("/api/plugins/install", {
                  method: "POST",
                  body: JSON.stringify({ pluginId: target.id }),
                })
                if (probe.needsConfirm) {
                  setInstallTarget({
                    id: target.id,
                    name: target.name,
                    version: target.version,
                    permissions: probe.permissions ?? [],
                  })
                  return
                }
                await refresh()
                setNotice(`${target.id} installed`)
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : "install failed",
                )
              }
            }}
          />
        ))}
        {!busy && market.length === 0 && configured ? (
          <Typography variant="body2" color="textSecondary">
            No plugins found. Agents publish plugins with{" "}
            <code>ob-plugin publish</code>.
          </Typography>
        ) : null}

        {detailId ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Discussion pluginId={detailId} />
            <Button variant="text" onClick={() => setDetailId(null)}>
              Close discussion
            </Button>
          </Paper>
        ) : null}
      </Stack>

      {installTarget ? (
        <InstallDialog
          target={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={() => {
            void refresh()
            setNotice(`${installTarget.id} installed`)
          }}
        />
      ) : null}
      {settingsFor ? (
        <SettingsDialog
          plugin={settingsFor}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}
    </Box>
  )
}
