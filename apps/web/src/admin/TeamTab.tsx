import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Divider from "@shpaw415/mui-lite/Divider"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
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
import { useCallback, useEffect, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "../AccessibleDialog"
import {
  api,
  fetchTeamAdmin,
  fetchTeamQuotas,
  importTeamAdmin,
  saveTeamAdminConfig,
  saveTeamAdminKey,
  saveTeamUserQuota,
  syncTeamOpencodeAuth,
  type TeamAdminBody,
  type TeamCatalogField,
  type TeamConfigPatch,
  type TeamMode,
  type TeamQuotaUser,
} from "../api"
import { Chip } from "../chip"
import { FactoryIcon } from "../icons"
import Stack from "../stack"
import {
  formatTokenCount,
  isTeamSecretField,
  overlayDraft,
  overlayPatch,
  parseCpuCoresInput,
  parseMemoryInput,
  parseQuotaCapInput,
  TEAM_OVERLAY_SECTIONS,
  teamKeysPayload,
} from "../team"

function modeLabel(mode: TeamMode) {
  return mode === "team" ? "Team" : "Personal"
}

function formatGb(mb: number | null) {
  if (mb === null) return ""
  return String(Math.round((mb / 1024) * 10) / 10)
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
        Host-wide cap shown on the Hardware view when the user has no per-user
        disk cap in the limits table above. 0 GB uses the full size the disk
        reports. Nothing is deleted automatically when the cap is exceeded.
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

export function TeamTab({
  adminBusy,
  onFactoryReset,
}: {
  adminBusy: boolean
  onFactoryReset: (body: {
    confirm: string
    password: string
    backup: boolean
  }) => Promise<void>
}) {
  const [data, setData] = useState<TeamAdminBody | null>(null)
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [pendingMode, setPendingMode] = useState<TeamMode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [factoryConfirm, setFactoryConfirm] = useState("")
  const [factoryPassword, setFactoryPassword] = useState("")
  const [factoryBackup, setFactoryBackup] = useState(true)
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})
  const [overlay, setOverlay] = useState<
    Record<string, Record<string, string>>
  >({})
  const [quotaUsers, setQuotaUsers] = useState<TeamQuotaUser[]>([])
  const [quotaRows, setQuotaRows] = useState<Record<string, string>>({})
  const [memoryRows, setMemoryRows] = useState<Record<string, string>>({})
  const [diskRows, setDiskRows] = useState<Record<string, string>>({})
  const [cpuRows, setCpuRows] = useState<Record<string, string>>({})
  const [hostCores, setHostCores] = useState<number | null>(null)
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
      setHostCores(quotas.hostCores)
      setQuotaRows(
        Object.fromEntries(
          quotas.users.map((row) => [
            row.userId,
            row.weeklyTokens === null ? "" : String(row.weeklyTokens),
          ]),
        ),
      )
      setMemoryRows(
        Object.fromEntries(
          quotas.users.map((row) => [row.userId, formatGb(row.memoryMb)]),
        ),
      )
      setDiskRows(
        Object.fromEntries(
          quotas.users.map((row) => [
            row.userId,
            row.diskGb === null ? "" : String(row.diskGb),
          ]),
        ),
      )
      setCpuRows(
        Object.fromEntries(
          quotas.users.map((row) => [
            row.userId,
            row.cpuCores === null ? "" : String(row.cpuCores),
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
    const parsedQuota = parseQuotaCapInput(quotaRows[row.userId] ?? "")
    if (!parsedQuota.ok) {
      setError("Enter a weekly token cap of 0 or more, or leave it empty.")
      return
    }
    const parsedMemory = parseMemoryInput(memoryRows[row.userId] ?? "")
    if (!parsedMemory.ok) {
      setError(
        `Enter a RAM cap between 0.5 and 64 GB for ${row.email}, or leave it empty.`,
      )
      return
    }
    const parsedDisk = parseQuotaCapInput(diskRows[row.userId] ?? "")
    if (!parsedDisk.ok) {
      setError("Enter a disk cap of 0 GB or more, or leave it empty.")
      return
    }
    const parsedCpu = parseCpuCoresInput(cpuRows[row.userId] ?? "")
    if (!parsedCpu.ok) {
      setError(
        `Enter a CPU cap of 0.5 cores or more for ${row.email}, or leave it empty.`,
      )
      return
    }
    if (
      parsedCpu.value !== null &&
      hostCores !== null &&
      parsedCpu.value > hostCores
    ) {
      setError(
        `The host has ${hostCores} cores — enter a CPU cap up to ${hostCores}, or leave it empty.`,
      )
      return
    }
    setError("")
    setNotice("")
    setBusy(true)
    try {
      const body = await saveTeamUserQuota(row.userId, parsedQuota.value, {
        memoryMb: parsedMemory.value,
        diskGb: parsedDisk.value,
        cpuCores: parsedCpu.value,
      })
      const quotas = await fetchTeamQuotas()
      setQuotaUsers(quotas.users)
      setHostCores(quotas.hostCores)
      setQuotaRows((prev) => ({
        ...prev,
        [row.userId]:
          body.weeklyTokens === null ? "" : String(body.weeklyTokens),
      }))
      setMemoryRows((prev) => ({
        ...prev,
        [row.userId]: formatGb(body.memoryMb),
      }))
      setDiskRows((prev) => ({
        ...prev,
        [row.userId]: body.diskGb === null ? "" : String(body.diskGb),
      }))
      setCpuRows((prev) => ({
        ...prev,
        [row.userId]: body.cpuCores === null ? "" : String(body.cpuCores),
      }))
      setNotice(
        (body.memoryApplied === false && parsedMemory.value !== null) ||
          (body.cpuApplied === false && parsedCpu.value !== null)
          ? `Limits saved for ${row.email}. The RAM/CPU caps apply the next time their desktop starts.`
          : `Limits saved for ${row.email}.`,
      )
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
  const opencodeAuth = data?.opencodeAuth ?? null

  async function syncOpencodeAuth() {
    setError("")
    setNotice("")
    setBusy(true)
    try {
      const body = await syncTeamOpencodeAuth()
      await load()
      setNotice(
        `Fournisseurs OpenCode partagés (${body.opencodeAuth.providers.length}) — ${body.opencodeAuth.applied} desktop(s) synchronisé(s)${body.opencodeAuth.failed > 0 ? `, ${body.opencodeAuth.failed} en échec` : ""}.`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "synchronize failed")
    } finally {
      setBusy(false)
    }
  }

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
        <Typography variant="subtitle1">OpenCode providers</Typography>
        <Typography variant="caption" color="textSecondary">
          Shared with every desktop in team mode: the provider logins from your
          own Providers page (API keys and OAuth). Merged per provider — user
          logins for other providers stay. Synchronize re-reads your desktop and
          fans the snapshot out; every admin login/logout also refreshes it
          automatically.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >
            {opencodeAuth?.hasAuth ? (
              opencodeAuth.providers.map((id) => (
                <Chip key={id} size="small" color="success">
                  {id}
                </Chip>
              ))
            ) : (
              <Chip size="small">Not captured</Chip>
            )}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void syncOpencodeAuth()}
            >
              Synchronize
            </Button>
            {opencodeAuth?.capturedAt ? (
              <Typography variant="caption" color="textSecondary">
                Captured{" "}
                {new Date(opencodeAuth.capturedAt).toLocaleString("fr-CA")}
              </Typography>
            ) : null}
          </Stack>
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
        <Typography variant="subtitle1">Per-user limits</Typography>
        <Typography variant="caption" color="textSecondary">
          Per-user token caps, counted from Monday 00:00 UTC. Block pauses
          sending at the cap; warn only shows a banner. A user cap of 0 removes
          their limit. RAM caps the desktop container (0.5–64 GB; empty keeps
          the 4 GB default) and applies live when the desktop is running. CPU
          caps its cores the same way (empty keeps the 2-core default; the host
          has {hostCores ?? "…"} cores — setting the cap to that takes every
          core the host has). Disk is the Hardware-view display cap for that
          user; it overrides the host-wide disk max and enforces nothing.
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
                <TableCell>RAM (GB)</TableCell>
                <TableCell>Disk (GB)</TableCell>
                <TableCell>CPU (cores)</TableCell>
                <TableCell align="right">Effective limit</TableCell>
                <TableCell padding="none" />
              </TableRow>
            </TableHead>
            <TableBody>
              {quotaUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
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
                        onChange={(event) => {
                          // currentTarget is nulled after dispatch; the
                          // updater runs at render time, so capture first.
                          const cap = event.currentTarget.value
                          setQuotaRows((prev) => ({
                            ...prev,
                            [row.userId]: cap,
                          }))
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        label="RAM"
                        value={memoryRows[row.userId] ?? ""}
                        placeholder="4 (default)"
                        sx={{ width: 110 }}
                        onChange={(event) => {
                          const gb = event.currentTarget.value
                          setMemoryRows((prev) => ({
                            ...prev,
                            [row.userId]: gb,
                          }))
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        label="Disk"
                        value={diskRows[row.userId] ?? ""}
                        placeholder="host default"
                        sx={{ width: 110 }}
                        onChange={(event) => {
                          const gb = event.currentTarget.value
                          setDiskRows((prev) => ({
                            ...prev,
                            [row.userId]: gb,
                          }))
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        label="CPU"
                        value={cpuRows[row.userId] ?? ""}
                        placeholder="2 (default)"
                        sx={{ width: 110 }}
                        onChange={(event) => {
                          const cores = event.currentTarget.value
                          setCpuRows((prev) => ({
                            ...prev,
                            [row.userId]: cores,
                          }))
                        }}
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
      <MediaSettings />
      <DiskSettings />
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
      <AccessibleDialog
        open={Boolean(pendingMode)}
        onClose={() => setPendingMode(null)}
      >
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
      </AccessibleDialog>
      <AccessibleDialog open={importOpen} onClose={() => setImportOpen(false)}>
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
      </AccessibleDialog>
      <AccessibleDialog
        open={factoryOpen}
        onClose={() => !adminBusy && setFactoryOpen(false)}
      >
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
            disabled={adminBusy}
            onClick={() => setFactoryOpen(false)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={
              adminBusy || factoryConfirm !== "RESET" || !factoryPassword
            }
            onClick={() => {
              void onFactoryReset({
                confirm: factoryConfirm,
                password: factoryPassword,
                backup: factoryBackup,
              }).then(
                () => setFactoryOpen(false),
                () => undefined,
              )
            }}
          >
            Factory reset
          </Button>
        </DialogActions>
      </AccessibleDialog>
    </>
  )
}
