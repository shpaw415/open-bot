import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { TablePagination } from "@shpaw415/mui-lite/Pagination"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress, LinearProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Snackbar from "@shpaw415/mui-lite/Snackbar"
import Switch from "@shpaw415/mui-lite/Switch"
import Table, {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@shpaw415/mui-lite/Table"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import AccessibleDialog, { DialogActions } from "./AccessibleDialog"
import { ApiHttpError, api } from "./api"
import { Chip } from "./chip"
import { useDirtyFlag } from "./dirty-form"
import { useMobile } from "./hooks"
import { DeleteIcon, RefreshIcon } from "./icons"
import { type InstalledPluginInfo, PluginBadges, usePlugins } from "./plugin-ui"
import Stack from "./stack"
import { Tip } from "./Tip"

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
  // Paid premium listing: USD cents (absent/null = free).
  priceCents?: number | null
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
  plugin: {
    name: string
    pluginId: string
    version: string
    source?: "marketplace" | "local"
  }
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="subtitle2">{plugin.name}</Typography>
      {plugin.source === "local" ? (
        <Typography variant="caption" color="textSecondary">
          (local)
        </Typography>
      ) : null}
      <Typography variant="caption" color="textSecondary">
        {plugin.pluginId} · v{plugin.version}
      </Typography>
      {isDevVersion(plugin.version) ? (
        <Tip title="Development build — reinstall the same version to pick up republished fixes">
          <Chip size="small" color="warning" variant="outlined">
            dev
          </Chip>
        </Tip>
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
    // Paid premium listing: USD cents (absent/null = free).
    priceCents?: number | null
    // Marketplace page to buy at, set when an install already came back 402.
    purchaseUrl?: string | null
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
  // Paid listings: null = checking, true = the user must buy first.
  const [needsPurchase, setNeedsPurchase] = useState<boolean | null>(
    (target.priceCents ?? 0) > 0 ? (target.purchaseUrl ? true : null) : false,
  )
  const [checkoutUrl, setCheckoutUrl] = useState(target.purchaseUrl ?? "")
  const dev = isDevVersion(version)

  // Paid listings: check the requesting user's marketplace license so the
  // dialog can offer the purchase flow before hitting the install gate.
  useEffect(() => {
    if ((target.priceCents ?? 0) <= 0) return
    let alive = true
    api<{
      paid?: boolean
      licensed?: boolean
      priceCents?: number | null
      checkoutUrl?: string
      hasMarketplaceKey?: boolean
      error?: string
    }>(`/api/plugins/market/${encodeURIComponent(target.id)}/license`)
      .then((license) => {
        if (!alive) return
        setCheckoutUrl(license.checkoutUrl ?? target.purchaseUrl ?? "")
        setNeedsPurchase(!license.licensed)
      })
      .catch(() => {
        // License check failure: let the install attempt surface the real
        // error instead of blocking here.
        if (alive) setNeedsPurchase(false)
      })
    return () => {
      alive = false
    }
  }, [target.id, target.priceCents, target.purchaseUrl])

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
      if (
        caught instanceof ApiHttpError &&
        caught.status === 402 &&
        caught.body.needsPurchase
      ) {
        setNeedsPurchase(true)
        setCheckoutUrl(String(caught.body.checkoutUrl ?? checkoutUrl))
      } else {
        setError(caught instanceof Error ? caught.message : "install failed")
      }
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
    <AccessibleDialog open onClose={() => !busy && onClose()} fullWidth>
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
        {needsPurchase ? (
          <Alert severity="warning">
            <Stack spacing={1}>
              <Typography variant="body2">
                {target.name} is a premium plugin — $
                {((target.priceCents ?? 0) / 100).toFixed(2)} one-time on the
                marketplace (lifetime license, updates included). Buy it with
                your marketplace account, then install here.
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  variant="contained"
                  onClick={() =>
                    checkoutUrl
                      ? window.open(checkoutUrl, "_blank", "noopener")
                      : undefined
                  }
                  disabled={!checkoutUrl}
                >
                  Buy on the marketplace
                </Button>
                <Typography variant="caption" color="textSecondary">
                  Paid installs use your personal marketplace key — set it below
                  the policy row if installs still fail after buying.
                </Typography>
              </Stack>
            </Stack>
          </Alert>
        ) : null}
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
          Close
        </Button>
        <Button
          variant="contained"
          disabled={busy || needsPurchase === true}
          startIcon={busy ? <CircularProgress size={1} /> : undefined}
          onClick={() => void install()}
        >
          {needsPurchase === null
            ? "Checking license…"
            : busy
              ? "Installing…"
              : (target.priceCents ?? 0) > 0 && needsPurchase === false
                ? "Install (licensed)"
                : "Install"}
        </Button>
      </DialogActions>
    </AccessibleDialog>
  )
}

function InstalledTable({
  plugins,
  totalCount,
  loaded,
  error,
  onRetry,
  actionId,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onToggle,
  onRemove,
  onSettings,
  onReinstall,
  onRetrySetup,
  onUpdate,
}: {
  plugins: InstalledPluginInfo[]
  totalCount: number
  loaded: boolean
  error: string
  onRetry: () => void
  actionId: string | null
  page: number
  rowsPerPage: 10 | 25 | 50 | 100
  onPageChange: (next: number) => void
  onRowsPerPageChange: (next: 10 | 25 | 50 | 100) => void
  onToggle: (plugin: InstalledPluginInfo) => void
  onRemove: (plugin: InstalledPluginInfo) => void
  onSettings: (plugin: InstalledPluginInfo) => void
  onReinstall: (plugin: InstalledPluginInfo) => void
  onRetrySetup: (plugin: InstalledPluginInfo) => void
  onUpdate: (plugin: InstalledPluginInfo) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const visible = plugins.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <Paper variant="outlined">
      {error ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5 }}>
          <Typography variant="body2" color="error" sx={{ flex: 1 }}>
            {error}
          </Typography>
          <Button size="small" variant="outlined" onClick={onRetry}>
            Retry
          </Button>
        </Stack>
      ) : null}
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
                    {error
                      ? "The install list could not be loaded."
                      : totalCount > 0
                        ? "No installed plugins match the filters."
                        : "Nothing installed yet. Ask the agent to build a plugin, or install one from the marketplace below."}
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
                      {(plugin.manifest.configs?.length ?? 0) > 0 ||
                      (plugin.manifest.permissions?.vaultCreate?.length ?? 0) >
                        0 ||
                      (plugin.manifest.permissions?.vaultRead?.length ?? 0) >
                        0 ? (
                        <Button
                          size="small"
                          variant="text"
                          disabled={rowBusy}
                          onClick={() => onSettings(plugin)}
                        >
                          Settings
                        </Button>
                      ) : null}
                      {plugin.updateAvailable ? (
                        <Tip
                          title={`New stable version available — updates to v${plugin.updateAvailable} (re-runs setup and re-applies every surface)`}
                        >
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={rowBusy}
                            onClick={() => onUpdate(plugin)}
                            sx={{ ml: 1 }}
                          >
                            update to v{plugin.updateAvailable}
                          </Button>
                        </Tip>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Tip title={plugin.description || plugin.pluginId}>
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
                      </Tip>
                      {plugin.mentionClashes?.length ? (
                        <Typography
                          variant="caption"
                          color="warning"
                          sx={{ display: "block", mt: 0.5 }}
                        >
                          {plugin.mentionClashes
                            .map(
                              (clash) =>
                                `@${clash.section} already claimed by ${clash.owner}`,
                            )
                            .join("; ")}
                        </Typography>
                      ) : null}
                      {plugin.init && !plugin.init.ok ? (
                        <Tip
                          title={`Setup commands failed at install or boot — click to re-run them (log: ~/.open-bot/plugin-init/${plugin.pluginId}.log)`}
                        >
                          <Button
                            size="small"
                            color="warning"
                            variant="text"
                            disabled={rowBusy}
                            onClick={() => onRetrySetup(plugin)}
                            sx={{ mt: 0.5, px: 0.5 }}
                          >
                            setup failed — retry
                          </Button>
                        </Tip>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        {/* Activation and health are separate facts: an
                            enabled plugin can still have failed its setup, so
                            "on" must never read as "everything is fine". */}
                        <Chip
                          size="small"
                          color={
                            plugin.enabled
                              ? plugin.init && !plugin.init.ok
                                ? "warning"
                                : "success"
                              : undefined
                          }
                          label={plugin.enabled ? "on" : "off"}
                        />
                        {plugin.init && !plugin.init.ok ? (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label="setup failed"
                          />
                        ) : null}
                        {rowBusy ? <CircularProgress size={1} /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Tip title={plugin.enabled ? "Disable" : "Enable"}>
                        <Switch
                          checked={plugin.enabled}
                          disabled={rowBusy}
                          aria-label={
                            plugin.enabled
                              ? `Disable ${plugin.name}`
                              : `Enable ${plugin.name}`
                          }
                          onChange={() => onToggle(plugin)}
                        />
                      </Tip>
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: "flex-end" }}
                      >
                        <Tip
                          title={
                            plugin.source === "local"
                              ? `Re-install from ${plugin.localPath ?? "the local path"} — re-read the directory and re-run setup`
                              : isDevVersion(plugin.version)
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
                        </Tip>
                        <Tip title={`Remove ${plugin.name}`}>
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
                        </Tip>
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

type VaultKeyStatus = {
  slug: string
  hasKey: boolean
  access: "create" | "read"
  shared: boolean
  accountId: string
  baseUrl: string
}

function VaultKeyRow({
  status,
  pluginId,
  onSaved,
}: {
  status: VaultKeyStatus
  pluginId: string
  onSaved: () => void
}) {
  const [apiKey, setApiKey] = useState("")
  const [accountId, setAccountId] = useState(status.accountId)
  const [baseUrl, setBaseUrl] = useState(status.baseUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function save(fields: Record<string, string>) {
    setBusy(true)
    setError("")
    try {
      await api(
        `/api/plugins/installed/${encodeURIComponent(pluginId)}/vault`,
        {
          method: "POST",
          body: JSON.stringify({ slug: status.slug, value: fields }),
        },
      )
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not save")
    } finally {
      setBusy(false)
    }
  }

  const dirty =
    apiKey !== "" ||
    accountId !== status.accountId ||
    baseUrl !== status.baseUrl

  if (status.shared) {
    return (
      <Stack spacing={0.5}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap", rowGap: 0.5 }}
        >
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {status.slug}
          </Typography>
          <Chip size="small" variant="outlined">
            shared provider key
          </Chip>
          <Chip
            size="small"
            variant="outlined"
            color={status.hasKey ? "success" : undefined}
            label={status.hasKey ? "set" : "not set"}
          />
        </Stack>
        <Typography variant="caption" color="textSecondary">
          Managed on the Config page Keys tab — set it there once and every
          plugin that reads it picks it up.
        </Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
      >
        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
          {status.slug}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={status.access === "create" ? "plugin key" : "reads your key"}
        />
        <Chip
          size="small"
          variant="outlined"
          color={status.hasKey ? "success" : undefined}
          label={status.hasKey ? "set" : "not set"}
        />
      </Stack>
      <TextField
        label="API key"
        type="password"
        value={apiKey}
        disabled={busy}
        onChange={(event) => setApiKey(event.currentTarget.value)}
      />
      <Stack direction="row" spacing={1}>
        <TextField
          label="Account ID (optional)"
          value={accountId}
          disabled={busy}
          onChange={(event) => setAccountId(event.currentTarget.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Base URL (optional)"
          value={baseUrl}
          disabled={busy}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
          sx={{ flex: 1 }}
        />
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="contained"
          disabled={busy || !dirty}
          startIcon={busy ? <CircularProgress size={1} /> : undefined}
          onClick={() =>
            void save({
              // Leave the key out when blank so the stored one survives a
              // metadata-only edit; the route keeps omitted fields.
              ...(apiKey !== "" ? { apiKey } : {}),
              accountId,
              baseUrl,
            })
          }
        >
          Save
        </Button>
        {status.hasKey || dirty ? (
          <Button
            size="small"
            variant="text"
            disabled={busy}
            onClick={() =>
              void save({ apiKey: "", accountId: "", baseUrl: "" })
            }
          >
            Clear
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

function WebhookSection({ pluginId }: { pluginId: string }) {
  const [path, setPath] = useState<string | null>(null)
  const [secured, setSecured] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    api<{ enabled: boolean; secured?: boolean; path?: string }>(
      `/api/plugins/installed/${encodeURIComponent(pluginId)}/webhook`,
    )
      .then((body) => {
        setPath(body.enabled ? (body.path ?? null) : null)
        setSecured(Boolean(body.secured))
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
        setError("could not load the webhook state")
      })
  }, [pluginId])

  async function saveSecret(next: string) {
    setBusy(true)
    setError("")
    try {
      const body = await api<{ secured: boolean }>(
        `/api/plugins/installed/${encodeURIComponent(pluginId)}/webhook`,
        { method: "POST", body: JSON.stringify({ secret: next }) },
      )
      setSecured(body.secured)
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

  if (!loaded || !path) return null
  const url = `${window.location.origin}${path}`
  return (
    <>
      <Divider />
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2">Public endpoint</Typography>
        <Chip
          label={secured ? "secret-protected" : "public"}
          size="small"
          color={secured ? "success" : undefined}
        />
      </Stack>
      <Typography variant="caption" color="textSecondary">
        Your plugin's server, reachable like a normal website — pages, APIs,
        streams, and WebSockets. Requests wake the desktop if asleep. Append
        ?ob_async=1 to answer 202 immediately, or send the secret as the
        X-Open-Bot-Webhook-Secret header on /hooks/&lt;user-id&gt;/{pluginId}/…
        instead.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          onChange={() => {}}
          sx={{ flexGrow: 1 }}
        />
        <Button
          disabled={busy}
          onClick={() => void navigator.clipboard.writeText(url)}
        >
          Copy
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          label="Optional secret"
          value={secret}
          disabled={busy}
          type="password"
          onChange={(event) => setSecret(event.currentTarget.value)}
          sx={{ flexGrow: 1 }}
        />
        <Button disabled={busy} onClick={generateSecret}>
          Generate
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void saveSecret(secret)}
        >
          {secured ? "Replace" : "Set"}
        </Button>
        {secured ? (
          <Button
            disabled={busy}
            color="error"
            onClick={() => void saveSecret("")}
          >
            Remove
          </Button>
        ) : null}
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
    </>
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
      out[config.key] = plugin.settings?.[config.key] ?? config.def
    return out
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const vaultSlugs = [
    ...new Set([
      ...(plugin.manifest.permissions?.vaultCreate ?? []),
      ...(plugin.manifest.permissions?.vaultRead ?? []),
    ]),
  ]
  // null until the first status load resolves; rows then fall back to a
  // manifest-derived view if the load fails, so keys stay editable.
  const [vault, setVault] = useState<VaultKeyStatus[] | null>(null)
  const [vaultReload, setVaultReload] = useState(0)

  const loadVault = useCallback(() => {
    api<{ slugs: VaultKeyStatus[] }>(
      `/api/plugins/installed/${encodeURIComponent(plugin.pluginId)}/vault`,
    )
      .then((body) => setVault(body.slugs ?? []))
      .catch(() => setVault(null))
  }, [plugin.pluginId])

  useEffect(() => {
    if (vaultSlugs.length > 0) loadVault()
  }, [loadVault, vaultSlugs.length])

  const vaultRows: VaultKeyStatus[] =
    vault ??
    vaultSlugs.map((slug) => ({
      slug,
      hasKey: false,
      access: (plugin.manifest.permissions?.vaultCreate ?? []).includes(slug)
        ? "create"
        : "read",
      shared: false,
      accountId: "",
      baseUrl: "",
    }))

  async function save() {
    setBusy(true)
    setError("")
    try {
      await api(
        `/api/plugins/installed/${encodeURIComponent(plugin.pluginId)}/settings`,
        {
          method: "PUT",
          body: JSON.stringify({ settings: values }),
        },
      )
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccessibleDialog open onClose={() => !busy && onClose()} fullWidth>
      <Stack spacing={2} sx={{ p: 3 }}>
        <Typography variant="h6">
          {plugin.name} {vaultSlugs.length > 0 ? "settings & keys" : "settings"}
        </Typography>
        {(plugin.manifest.configs ?? []).map((config) => {
          const type = config.type ?? (config.secret ? "secret" : "string")
          if (type === "bool") {
            return (
              <Stack
                key={config.key}
                direction="row"
                spacing={1}
                alignItems="center"
                justifyContent="space-between"
              >
                <Typography variant="body2">{config.label}</Typography>
                <Switch
                  checked={values[config.key] === "true"}
                  disabled={busy}
                  aria-label={config.label}
                  onChange={() =>
                    setValues({
                      ...values,
                      [config.key]:
                        values[config.key] === "true" ? "false" : "true",
                    })
                  }
                />
              </Stack>
            )
          }
          if (type === "enum" && (config.options?.length ?? 0) > 0) {
            return (
              <Select
                key={config.key}
                name={config.key}
                label={config.label}
                value={values[config.key] ?? ""}
                disabled={busy}
                onSelect={(next) =>
                  setValues({ ...values, [config.key]: next })
                }
              >
                {(config.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )
          }
          return (
            <TextField
              key={config.key}
              label={config.label}
              value={values[config.key] ?? ""}
              disabled={busy}
              type={
                type === "secret"
                  ? "password"
                  : type === "number"
                    ? "number"
                    : "text"
              }
              onChange={(event) =>
                setValues({
                  ...values,
                  [config.key]: event.currentTarget.value,
                })
              }
            />
          )
        })}
        {plugin.manifest.dashboard?.pages?.public ? (
          <WebhookSection pluginId={plugin.pluginId} />
        ) : null}
        {vaultSlugs.length > 0 ? (
          <>
            <Divider />
            <Typography variant="subtitle2">Vault keys</Typography>
            <Typography variant="caption" color="textSecondary">
              Secrets this plugin uses. Values are write-only — never shown
              again after saving.
            </Typography>
            {vaultRows.map((status) => (
              <VaultKeyRow
                // The reload counter remounts saved rows so their inputs reset.
                key={`${status.slug}-${vaultReload}`}
                status={status}
                pluginId={plugin.pluginId}
                onSaved={() => {
                  setVaultReload((n) => n + 1)
                  loadVault()
                }}
              />
            ))}
          </>
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
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </AccessibleDialog>
  )
}

function MarketTable({
  market,
  totalCount,
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
  totalCount: number
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
                    {totalCount > 0
                      ? "No plugins match the filters."
                      : "No plugins found. Agents publish plugins with ob-plugin publish."}
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
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ flexWrap: "wrap" }}
                      >
                        <Typography variant="subtitle2">
                          {plugin.name}
                        </Typography>
                        {(plugin.priceCents ?? 0) > 0 ? (
                          <Chip
                            label={`$${((plugin.priceCents ?? 0) / 100).toFixed(2)}`}
                            size="small"
                            color="warning"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            label="free"
                            size="small"
                            variant="outlined"
                            sx={{ color: "text.secondary" }}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="textSecondary">
                        {plugin.id} · v{plugin.version}
                      </Typography>
                      <Tip title={plugin.description || plugin.id}>
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
                      </Tip>
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

type UserKeyInfo = { set: boolean; hint: string | null }

function MarketplaceAccount({ isAdmin }: { isAdmin: boolean }) {
  const [info, setInfo] = useState<MarketKeyInfo | null>(null)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [userKey, setUserKey] = useState<UserKeyInfo | null>(null)
  const [userValue, setUserValue] = useState("")
  const [userBusy, setUserBusy] = useState(false)
  const [userError, setUserError] = useState("")

  const load = useCallback(async () => {
    try {
      setInfo(await api<MarketKeyInfo>("/api/plugins/marketplace/key"))
    } catch {
      setInfo(null)
    }
    try {
      setUserKey(await api<UserKeyInfo>("/api/plugins/marketplace/user-key"))
    } catch {
      setUserKey(null)
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

  async function saveUserKey() {
    setUserBusy(true)
    setUserError("")
    setNotice("")
    try {
      await api("/api/plugins/marketplace/user-key", {
        method: "PUT",
        body: JSON.stringify({ key: userValue.trim() }),
      })
      setUserValue("")
      setNotice("your marketplace key is saved — paid installs will use it")
      await load()
    } catch (caught) {
      setUserError(caught instanceof Error ? caught.message : "failed to save")
    } finally {
      setUserBusy(false)
    }
  }

  async function removeUserKey() {
    setUserBusy(true)
    setUserError("")
    try {
      await api("/api/plugins/marketplace/user-key", { method: "DELETE" })
      setNotice("your marketplace key was removed")
      await load()
    } catch (caught) {
      setUserError(
        caught instanceof Error ? caught.message : "failed to remove",
      )
    } finally {
      setUserBusy(false)
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
            <Chip size="small" variant="outlined">
              not configured
            </Chip>
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
          and create an API key under Account. Paste it below as{" "}
          <strong>your</strong> key — paid plugin installs ride your license,
          and agent publishes attribute to your account.
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success">{notice}</Alert> : null}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap" }}
        >
          <Chip
            size="small"
            variant="outlined"
            label={
              userKey?.set
                ? `your key …${userKey.hint ?? ""}`
                : "no personal key"
            }
            color={userKey?.set ? "success" : "secondary"}
          />
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            Required for premium plugin installs.
          </Typography>
        </Stack>
        {userError ? <Alert severity="error">{userError}</Alert> : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            label="Your marketplace key (obm_…)"
            type="password"
            value={userValue}
            onChange={(event) => setUserValue(event.currentTarget.value)}
            sx={{ flex: 1 }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={userBusy || !userValue.trim()}
            startIcon={userBusy ? <CircularProgress size={1} /> : undefined}
            onClick={() => void saveUserKey()}
          >
            Save
          </Button>
          {userKey?.set ? (
            <Button
              size="small"
              variant="text"
              disabled={userBusy}
              onClick={() => void removeUserKey()}
            >
              Remove
            </Button>
          ) : null}
        </Stack>
        {isAdmin ? (
          <>
            <Divider />
            <Typography variant="caption" color="textSecondary">
              Instance fallback key (admin) — used for free-plugin installs when
              a user has no personal key.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label="Instance API key (obm_…)"
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
          </>
        ) : null}
      </Stack>
    </Paper>
  )
}

export function Plugins({ isAdmin }: { isAdmin: boolean }) {
  const mobile = useMobile()
  const {
    plugins,
    policy,
    autoUpdate,
    publicOrigin,
    configured,
    status: pluginsStatus,
    error: pluginsError,
    refresh,
  } = usePlugins()
  const [market, setMarket] = useState<MarketPlugin[]>([])
  const [query, setQuery] = useState("")
  const [marketLoading, setMarketLoading] = useState(false)
  const [policyBusy, setPolicyBusy] = useState(false)
  const [originDraft, setOriginDraft] = useState("")
  // Dirty = the draft differs from the saved origin. Same compare-with-saved
  // rule as the other settings; the shell registry covers internal nav and
  // tab close through useDirtyFlag.
  const originDirty = originDraft.trim() !== publicOrigin.trim()
  useDirtyFlag(originDirty)
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
    priceCents?: number | null
    purchaseUrl?: string | null
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
  const [installedQuery, setInstalledQuery] = useState("")
  const [enabledFilter, setEnabledFilter] = useState<"all" | "on" | "off">(
    "all",
  )
  const [sourceFilter, setSourceFilter] = useState<
    "" | "marketplace" | "local"
  >("")
  const [marketInstalled, setMarketInstalled] = useState<
    "all" | "installed" | "missing"
  >("all")
  const [category, setCategory] = useState("")
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    setOriginDraft(publicOrigin)
  }, [publicOrigin])

  const loadMarket = useCallback(async (q: string, cat = "") => {
    setMarketLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set("q", q.trim())
      if (cat) params.set("category", cat)
      const suffix = params.toString()
      const body = await api<{ plugins?: MarketPlugin[] }>(
        `/api/plugins/market${suffix ? `?${suffix}` : ""}`,
      )
      const list = body.plugins ?? []
      setMarket(list)
      setMarketPage(0)
      if (!q.trim() && !cat) {
        setCategories((prev) => {
          const seen = new Set(prev)
          for (const plugin of list)
            if (plugin.category) seen.add(plugin.category)
          return [...seen].sort((a, b) => a.localeCompare(b))
        })
      }
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

  // Load the marketplace only once the install list confirmed the instance
  // is configured — an unconfigured host would otherwise surface a raw
  // error banner on every visit to this page.
  useEffect(() => {
    if (!configured) return
    void loadMarket("")
  }, [loadMarket, configured])

  const installedIds = useMemo(
    () => new Set(plugins.map((plugin) => plugin.pluginId)),
    [plugins],
  )

  const filteredInstalled = useMemo(() => {
    const needle = installedQuery.trim().toLowerCase()
    if (!needle && enabledFilter === "all" && !sourceFilter) return plugins
    return plugins.filter((plugin) => {
      if (enabledFilter === "on" && !plugin.enabled) return false
      if (enabledFilter === "off" && plugin.enabled) return false
      if (sourceFilter === "marketplace" && plugin.source === "local")
        return false
      if (sourceFilter === "local" && plugin.source !== "local") return false
      if (
        needle &&
        !`${plugin.name} ${plugin.pluginId} ${plugin.description}`
          .toLowerCase()
          .includes(needle)
      )
        return false
      return true
    })
  }, [plugins, installedQuery, enabledFilter, sourceFilter])

  const shownMarket = useMemo(
    () =>
      marketInstalled === "all"
        ? market
        : market.filter((plugin) =>
            marketInstalled === "installed"
              ? installedIds.has(plugin.id)
              : !installedIds.has(plugin.id),
          ),
    [market, marketInstalled, installedIds],
  )

  const installedActive =
    installedQuery.trim() !== "" ||
    enabledFilter !== "all" ||
    sourceFilter !== ""

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

  async function toggleAutoUpdate() {
    setPolicyBusy(true)
    setError("")
    setNotice("")
    try {
      await api("/api/plugins/policy", {
        method: "PUT",
        body: JSON.stringify({
          autoUpdate: autoUpdate === "stable" ? "off" : "stable",
        }),
      })
      const message = `auto-update ${autoUpdate === "stable" ? "off" : "on for stable versions"}`
      setNotice(message)
      setToast(message)
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "action failed"
      setError(message)
      setToast(message)
    } finally {
      setPolicyBusy(false)
    }
  }

  async function savePublicOrigin() {
    setPolicyBusy(true)
    setError("")
    setNotice("")
    try {
      await api("/api/plugins/policy", {
        method: "PUT",
        body: JSON.stringify({ publicOrigin: originDraft.trim() }),
      })
      setNotice(
        "public origin updated — ob-plugin endpoint <id> url now reports it",
      )
      setToast("public origin updated")
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
          priceCents: target.priceCents ?? null,
        })
        return
      }
      await refresh()
      const message = `${target.id} installed`
      setNotice(message)
      setToast(message)
    } catch (caught) {
      // Paid gate (auto-install policy skips the confirm probe): open the
      // dialog so the purchase flow renders instead of a bare error toast.
      if (
        caught instanceof ApiHttpError &&
        caught.status === 402 &&
        caught.body.needsPurchase
      ) {
        setInstallTarget({
          id: target.id,
          name: target.name,
          version: target.version,
          permissions: [],
          setupCommands: [],
          versions: [{ version: target.version, stability: "stable" }],
          priceCents:
            typeof caught.body.priceCents === "number"
              ? caught.body.priceCents
              : (target.priceCents ?? null),
          purchaseUrl: String(caught.body.checkoutUrl ?? ""),
        })
        return
      }
      const message =
        caught instanceof Error ? caught.message : "install failed"
      setError(message)
      setToast(message)
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      {/* Policy/marketplace rows reflect server state — hidden while the
          install list is still loading so defaults never read as facts. */}
      {pluginsStatus === "ready" ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" variant="outlined">{`policy: ${policy}`}</Chip>
          {isAdmin ? (
            <Tip title="Automatically install newer approved stable versions of installed plugins">
              <Chip
                label={`auto-update: ${autoUpdate}`}
                size="small"
                variant="outlined"
                color={autoUpdate === "stable" ? "primary" : undefined}
                onClick={() => void toggleAutoUpdate()}
              />
            </Tip>
          ) : null}
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
      ) : null}
      {pluginsStatus === "error" ? (
        <Alert
          severity="error"
          action={
            <Button size="small" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        >
          {pluginsError || "The installed plugin list did not load."}
        </Alert>
      ) : null}
      {pluginsStatus === "loading" ? (
        <Stack spacing={1} aria-busy="true">
          <Box className="ob-skeleton" sx={{ height: 40, width: 260 }} />
          <output className="ob-sr-status">Loading installed plugins</output>
        </Stack>
      ) : null}
      {isAdmin && pluginsStatus === "ready" ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap", rowGap: 1 }}
        >
          <TextField
            label="Public origin"
            placeholder="https://open-bot.example.com"
            value={originDraft}
            disabled={policyBusy}
            onChange={(event) => {
              setOriginDraft(event.currentTarget.value)
            }}
            sx={{ minWidth: 280, maxWidth: 420 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={policyBusy || !originDirty}
            onClick={() => void savePublicOrigin()}
          >
            save
          </Button>
          <Tip title="Shareable origin for plugin webhook URLs: ob-plugin endpoint <id> url prints it instead of the internal control URL. Empty falls back to OPEN_BOT_PUBLIC_URL on the control plane.">
            <Typography variant="caption" color="text-secondary">
              what ob-plugin endpoint url reports
            </Typography>
          </Tip>
        </Stack>
      ) : null}
      {!configured && pluginsStatus === "ready" ? (
        <Alert severity="info">
          The marketplace is not configured on this instance. Paste a
          marketplace API key below (admin), or set OPEN_BOT_MARKETPLACE_URL and
          OPEN_BOT_MARKETPLACE_TOKEN on the control plane.
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
        Installed (
        {installedActive
          ? `${filteredInstalled.length} of ${plugins.length}`
          : plugins.length}
        )
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", rowGap: 1 }}
      >
        <TextField
          label="Filter installed"
          value={installedQuery}
          onChange={(event) => {
            setInstalledQuery(event.currentTarget.value)
            setInstalledPage(0)
          }}
          sx={{ flex: 1, minWidth: 180 }}
        />
        {(["all", "on", "off"] as const).map((value) => (
          <Button
            key={value}
            size="small"
            variant={enabledFilter === value ? "contained" : "outlined"}
            onClick={() => {
              setEnabledFilter(value)
              setInstalledPage(0)
            }}
          >
            {value === "all" ? "All" : value === "on" ? "Enabled" : "Disabled"}
          </Button>
        ))}
        <Select
          name="source"
          label="Source"
          value={sourceFilter}
          sx={{ minWidth: 160 }}
          onSelect={(next) => {
            setSourceFilter(next as "" | "marketplace" | "local")
            setInstalledPage(0)
          }}
        >
          {[
            <option key="all" value="">
              All sources
            </option>,
            <option key="marketplace" value="marketplace">
              Marketplace
            </option>,
            <option key="local" value="local">
              Local
            </option>,
          ]}
        </Select>
      </Stack>
      <InstalledTable
        plugins={filteredInstalled}
        totalCount={plugins.length}
        loaded={pluginsStatus === "ready" || pluginsStatus === "error"}
        error={pluginsError}
        onRetry={() => void refresh()}
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
                body: JSON.stringify(
                  target.source === "local"
                    ? {
                        pluginId: target.pluginId,
                        local: true,
                        confirm: true,
                      }
                    : {
                        pluginId: target.pluginId,
                        version: target.version,
                        confirm: true,
                      },
                ),
              }),
            `${target.pluginId} re-installed (v${target.version})`,
          )
        }
        onRetrySetup={(target) =>
          void act(
            target.pluginId,
            () =>
              api(
                `/api/plugins/installed/${encodeURIComponent(target.pluginId)}/setup`,
                { method: "POST" },
              ),
            `${target.pluginId} setup re-run`,
          )
        }
        onUpdate={(target) =>
          void act(
            target.pluginId,
            () =>
              api("/api/plugins/install", {
                method: "POST",
                body: JSON.stringify({
                  pluginId: target.pluginId,
                  version: target.updateAvailable,
                  confirm: true,
                }),
              }),
            `${target.pluginId} updated to v${target.updateAvailable}`,
          )
        }
      />

      {/* Marketplace listing only exists on a configured instance; the
          account card and the info alert above explain how to set it up. */}
      {configured ? (
        <>
          <Divider />
          <Typography variant="subtitle2">
            Marketplace (
            {marketInstalled !== "all"
              ? `${shownMarket.length} of ${market.length}`
              : market.length}
            )
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexWrap: "wrap", rowGap: 1 }}
          >
            <TextField
              label="Search plugins"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadMarket(query, category)
              }}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <Select
              name="category"
              label="Category"
              value={category}
              sx={{ minWidth: 160 }}
              onSelect={(next) => {
                setCategory(next)
                void loadMarket(query, next)
              }}
            >
              {[
                <option key="all" value="">
                  All categories
                </option>,
                ...categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                )),
              ]}
            </Select>
            <Button
              variant="outlined"
              disabled={marketLoading}
              startIcon={
                marketLoading ? <CircularProgress size={1} /> : undefined
              }
              onClick={() => void loadMarket(query, category)}
            >
              {marketLoading ? "Searching…" : "Search"}
            </Button>
            <Tip title="Refresh">
              <IconButton
                aria-label="Refresh marketplace"
                disabled={marketLoading}
                onClick={() => void loadMarket(query, category)}
              >
                <RefreshIcon />
              </IconButton>
            </Tip>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {(["all", "missing", "installed"] as const).map((value) => (
              <Button
                key={value}
                size="small"
                variant={marketInstalled === value ? "contained" : "outlined"}
                onClick={() => {
                  setMarketInstalled(value)
                  setMarketPage(0)
                }}
              >
                {value === "all"
                  ? "All"
                  : value === "missing"
                    ? "Not installed"
                    : "Installed"}
              </Button>
            ))}
          </Stack>
          {marketLoading ? <LinearProgress variant="indeterminate" /> : null}
          <MarketTable
            market={shownMarket}
            totalCount={market.length}
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
          {!marketLoading && market.length === 0 ? (
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
        </>
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
    </Stack>
  )
}
