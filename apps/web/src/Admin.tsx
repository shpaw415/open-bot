import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import Divider from "@shpaw415/mui-lite/Divider"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Menu from "@shpaw415/mui-lite/Menu"
import { TablePagination } from "@shpaw415/mui-lite/Pagination"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
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
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  api,
  fetchTeamAdmin,
  fetchTeamQuotas,
  importTeamAdmin,
  saveTeamAdminConfig,
  saveTeamAdminKey,
  saveTeamUserQuota,
  type TeamAdminBody,
  type TeamCatalogField,
  type TeamConfigPatch,
  type TeamMode,
  type TeamQuotaUser,
} from "./api"
import { ChartView } from "./ChartView"
import { useMobile } from "./hooks"
import { Improvements } from "./Improvements"
import {
  BlockIcon,
  ContentCopyIcon,
  DeleteIcon,
  FactoryIcon,
  LockResetIcon,
  MoreVertIcon,
  PersonAddIcon,
  RefreshIcon,
} from "./icons"
import {
  formatTokenCount,
  isTeamSecretField,
  overlayDraft,
  overlayPatch,
  parseQuotaCapInput,
  TEAM_OVERLAY_SECTIONS,
  teamKeysPayload,
} from "./team"
import {
  type ChartTheme,
  fleetOption,
  kindAreaOption,
  kindBarOption,
  tokensFor,
  type UsageDay,
} from "./usage-charts"

type DesktopPhase = "starting" | "running" | "sleeping"
type AdminUser = {
  id: string
  email: string
  role: "admin" | "user"
  disabled: boolean
  createdAt: number
  mustChangePassword: boolean
  lastActiveAt: number | null
  desktop: DesktopPhase
}
type UsageBody = {
  days: number
  totals: { totalTokens: number; calls: number }
  daily: UsageDay[]
}
type Invite = {
  code: string
  email: string | null
  createdAt: number
  usedAt: number | null
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(0, Math.round(value / 1024))} KB`
}

type AdminSettings = {
  mediaSnapshotCapMb: number
  mediaSnapshotUsedBytes: number
  mediaVaultCapMb: number
  mediaVaultUsedBytes: number
  desktopDiskMaxGb: number
}

function MediaSettings() {
  const [capGb, setCapGb] = useState("")
  const [usedBytes, setUsedBytes] = useState(0)
  const [savedCapMb, setSavedCapMb] = useState<number | null>(null)
  const [vaultGb, setVaultGb] = useState("")
  const [vaultUsed, setVaultUsed] = useState(0)
  const [savedVaultMb, setSavedVaultMb] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")

  function applySettings(body: AdminSettings) {
    setUsedBytes(body.mediaSnapshotUsedBytes)
    setSavedCapMb(body.mediaSnapshotCapMb)
    setCapGb((body.mediaSnapshotCapMb / 1024).toString())
    setVaultUsed(body.mediaVaultUsedBytes ?? 0)
    setSavedVaultMb(body.mediaVaultCapMb ?? 3072)
    setVaultGb(((body.mediaVaultCapMb ?? 3072) / 1024).toString())
  }

  useEffect(() => {
    void (async () => {
      try {
        const body = await api<AdminSettings>("/api/admin/settings")
        setUsedBytes(body.mediaSnapshotUsedBytes)
        setSavedCapMb(body.mediaSnapshotCapMb)
        setCapGb((body.mediaSnapshotCapMb / 1024).toString())
        setVaultUsed(body.mediaVaultUsedBytes ?? 0)
        setSavedVaultMb(body.mediaVaultCapMb ?? 3072)
        setVaultGb(((body.mediaVaultCapMb ?? 3072) / 1024).toString())
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "failed to load")
      }
    })()
  }, [])

  async function save(which: "snapshot" | "vault") {
    setError("")
    setNotice("")
    const raw = which === "snapshot" ? capGb : vaultGb
    const gb = Number.parseFloat(raw)
    if (!Number.isFinite(gb) || gb < 0 || gb > 100) {
      setError("Enter a size between 0 and 100 GB")
      return
    }
    const capMb = Math.round(gb * 1024)
    setBusy(true)
    try {
      const body = await api<AdminSettings>("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          which === "snapshot"
            ? { mediaSnapshotCapMb: capMb }
            : { mediaVaultCapMb: capMb },
        ),
      })
      applySettings(body)
      setNotice(which === "snapshot" ? "Snapshot cap saved" : "Vault cap saved")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Chat media snapshots</Typography>
      <Typography variant="caption" color="textSecondary">
        Images, videos, and 3D models shown in chat are snapshotted per message
        so older replies keep the exact version that was generated. Snapshots
        live while their thread exists. 0 GB turns snapshots off and clears the
        store.
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
      >
        <TextField
          label="Max size (GB)"
          value={capGb}
          onChange={(event) => setCapGb(event.currentTarget.value)}
          sx={{ width: 140 }}
        />
        <Button
          variant="contained"
          disabled={busy || capGb === ""}
          onClick={() => void save("snapshot")}
        >
          Save
        </Button>
        <Chip size="small" sx={{ ml: "auto" }}>
          {formatBytes(usedBytes)} used
          {savedCapMb != null
            ? ` of ${formatBytes(savedCapMb * 1024 * 1024)}`
            : ""}
        </Chip>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Media vault
      </Typography>
      <Typography variant="caption" color="textSecondary">
        Albums the agent files, including pictures, 3D models, and other files.
        Copies stay when a thread is deleted. 0 GB turns the vault off and
        clears it. Oldest items go first when the cap is exceeded.
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
      >
        <TextField
          label="Vault max (GB)"
          value={vaultGb}
          onChange={(event) => setVaultGb(event.currentTarget.value)}
          sx={{ width: 140 }}
        />
        <Button
          variant="contained"
          disabled={busy || vaultGb === ""}
          onClick={() => void save("vault")}
        >
          Save
        </Button>
        <Chip size="small" sx={{ ml: "auto" }}>
          {formatBytes(vaultUsed)} used
          {savedVaultMb != null
            ? ` of ${formatBytes(savedVaultMb * 1024 * 1024)}`
            : ""}
        </Chip>
      </Stack>
      {notice ? (
        <Alert severity="success" sx={{ mt: 1 }} onClose={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}
    </Paper>
  )
}

function DiskSettings() {
  const [diskGb, setDiskGb] = useState("0")
  const [savedGb, setSavedGb] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        const body = await api<AdminSettings>("/api/admin/settings")
        setSavedGb(body.desktopDiskMaxGb ?? 0)
        setDiskGb((body.desktopDiskMaxGb ?? 0).toString())
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "failed to load")
      }
    })()
  }, [])

  async function save() {
    setError("")
    setNotice("")
    const gb = Number.parseFloat(diskGb)
    if (!Number.isFinite(gb) || gb < 0) {
      setError("Enter a size of 0 GB or more")
      return
    }
    setBusy(true)
    try {
      const body = await api<AdminSettings>("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desktopDiskMaxGb: Math.round(gb) }),
      })
      setSavedGb(body.desktopDiskMaxGb ?? 0)
      setDiskGb((body.desktopDiskMaxGb ?? 0).toString())
      setNotice("Disk max saved")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Desktop disk max</Typography>
      <Typography variant="caption" color="textSecondary">
        Cap shown to users on the Hardware view for their desktop disk. 0 GB
        uses the full size the disk reports. Nothing is deleted automatically
        when the cap is exceeded.
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
      >
        <TextField
          label="Disk max (GB)"
          value={diskGb}
          onChange={(event) => setDiskGb(event.currentTarget.value)}
          sx={{ width: 140 }}
        />
        <Button
          variant="contained"
          disabled={busy || diskGb === ""}
          onClick={() => void save()}
        >
          Save
        </Button>
        <Chip size="small" sx={{ ml: "auto" }}>
          {savedGb != null && savedGb > 0 ? `${savedGb} GB cap` : "full disk"}
        </Chip>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity="success" sx={{ mt: 1 }} onClose={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}
    </Paper>
  )
}

function modeLabel(mode: TeamMode) {
  return mode === "team" ? "Team" : "Personal"
}

function TeamSettings() {
  const [data, setData] = useState<TeamAdminBody | null>(null)
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [pendingMode, setPendingMode] = useState<TeamMode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})
  const [overlay, setOverlay] = useState<
    Record<string, Record<string, string>>
  >({})
  const [quotaUsers, setQuotaUsers] = useState<TeamQuotaUser[]>([])
  const [quotaRows, setQuotaRows] = useState<Record<string, string>>({})
  const [defaultCap, setDefaultCap] = useState("")
  const [behavior, setBehavior] = useState<"block" | "warn">("block")

  const load = useCallback(async () => {
    try {
      const [body, quotas] = await Promise.all([
        fetchTeamAdmin(),
        fetchTeamQuotas(),
      ])
      setData(body)
      setOverlay(overlayDraft(body.config.providers))
      setDefaultCap(
        body.config.quotaDefaultTokens === null
          ? ""
          : String(body.config.quotaDefaultTokens),
      )
      setBehavior(body.config.quotaBehavior)
      setQuotaUsers(quotas.users)
      setQuotaRows(
        Object.fromEntries(
          quotas.users.map((row) => [
            row.userId,
            row.weeklyTokens === null ? "" : String(row.weeklyTokens),
          ]),
        ),
      )
      setLoadError("")
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "failed to load")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveConfig(patch: TeamConfigPatch, message: string) {
    setError("")
    setNotice("")
    setBusy(true)
    try {
      const body = await saveTeamAdminConfig(patch)
      setData((prev) =>
        prev ? { ...prev, config: body.config, secrets: body.secrets } : prev,
      )
      setNotice(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function switchMode() {
    const mode = pendingMode
    setPendingMode(null)
    if (!mode) return
    await saveConfig(
      { mode },
      mode === "team"
        ? "Team mode is on. The shared key set and provider settings are now authoritative."
        : "Personal mode is on. Everyone is back on their own keys.",
    )
  }

  async function runImport() {
    setError("")
    setNotice("")
    setImportOpen(false)
    setBusy(true)
    try {
      const body = await importTeamAdmin()
      setData((prev) =>
        prev
          ? {
              ...prev,
              config: body.config,
              secrets: body.secrets,
              keys: body.keys,
            }
          : prev,
      )
      setOverlay(overlayDraft(body.config.providers))
      setNotice("Imported your keys and provider config as the shared set.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "import failed")
    } finally {
      setBusy(false)
    }
  }

  async function saveKey(slug: string, fields: TeamCatalogField[]) {
    setError("")
    setNotice("")
    setBusy(true)
    try {
      const body = await saveTeamAdminKey(
        teamKeysPayload(slug, fields, keyValues),
      )
      setData((prev) => (prev ? { ...prev, keys: body.keys } : prev))
      setKeyValues((prev) => {
        const next = { ...prev }
        for (const field of fields) delete next[`${slug}:${field.id}`]
        return next
      })
      setNotice(`Saved the shared ${slug} key.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function saveOverlay() {
    await saveConfig(
      { providers: overlayPatch(overlay) },
      "Shared provider settings saved.",
    )
  }

  async function saveQuotaDefault() {
    const parsed = parseQuotaCapInput(defaultCap)
    if (!parsed.ok) {
      setError("Enter a weekly token cap of 0 or more, or leave it empty.")
      return
    }
    await saveConfig(
      { quotaDefaultTokens: parsed.value, quotaBehavior: behavior },
      "Weekly quota default saved.",
    )
  }

  async function saveUserQuota(row: TeamQuotaUser) {
    const parsed = parseQuotaCapInput(quotaRows[row.userId] ?? "")
    if (!parsed.ok) {
      setError("Enter a weekly token cap of 0 or more, or leave it empty.")
      return
    }
    setError("")
    setNotice("")
    setBusy(true)
    try {
      await saveTeamUserQuota(row.userId, parsed.value)
      const quotas = await fetchTeamQuotas()
      setQuotaUsers(quotas.users)
      setQuotaRows((prev) => ({
        ...prev,
        [row.userId]: parsed.value === null ? "" : String(parsed.value),
      }))
      setNotice(`Weekly cap saved for ${row.email}.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  function keyValue(slug: string, field: string) {
    return keyValues[`${slug}:${field}`] ?? ""
  }

  function setKeyValue(slug: string, field: string, value: string) {
    setKeyValues((prev) => ({ ...prev, [`${slug}:${field}`]: value }))
  }

  function overlayValue(section: string, field: string) {
    return overlay[section]?.[field] ?? ""
  }

  function setOverlayValue(section: string, field: string, value: string) {
    setOverlay((prev) => ({
      ...prev,
      [section]: { ...(prev[section] ?? {}), [field]: value },
    }))
  }

  const config = data?.config ?? null
  const catalog = data?.catalog ?? []
  const keys = data?.keys ?? []
  const chatOptions = catalog.filter((entry) => entry.chatProvider)
  const chatProvider = overlayValue("chat", "provider")
  const chatChoices =
    chatProvider && !chatOptions.some((entry) => entry.id === chatProvider)
      ? [{ id: chatProvider, label: chatProvider }, ...chatOptions]
      : chatOptions

  return (
    <>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1">Application mode</Typography>
        <Typography variant="caption" color="textSecondary">
          Personal: every user runs on their own keys and provider setups. Team:
          the whole host runs on the shared key set and provider settings below;
          users' personal keys are ignored until you switch back.
        </Typography>
        {loadError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {loadError}
          </Alert>
        ) : null}
        {config ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
          >
            {(["personal", "team"] as const).map((mode) => (
              <Button
                key={mode}
                variant={config.mode === mode ? "contained" : "outlined"}
                disabled={busy}
                onClick={() => {
                  if (config.mode !== mode) setPendingMode(mode)
                }}
              >
                {modeLabel(mode)}
              </Button>
            ))}
            <Chip size="small" sx={{ ml: 1 }}>
              {modeLabel(config.mode)} mode
            </Chip>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => setImportOpen(true)}
            >
              Import my keys &amp; provider config
            </Button>
          </Stack>
        ) : (
          <Skeleton height={40} sx={{ mt: 1 }} />
        )}
        {config ? (
          <Stack sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.lockModelPicker}
                  disabled={busy}
                  onChange={(event) =>
                    void saveConfig(
                      { lockModelPicker: event.currentTarget.checked },
                      "Model picker lock saved.",
                    )
                  }
                />
              }
              label="Lock the model picker to the shared chat provider and model"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={config.lockWatchdog}
                  disabled={busy}
                  onChange={(event) =>
                    void saveConfig(
                      { lockWatchdog: event.currentTarget.checked },
                      "Watchdog lock saved.",
                    )
                  }
                />
              }
              label="Lock the watchdog toggles for every user"
            />
          </Stack>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert
            severity="success"
            sx={{ mt: 1 }}
            onClose={() => setNotice("")}
          >
            {notice}
          </Alert>
        ) : null}
      </Paper>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1">Shared keys</Typography>
        <Typography variant="caption" color="textSecondary">
          The key set every user runs on in team mode. Built-in providers only.
          Blank secret fields keep the saved key.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {catalog.length === 0 && !loadError ? (
            <Skeleton height={120} />
          ) : null}
          {catalog.map((entry, index) => {
            const state = keys.find((row) => row.slug === entry.id)
            return (
              <Box key={entry.id}>
                {index > 0 ? <Divider sx={{ mb: 1.5 }} /> : null}
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Typography variant="subtitle2">{entry.label}</Typography>
                    {state?.hasKey ? (
                      <Chip size="small" color="success">
                        Key saved
                      </Chip>
                    ) : (
                      <Chip size="small">Not set</Chip>
                    )}
                    {entry.usedBy.length > 0 ? (
                      <Chip size="small" variant="outlined">
                        used by {entry.usedBy.join(", ")}
                      </Chip>
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="textSecondary">
                    {entry.description}
                  </Typography>
                  {entry.fields.map((field) => (
                    <TextField
                      key={field.id}
                      label={
                        state?.hasKey && isTeamSecretField(field.id)
                          ? `${field.label} (blank keeps the saved key)`
                          : field.label
                      }
                      type={isTeamSecretField(field.id) ? "password" : "text"}
                      value={keyValue(entry.id, field.id)}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setKeyValue(
                          entry.id,
                          field.id,
                          event.currentTarget.value,
                        )
                      }
                    />
                  ))}
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      disabled={busy}
                      onClick={() => void saveKey(entry.id, entry.fields)}
                    >
                      Save
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )
          })}
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1">Shared provider settings</Typography>
        <Typography variant="caption" color="textSecondary">
          Applied to every user's desktop in team mode. Blank secret fields keep
          the saved value; clearing a field clears it for everyone.
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {TEAM_OVERLAY_SECTIONS.map((section) => {
            const markers = data?.secrets?.[section.section]
            const secretStored = (field: string) =>
              field === "gatewayToken"
                ? Boolean(markers?.hasGatewayToken)
                : Boolean(markers?.hasKey)
            return (
              <Box key={section.section}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <Typography variant="subtitle2">{section.title}</Typography>
                  {markers?.hasKey ? (
                    <Chip size="small" color="success">
                      Key stored
                    </Chip>
                  ) : null}
                  {markers?.hasGatewayToken ? (
                    <Chip size="small" color="success">
                      Token stored
                    </Chip>
                  ) : null}
                </Stack>
                <Typography variant="caption" color="textSecondary">
                  {section.description}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  sx={{ mt: 0.5, rowGap: 1 }}
                >
                  {section.section === "chat" ? (
                    <Select
                      name="team-chat-provider"
                      label="Provider"
                      value={chatProvider}
                      sx={{ width: 240 }}
                      onSelect={(value: string) =>
                        setOverlayValue("chat", "provider", value)
                      }
                    >
                      {[
                        <option key="none" value="">
                          Not set
                        </option>,
                        ...chatChoices.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        )),
                      ]}
                    </Select>
                  ) : null}
                  {section.fields
                    .filter(
                      (field) =>
                        !(
                          section.section === "chat" &&
                          field.field === "provider"
                        ),
                    )
                    .map((field) => (
                      <TextField
                        key={field.field}
                        label={field.label}
                        type={
                          isTeamSecretField(field.field) ? "password" : "text"
                        }
                        value={overlayValue(section.section, field.field)}
                        placeholder={
                          isTeamSecretField(field.field)
                            ? secretStored(field.field)
                              ? "(stored — leave blank to keep)"
                              : "(not set)"
                            : field.placeholder
                        }
                        sx={{ width: 240 }}
                        onChange={(event) =>
                          setOverlayValue(
                            section.section,
                            field.field,
                            event.currentTarget.value,
                          )
                        }
                      />
                    ))}
                </Stack>
              </Box>
            )
          })}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={busy || !config}
              onClick={() => void saveOverlay()}
            >
              Save shared provider settings
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1">Weekly quotas</Typography>
        <Typography variant="caption" color="textSecondary">
          Per-user token caps, counted from Monday 00:00 UTC. Block pauses
          sending at the cap; warn only shows a banner. A user cap of 0 removes
          their limit.
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
        >
          <TextField
            label="Default weekly cap (tokens)"
            value={defaultCap}
            placeholder="no cap"
            sx={{ width: 240 }}
            onChange={(event) => setDefaultCap(event.currentTarget.value)}
          />
          <Select
            name="team-quota-behavior"
            label="At the cap"
            value={behavior}
            sx={{ width: 160 }}
            onSelect={(value: string) => setBehavior(value as "block" | "warn")}
          >
            <option value="block">Block sending</option>
            <option value="warn">Warn only</option>
          </Select>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void saveQuotaDefault()}
          >
            Save default
          </Button>
        </Stack>
        <TableContainer sx={{ overflowX: "auto", mt: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell align="right">Used this week</TableCell>
                <TableCell>Weekly cap (tokens)</TableCell>
                <TableCell align="right">Effective limit</TableCell>
                <TableCell padding="none" />
              </TableRow>
            </TableHead>
            <TableBody>
              {quotaUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton height={32} />
                  </TableCell>
                </TableRow>
              ) : (
                quotaUsers.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>{row.email}</TableCell>
                    <TableCell align="right">
                      {formatTokenCount(row.used)}
                    </TableCell>
                    <TableCell>
                      <TextField
                        label="Cap"
                        value={quotaRows[row.userId] ?? ""}
                        placeholder="host default"
                        sx={{ width: 160 }}
                        onChange={(event) =>
                          setQuotaRows((prev) => ({
                            ...prev,
                            [row.userId]: event.currentTarget.value,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      {row.limitTokens === null
                        ? "no cap"
                        : formatTokenCount(row.limitTokens)}
                    </TableCell>
                    <TableCell padding="none">
                      <Button
                        size="small"
                        variant="text"
                        disabled={busy}
                        onClick={() => void saveUserQuota(row)}
                      >
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Dialog open={Boolean(pendingMode)} onClose={() => setPendingMode(null)}>
        <DialogTitle>
          Switch to {pendingMode ? modeLabel(pendingMode) : ""} mode?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {pendingMode === "team"
              ? "The shared key set and provider settings become authoritative for every user. Personal keys are ignored until you switch back to personal mode."
              : "Everyone goes back to their own keys and provider setups. The shared set is kept for the next switch to team mode."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPendingMode(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void switchMode()}
          >
            Switch to {pendingMode ? modeLabel(pendingMode) : ""}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={importOpen} onClose={() => setImportOpen(false)}>
        <DialogTitle>Import your keys as the shared set?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Copies your personal provider keys and provider setups (chat, image,
            video, 3D, System 1, voice, watchdog) into the shared team set. Your
            personal keys stay.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setImportOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void runImport()}
          >
            Import
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function formatAgo(ts: number | null) {
  if (!ts) return "—"
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function Admin({ meId }: { meId: string }) {
  const mobile = useMobile()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usage, setUsage] = useState<UsageBody | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [invite, setInvite] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [pendingReset, setPendingReset] = useState<AdminUser | null>(null)
  const [resetBackup, setResetBackup] = useState(true)
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [factoryConfirm, setFactoryConfirm] = useState("")
  const [factoryPassword, setFactoryPassword] = useState("")
  const [factoryBackup, setFactoryBackup] = useState(true)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const themeRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<ChartTheme>({
    text: "#1c1b1f",
    split: "rgba(127,127,127,0.28)",
  })

  const load = useCallback(async (nextDays: 7 | 30 | 90) => {
    setError("")
    setLoading(true)
    try {
      const [userBody, usageBody, inviteBody] = await Promise.all([
        api<{ users: AdminUser[] }>("/api/admin/users"),
        api<UsageBody>(`/api/admin/usage?days=${nextDays}`),
        api<{ invites: Invite[] }>("/api/admin/invites"),
      ])
      setUsers(userBody.users)
      setUsage(usageBody)
      setInvites(inviteBody.invites)
      setSelected((current) =>
        current && userBody.users.some((row) => row.id === current)
          ? current
          : (userBody.users[0]?.id ?? null),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  useEffect(() => {
    const el = themeRef.current
    if (!el) return
    const color = getComputedStyle(el).color
    if (color) setTheme({ text: color, split: "rgba(127,127,127,0.28)" })
  }, [])

  async function createInvite() {
    setError("")
    setBusy(true)
    try {
      const body = await api<{ code: string }>("/api/admin/invites", {
        method: "POST",
      })
      setInvite(body.code)
      await load(days)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invite failed")
    } finally {
      setBusy(false)
    }
  }

  async function act(path: string, init?: RequestInit) {
    setError("")
    setBusy(true)
    setMenuId(null)
    try {
      await api(path, init)
      if (path === `/api/admin/users/${meId}/reset-password`) {
        window.location.assign("/")
        return
      }
      if (
        path === `/api/admin/users/${meId}` &&
        init?.body === JSON.stringify({ role: "user" })
      ) {
        window.location.assign("/")
        return
      }
      await load(days)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setBusy(false)
    }
  }

  async function resetDesktop(user: AdminUser) {
    setError("")
    setBusy(true)
    setPendingReset(null)
    try {
      await api(`/api/admin/users/${user.id}/reset-desktop`, {
        method: "POST",
        body: JSON.stringify({ backup: resetBackup }),
      })
      setNotice(`Desktop reset started for ${user.email}.`)
      await load(days)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reset failed")
    } finally {
      setBusy(false)
    }
  }

  async function factoryReset() {
    setError("")
    setBusy(true)
    try {
      await api("/api/factory-reset", {
        method: "POST",
        body: JSON.stringify({
          confirm: factoryConfirm,
          password: factoryPassword,
          backup: factoryBackup,
        }),
      })
      setFactoryOpen(false)
      setNotice(
        "Factory reset running. All desktops are destroyed, data is wiped, and open-bot restarts with default credentials shortly.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "factory reset failed",
      )
    } finally {
      setBusy(false)
    }
  }

  const daily = usage?.daily ?? []
  const selectedUser = users.find((row) => row.id === selected) ?? null
  const running = users.filter((row) => row.desktop === "running").length
  const visible = users.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const menuUser = users.find((row) => row.id === menuId) ?? null
  const unused = invites.filter((row) => !row.usedAt)

  return (
    <Box ref={themeRef} className="ob-scroll">
      <Stack spacing={1.5} sx={{ p: mobile ? 1 : 2, width: "100%" }}>
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
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {([7, 30, 90] as const).map((value) => (
            <Button
              key={value}
              size="small"
              variant={days === value ? "contained" : "outlined"}
              onClick={() => {
                setDays(value)
                setPage(0)
              }}
            >
              {value}d
            </Button>
          ))}
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            startIcon={<PersonAddIcon />}
            disabled={busy}
            onClick={() => void createInvite()}
          >
            Create invite
          </Button>
        </Stack>
        {invite ? (
          <Alert
            severity="info"
            onClose={() => setInvite("")}
            action={
              <Button
                size="small"
                variant="text"
                startIcon={<ContentCopyIcon />}
                onClick={() => void navigator.clipboard?.writeText(invite)}
              >
                Copy
              </Button>
            }
          >
            Invite code: {invite}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Chip size="small">{users.length} users</Chip>
          <Chip size="small" color="success">
            {running} running
          </Chip>
          <Chip size="small">
            {formatTokens(usage?.totals.totalTokens ?? 0)} tokens
          </Chip>
          <Chip size="small">{usage?.totals.calls ?? 0} calls</Chip>
        </Stack>
        <MediaSettings />
        <DiskSettings />
        <TeamSettings />
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle1">Proxy tokens by user</Typography>
          <Typography variant="caption" color="textSecondary">
            OpenBot LLM proxy only. Provider logins inside a desktop are not
            included. History starts when this page ships.
          </Typography>
          {loading && !usage ? (
            <Skeleton height={260} />
          ) : (
            <ChartView option={fleetOption(daily, theme)} height={260} />
          )}
        </Paper>
        <Paper variant="outlined">
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Desktop</TableCell>
                  <TableCell>Last active</TableCell>
                  <TableCell align="right">Tokens</TableCell>
                  <TableCell align="right">Calls</TableCell>
                  <TableCell padding="none" />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Skeleton height={32} />
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row) => {
                    const stats = tokensFor(daily, row.id)
                    return (
                      <TableRow
                        key={row.id}
                        hover
                        selected={row.id === selected}
                        onClick={() => setSelected(row.id)}
                      >
                        <TableCell>{row.email}</TableCell>
                        <TableCell>{row.role}</TableCell>
                        <TableCell>
                          {row.disabled ? (
                            <Chip size="small">disabled</Chip>
                          ) : row.mustChangePassword ? (
                            <Chip size="small" color="warning">
                              reset
                            </Chip>
                          ) : (
                            <Chip size="small" color="success">
                              active
                            </Chip>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={
                              row.desktop === "running"
                                ? "success"
                                : row.desktop === "starting"
                                  ? "warning"
                                  : undefined
                            }
                          >
                            {row.desktop}
                          </Chip>
                        </TableCell>
                        <TableCell>{formatAgo(row.lastActiveAt)}</TableCell>
                        <TableCell align="right">
                          {formatTokens(stats.total)}
                        </TableCell>
                        <TableCell align="right">{stats.calls}</TableCell>
                        <TableCell padding="none">
                          <IconButton
                            size="small"
                            aria-label={`Actions for ${row.email}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              anchorRef.current = event.currentTarget
                              setMenuId(row.id)
                            }}
                          >
                            <MoreVertIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            count={users.length}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={(_event, next) => setPage(next)}
            onRowsPerPageChange={(next) => {
              setRowsPerPage(next)
              setPage(0)
            }}
          />
        </Paper>
        <Stack direction={mobile ? "column" : "row"} spacing={1.5}>
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1.4, minWidth: 0 }}>
            <Typography variant="subtitle1">
              {selectedUser ? selectedUser.email : "User"} by kind
            </Typography>
            {selected ? (
              <ChartView
                option={kindAreaOption(daily, selected, theme)}
                height={240}
              />
            ) : (
              <Typography variant="body2" color="textSecondary">
                Select a user.
              </Typography>
            )}
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1">Prompt vs completion</Typography>
            {selected ? (
              <ChartView
                option={kindBarOption(daily, selected, theme)}
                height={240}
              />
            ) : null}
          </Paper>
        </Stack>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Invites
          </Typography>
          {unused.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              No unused invites.
            </Typography>
          ) : (
            unused.map((row) => (
              <Stack
                key={row.code}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ py: 0.5 }}
              >
                <Typography className="ob-mono" sx={{ flex: 1 }}>
                  {row.code}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => void navigator.clipboard?.writeText(row.code)}
                >
                  Copy
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      `/api/admin/invites/${encodeURIComponent(row.code)}`,
                      {
                        method: "DELETE",
                      },
                    )
                  }
                >
                  Revoke
                </Button>
              </Stack>
            ))
          )}
        </Paper>
        <Improvements />
        <Paper variant="outlined" sx={{ p: 1.5, borderColor: "error.main" }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <FactoryIcon />
              <Typography variant="subtitle1" sx={{ flex: 1 }}>
                Danger zone
              </Typography>
            </Stack>
            <Typography variant="body2" color="textSecondary">
              Factory reset open-bot: destroys every desktop, wipes the control
              database, and restarts with default credentials (admin@localhost /
              changeme). Backups on the control volume are kept. This cannot be
              undone.
            </Typography>
            <Box>
              <Button
                variant="outlined"
                color="error"
                onClick={() => {
                  setFactoryConfirm("")
                  setFactoryPassword("")
                  setFactoryOpen(true)
                }}
              >
                Factory reset open-bot
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Stack>
      <Menu
        open={Boolean(menuUser)}
        anchorEl={anchorRef}
        onClose={() => setMenuId(null)}
      >
        {menuUser ? (
          <>
            <ListItemButton
              disabled={busy || menuUser.id === meId}
              onClick={() =>
                void act(
                  `/api/admin/users/${menuUser.id}/${menuUser.disabled ? "enable" : "disable"}`,
                  { method: "POST" },
                )
              }
            >
              <BlockIcon />
              <ListItemText
                primary={menuUser.disabled ? "Enable" : "Disable"}
              />
            </ListItemButton>
            <ListItemButton
              disabled={busy}
              onClick={() =>
                void act(`/api/admin/users/${menuUser.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    role: menuUser.role === "admin" ? "user" : "admin",
                  }),
                })
              }
            >
              <ListItemText
                primary={menuUser.role === "admin" ? "Make user" : "Make admin"}
              />
            </ListItemButton>
            <ListItemButton
              disabled={busy}
              onClick={() =>
                void act(`/api/admin/users/${menuUser.id}/reset-password`, {
                  method: "POST",
                })
              }
            >
              <LockResetIcon />
              <ListItemText
                primary="Force password reset"
                secondary="Signs them out. Current password still opens the change screen."
              />
            </ListItemButton>
            <ListItemButton
              disabled={busy}
              onClick={() => {
                setPendingReset(menuUser)
                setMenuId(null)
              }}
            >
              <RefreshIcon />
              <ListItemText
                primary="Reset desktop"
                secondary="Wipes the desktop's containers and volumes; a fresh desktop starts next time."
              />
            </ListItemButton>
            <ListItemButton
              disabled={busy || menuUser.id === meId}
              onClick={() => {
                setPendingDelete(menuUser)
                setMenuId(null)
              }}
            >
              <DeleteIcon />
              <ListItemText primary="Delete" />
            </ListItemButton>
          </>
        ) : null}
      </Menu>
      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      >
        <DialogTitle>Delete {pendingDelete?.email}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Stops the desktop and deletes its containers, volumes, sessions, and
            usage history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            startIcon={<DeleteIcon />}
            onClick={() => {
              const id = pendingDelete?.id
              setPendingDelete(null)
              if (id) void act(`/api/admin/users/${id}`, { method: "DELETE" })
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(pendingReset)}
        onClose={() => setPendingReset(null)}
      >
        <DialogTitle>Reset {pendingReset?.email}'s desktop?</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <Typography variant="body2">
              Destroys the desktop's containers and volumes: chat history,
              installed packages, browser logins, workspace files, and this
              desktop's memory. The account and its keys are kept; the next
              start is a fresh desktop.
            </Typography>
            <FormControlLabel
              control={
                <CheckBox
                  checked={resetBackup}
                  onChange={(event) =>
                    setResetBackup(event.currentTarget.checked)
                  }
                />
              }
              label="Back up the desktop first (recommended)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPendingReset(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              const user = pendingReset
              if (user) void resetDesktop(user)
            }}
          >
            Reset desktop
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={factoryOpen} onClose={() => !busy && setFactoryOpen(false)}>
        <DialogTitle>Factory reset open-bot?</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <Typography variant="body2">
              Every desktop is destroyed, all users and data are wiped, and the
              control plane restarts with default credentials. Type{" "}
              <strong>RESET</strong> and enter your password to confirm.
            </Typography>
            <TextField
              label='Type "RESET" to confirm'
              value={factoryConfirm}
              onChange={(event) => setFactoryConfirm(event.currentTarget.value)}
            />
            <TextField
              label="Your password"
              type="password"
              value={factoryPassword}
              onChange={(event) =>
                setFactoryPassword(event.currentTarget.value)
              }
            />
            <FormControlLabel
              control={
                <CheckBox
                  checked={factoryBackup}
                  onChange={(event) =>
                    setFactoryBackup(event.currentTarget.checked)
                  }
                />
              }
              label="Take a final full backup first (recommended)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            variant="text"
            disabled={busy}
            onClick={() => setFactoryOpen(false)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || factoryConfirm !== "RESET" || !factoryPassword}
            onClick={() => void factoryReset()}
          >
            Factory reset
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
