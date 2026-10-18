import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import Divider from "@shpaw415/mui-lite/Divider"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
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
import { useCallback, useEffect, useState } from "react"
import {
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
} from "../api"
import {
  formatTokenCount,
  isTeamSecretField,
  overlayDraft,
  overlayPatch,
  parseQuotaCapInput,
  TEAM_OVERLAY_SECTIONS,
  teamKeysPayload,
} from "../team"

function modeLabel(mode: TeamMode) {
  return mode === "team" ? "Team" : "Personal"
}

export function TeamTab() {
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
