import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, { DialogActions } from "@shpaw415/mui-lite/Dialog"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { TablePagination } from "@shpaw415/mui-lite/Pagination"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress, LinearProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Snackbar from "@shpaw415/mui-lite/Snackbar"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import Table, {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@shpaw415/mui-lite/Table"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { useMobile } from "./hooks"
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

type VersionOption = { version: string; stability: "stable" | "dev" }

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function isDevVersion(version: string): boolean {
  return !STABLE_VERSION_PATTERN.test(version)
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
      {isDevVersion(plugin.version) ? (
        <ToolTip title="Development build — reinstall the same version to pick up republished fixes">
          <Chip size="small" color="warning" variant="outlined" label="dev" />
        </ToolTip>
      ) : null}
    </Stack>
  )
}

function InstallDialog({
  target,
  onClose,
  onInstalled,
}: {
  target: {
    id: string
    name: string
    version: string
    permissions: string[]
    setupCommands: string[]
    versions: VersionOption[]
  }
  onClose: () => void
  onInstalled: () => void
}) {
  const [version, setVersion] = useState(target.version)
  const [permissions, setPermissions] = useState(target.permissions)
  const [setupCommands, setSetupCommands] = useState(target.setupCommands)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const dev = isDevVersion(version)

  useEffect(() => {
    if (version === target.version) return
    let alive = true
    setChecking(true)
    api<{
      needsConfirm?: boolean
      permissions?: string[]
      setupCommands?: string[]
    }>("/api/plugins/install", {
      method: "POST",
      body: JSON.stringify({ pluginId: target.id, version }),
    })
      .then((probe) => {
        if (!alive || !probe.needsConfirm) return
        setPermissions(probe.permissions ?? [])
        setSetupCommands(probe.setupCommands ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [version, target.id, target.version])

  async function install() {
    setBusy(true)
    setError("")
    try {
      await api("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId: target.id, version, confirm: true }),
      })
      onInstalled()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "install failed")
    } finally {
      setBusy(false)
    }
  }

  const options: VersionOption[] = target.versions.some(
    (option) => option.version === target.version,
  )
    ? target.versions
    : [{ version: target.version, stability: "stable" }, ...target.versions]

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth>
      <Stack spacing={2} sx={{ p: 3 }}>
        <Typography variant="h6">Install {target.name}?</Typography>
        {busy || checking ? <LinearProgress variant="indeterminate" /> : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <Select
            name="version"
            label="Version"
            value={version}
            disabled={busy || checking}
            sx={{ minWidth: 220 }}
            onSelect={(next) => setVersion(next)}
          >
            {options.map((option) => (
              <option key={option.version} value={option.version}>
                v{option.version}
                {option.stability === "dev" ? " (dev)" : ""}
              </option>
            ))}
          </Select>
          <Typography variant="caption" color="textSecondary">
            id {target.id}
          </Typography>
        </Stack>
        {dev ? (
          <Alert severity="warning">
            Development build — for stress-testing and staging. It stays out of
            marketplace search; republish the same tag and reinstall here to
            pick up fixes.
          </Alert>
        ) : null}
        <PluginBadges permissions={permissions} />
        {setupCommands.length > 0 ? (
          <>
            <Typography variant="caption" color="textSecondary">
              Setup — these shell commands run as root in your desktop at
              install and again on every desktop start:
            </Typography>
            <Box
              Element="pre"
              sx={{
                m: 0,
                p: 1.5,
                maxHeight: 200,
                overflow: "auto",
                borderRadius: 1,
                bgcolor: "action.hover",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {setupCommands.join("\n")}
            </Box>
          </>
        ) : null}
        <Typography variant="caption" color="textSecondary">
          Plugins can add skills, personalities, scheduled jobs, dashboard tabs,
          and desktop tools. Remove them any time from this page.
        </Typography>
        {busy ? (
          <Typography variant="caption" color="textSecondary">
            Downloading the reviewed release and applying it to your desktop —
            this can take a minute.
          </Typography>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={1} /> : undefined}
          onClick={() => void install()}
        >
          {busy ? "Installing…" : "Install"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function InstalledTable({
  plugins,
  loaded,
  actionId,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onToggle,
  onRemove,
  onSettings,
  onReinstall,
}: {
  plugins: InstalledPluginInfo[]
  loaded: boolean
  actionId: string | null
  page: number
  rowsPerPage: 10 | 25 | 50 | 100
  onPageChange: (next: number) => void
  onRowsPerPageChange: (next: 10 | 25 | 50 | 100) => void
  onToggle: (plugin: InstalledPluginInfo) => void
  onRemove: (plugin: InstalledPluginInfo) => void
  onSettings: (plugin: InstalledPluginInfo) => void
  onReinstall: (plugin: InstalledPluginInfo) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const visible = plugins.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <Paper variant="outlined">
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Plugin</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Enabled</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loaded ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton height={32} />
                </TableCell>
              </TableRow>
            ) : plugins.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="textSecondary">
                    Nothing installed yet. Ask the agent to build a plugin, or
                    install one from the marketplace below.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((plugin) => {
                const rowBusy = actionId === plugin.pluginId
                return (
                  <TableRow key={plugin.id} hover>
                    <TableCell>
                      <PluginHeader plugin={plugin} />
                      {(plugin.manifest.configs?.length ?? 0) > 0 ? (
                        <Button
                          size="small"
                          variant="text"
                          disabled={rowBusy}
                          onClick={() => onSettings(plugin)}
                        >
                          Settings
                        </Button>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <ToolTip title={plugin.description || plugin.pluginId}>
                        <Typography
                          variant="body2"
                          color="textSecondary"
                          sx={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            maxWidth: 320,
                          }}
                        >
                          {plugin.description || "—"}
                        </Typography>
                      </ToolTip>
                      {plugin.init && !plugin.init.ok ? (
                        <ToolTip
                          title={`Setup commands failed — check ~/.open-bot/plugin-init/${plugin.pluginId}.log on the desktop.`}
                        >
                          <Chip
                            size="small"
                            color="warning"
                            label="setup failed"
                            sx={{ mt: 0.5 }}
                          />
                        </ToolTip>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip
                          size="small"
                          color={plugin.enabled ? "success" : undefined}
                          label={plugin.enabled ? "on" : "off"}
                        />
                        {rowBusy ? <CircularProgress size={1} /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <ToolTip title={plugin.enabled ? "Disable" : "Enable"}>
                        <Switch
                          checked={plugin.enabled}
                          disabled={rowBusy}
                          onChange={() => onToggle(plugin)}
                        />
                      </ToolTip>
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: "flex-end" }}
                      >
                        <ToolTip
                          title={
                            isDevVersion(plugin.version)
                              ? `Re-install v${plugin.version} — re-pull the release and re-run setup to pick up republished dev fixes`
                              : `Re-install v${plugin.version} — re-pull the release and re-run setup`
                          }
                        >
                          <IconButton
                            size="small"
                            aria-label={`Re-install ${plugin.name}`}
                            disabled={rowBusy}
                            onClick={() => onReinstall(plugin)}
                          >
                            <RefreshIcon />
                          </IconButton>
                        </ToolTip>
                        <ToolTip title={`Remove ${plugin.name}`}>
                          <IconButton
                            size="small"
                            aria-label={`Remove ${plugin.name}`}
                            disabled={rowBusy}
                            onClick={() => {
                              if (confirmId === plugin.pluginId) {
                                onRemove(plugin)
                                setConfirmId(null)
                                return
                              }
                              setConfirmId(plugin.pluginId)
                            }}
                          >
                            {confirmId === plugin.pluginId ? (
                              <Typography variant="caption">sure?</Typography>
                            ) : (
                              <DeleteIcon />
                            )}
                          </IconButton>
                        </ToolTip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {plugins.length > 0 ? (
        <TablePagination
          count={plugins.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(_event, next) => onPageChange(next)}
          onRowsPerPageChange={(next) => {
            onRowsPerPageChange(next)
            onPageChange(0)
          }}
        />
      ) : null}
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
        <Button
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={1} /> : undefined}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MarketTable({
  market,
  loading,
  installingId,
  installedIds,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onInstall,
  onDiscuss,
}: {
  market: MarketPlugin[]
  loading: boolean
  installingId: string | null
  installedIds: Set<string>
  page: number
  rowsPerPage: 10 | 25 | 50 | 100
  onPageChange: (next: number) => void
  onRowsPerPageChange: (next: 10 | 25 | 50 | 100) => void
  onInstall: (plugin: MarketPlugin) => void
  onDiscuss: (plugin: MarketPlugin) => void
}) {
  const visible = market.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <Paper variant="outlined">
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Plugin</TableCell>
              <TableCell>Author</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Downloads</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && market.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton height={32} />
                </TableCell>
              </TableRow>
            ) : market.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="textSecondary">
                    No plugins found. Agents publish plugins with{" "}
                    <code>ob-plugin publish</code>.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((plugin) => {
                const installed = installedIds.has(plugin.id)
                const pending = installingId === plugin.id
                return (
                  <TableRow key={plugin.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2">{plugin.name}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {plugin.id} · v{plugin.version}
                      </Typography>
                      <ToolTip title={plugin.description || plugin.id}>
                        <Typography
                          variant="body2"
                          color="textSecondary"
                          sx={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            maxWidth: 320,
                          }}
                        >
                          {plugin.description || "—"}
                        </Typography>
                      </ToolTip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {plugin.author || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {plugin.status !== "approved" ? (
                        <Chip
                          label={plugin.status}
                          size="small"
                          variant="outlined"
                        />
                      ) : (
                        <Chip
                          label="approved"
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">{plugin.downloads}</TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: "flex-end" }}
                      >
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => onDiscuss(plugin)}
                        >
                          Discuss
                        </Button>
                        <Button
                          size="small"
                          variant={installed ? "text" : "outlined"}
                          disabled={pending}
                          startIcon={
                            pending ? <CircularProgress size={1} /> : undefined
                          }
                          onClick={() => onInstall(plugin)}
                        >
                          {installed
                            ? "Re-install"
                            : pending
                              ? "Checking…"
                              : "Install"}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {market.length > 0 ? (
        <TablePagination
          count={market.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(_event, next) => onPageChange(next)}
          onRowsPerPageChange={(next) => {
            onRowsPerPageChange(next)
            onPageChange(0)
          }}
        />
      ) : null}
    </Paper>
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
          startIcon={busy ? <CircularProgress size={1} /> : undefined}
          onClick={() => void post()}
        >
          Post
        </Button>
      </Stack>
    </Stack>
  )
}

type MarketKeyInfo = {
  configured: boolean
  hint: string | null
  source: "account" | "instance"
}

function MarketplaceAccount({ isAdmin }: { isAdmin: boolean }) {
  const [info, setInfo] = useState<MarketKeyInfo | null>(null)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    try {
      setInfo(await api<MarketKeyInfo>("/api/plugins/marketplace/key"))
    } catch {
      setInfo(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await api("/api/plugins/marketplace/key", {
        method: "PUT",
        body: JSON.stringify({ key: value.trim() }),
      })
      setValue("")
      setNotice("marketplace API key saved")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await api("/api/plugins/marketplace/key", { method: "DELETE" })
      setNotice("marketplace API key removed")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to remove")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Marketplace account
          </Typography>
          {info?.configured ? (
            <Chip
              size="small"
              variant="outlined"
              label={
                info.source === "account"
                  ? `API key …${info.hint ?? ""}`
                  : "instance token"
              }
            />
          ) : (
            <Chip size="small" variant="outlined" label="not configured" />
          )}
        </Stack>
        <Typography variant="body2" color="textSecondary">
          Sign in at{" "}
          <a
            href="https://market.open-bot.app/account"
            target="_blank"
            rel="noreferrer"
          >
            market.open-bot.app
          </a>{" "}
          and create an API key under Account, then paste it here to publish
          plugins under your own marketplace account.
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success">{notice}</Alert> : null}
        {isAdmin ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="API key (obm_…)"
              type="password"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="contained"
              disabled={busy || !value.trim()}
              startIcon={busy ? <CircularProgress size={1} /> : undefined}
              onClick={() => void save()}
            >
              Save
            </Button>
            {info?.source === "account" ? (
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )
}

export function Plugins({ isAdmin }: { isAdmin: boolean }) {
  const mobile = useMobile()
  const { plugins, policy, configured, loaded, refresh } = useInstalledPlugins()
  const [market, setMarket] = useState<MarketPlugin[]>([])
  const [query, setQuery] = useState("")
  const [marketLoading, setMarketLoading] = useState(false)
  const [policyBusy, setPolicyBusy] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<{
    id: string
    name: string
    version: string
    permissions: string[]
    setupCommands: string[]
    versions: VersionOption[]
  } | null>(null)
  const [settingsFor, setSettingsFor] = useState<InstalledPluginInfo | null>(
    null,
  )
  const [detailId, setDetailId] = useState<string | null>(null)
  const [installedPage, setInstalledPage] = useState(0)
  const [installedRowsPerPage, setInstalledRowsPerPage] = useState<
    10 | 25 | 50 | 100
  >(10)
  const [marketPage, setMarketPage] = useState(0)
  const [marketRowsPerPage, setMarketRowsPerPage] = useState<
    10 | 25 | 50 | 100
  >(10)

  const loadMarket = useCallback(async (q: string) => {
    setMarketLoading(true)
    setError("")
    try {
      const suffix = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
      const body = await api<{ plugins?: MarketPlugin[] }>(
        `/api/plugins/market${suffix}`,
      )
      setMarket(body.plugins ?? [])
      setMarketPage(0)
    } catch (caught) {
      setMarket([])
      const message =
        caught instanceof Error ? caught.message : "marketplace unavailable"
      setError(message)
      setToast(message)
    } finally {
      setMarketLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMarket("")
  }, [loadMarket])

  const installedIds = useMemo(
    () => new Set(plugins.map((plugin) => plugin.pluginId)),
    [plugins],
  )

  async function act(
    id: string,
    action: () => Promise<unknown>,
    message: string,
  ) {
    setActionId(id)
    setError("")
    setNotice("")
    try {
      await action()
      setNotice(message)
      setToast(message)
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "action failed"
      setError(message)
      setToast(message)
    } finally {
      setActionId(null)
    }
  }

  async function togglePolicy() {
    setPolicyBusy(true)
    setError("")
    setNotice("")
    try {
      await api("/api/plugins/policy", {
        method: "PUT",
        body: JSON.stringify({
          policy: policy === "auto" ? "manual" : "auto",
        }),
      })
      setNotice("policy updated")
      setToast("policy updated")
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "action failed"
      setError(message)
      setToast(message)
    } finally {
      setPolicyBusy(false)
    }
  }

  async function startInstall(target: MarketPlugin) {
    setInstallingId(target.id)
    setError("")
    try {
      const probe = await api<{
        needsConfirm?: boolean
        permissions?: string[]
        setupCommands?: string[]
        version?: string
      }>("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId: target.id }),
      })
      if (probe.needsConfirm) {
        let versions: VersionOption[] = [
          { version: probe.version ?? target.version, stability: "stable" },
        ]
        try {
          const detail = await api<{ versions?: VersionOption[] }>(
            `/api/plugins/market/${encodeURIComponent(target.id)}`,
          )
          if (detail.versions && detail.versions.length > 0)
            versions = detail.versions
        } catch {
          versions = [
            {
              version: probe.version ?? target.version,
              stability: isDevVersion(probe.version ?? target.version)
                ? "dev"
                : "stable",
            },
          ]
        }
        setInstallTarget({
          id: target.id,
          name: target.name,
          version: probe.version ?? target.version,
          permissions: probe.permissions ?? [],
          setupCommands: probe.setupCommands ?? [],
          versions,
        })
        return
      }
      await refresh()
      const message = `${target.id} installed`
      setNotice(message)
      setToast(message)
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "install failed"
      setError(message)
      setToast(message)
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <Box
      className="ob-scroll"
      sx={{ p: 2, maxWidth: 960, mx: "auto", width: "100%" }}
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
              disabled={policyBusy}
              startIcon={policyBusy ? <CircularProgress size={1} /> : undefined}
              onClick={() => void togglePolicy()}
            >
              switch to {policy === "auto" ? "manual" : "auto"}
            </Button>
          ) : null}
        </Stack>
        {!configured ? (
          <Alert severity="info">
            The marketplace is not configured on this instance. Paste a
            marketplace API key below (admin), or set OPEN_BOT_MARKETPLACE_URL
            and OPEN_BOT_MARKETPLACE_TOKEN on the control plane.
          </Alert>
        ) : null}
        <MarketplaceAccount isAdmin={isAdmin} />
        {error ? (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert severity="success" onClose={() => setNotice("")}>
            {notice}
          </Alert>
        ) : null}

        <Typography variant="subtitle2">
          Installed ({plugins.length})
        </Typography>
        <InstalledTable
          plugins={plugins}
          loaded={loaded}
          actionId={actionId}
          page={installedPage}
          rowsPerPage={installedRowsPerPage}
          onPageChange={setInstalledPage}
          onRowsPerPageChange={setInstalledRowsPerPage}
          onToggle={(target) =>
            void act(
              target.pluginId,
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
              target.pluginId,
              () =>
                api(
                  `/api/plugins/installed/${encodeURIComponent(target.pluginId)}`,
                  { method: "DELETE" },
                ),
              `${target.pluginId} removed`,
            )
          }
          onSettings={setSettingsFor}
          onReinstall={(target) =>
            void act(
              target.pluginId,
              () =>
                api("/api/plugins/install", {
                  method: "POST",
                  body: JSON.stringify({
                    pluginId: target.pluginId,
                    version: target.version,
                    confirm: true,
                  }),
                }),
              `${target.pluginId} re-installed (v${target.version})`,
            )
          }
        />

        <Divider />
        <Typography variant="subtitle2">
          Marketplace ({market.length})
        </Typography>
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
            disabled={marketLoading}
            startIcon={
              marketLoading ? <CircularProgress size={1} /> : undefined
            }
            onClick={() => void loadMarket(query)}
          >
            {marketLoading ? "Searching…" : "Search"}
          </Button>
          <ToolTip title="Refresh">
            <IconButton
              aria-label="Refresh marketplace"
              disabled={marketLoading}
              onClick={() => void loadMarket(query)}
            >
              <RefreshIcon />
            </IconButton>
          </ToolTip>
        </Stack>
        {marketLoading ? <LinearProgress variant="indeterminate" /> : null}
        <MarketTable
          market={market}
          loading={marketLoading}
          installingId={installingId}
          installedIds={installedIds}
          page={marketPage}
          rowsPerPage={marketRowsPerPage}
          onPageChange={setMarketPage}
          onRowsPerPageChange={setMarketRowsPerPage}
          onInstall={(target) => void startInstall(target)}
          onDiscuss={(target) => setDetailId(target.id)}
        />
        {!marketLoading && market.length === 0 && configured ? (
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
            const message = `${installTarget.id} installed`
            setNotice(message)
            setToast(message)
          }}
        />
      ) : null}
      {settingsFor ? (
        <SettingsDialog
          plugin={settingsFor}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}
      <Snackbar
        open={toast != null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        position={mobile ? "bottom-center" : "bottom-left"}
        message={toast ?? ""}
      />
    </Box>
  )
}
