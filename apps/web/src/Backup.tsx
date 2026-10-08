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
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, type Me } from "./api"
import { ConfigSection } from "./ConfigSection"
import { useMobile } from "./hooks"
import { BackupIcon, DeleteIcon, FactoryIcon, RestoreIcon } from "./icons"

type BackupUser = { userId: string; email: string; files: number }
type BackupSummary = {
  id: string
  startedAt: number
  finishedAt: number
  trigger: string
  label: string | null
  totalBytes: number
  hasControlDb: boolean
  users: BackupUser[]
}
type BackupStatusBody = {
  running: boolean
  lastRunAt: number | null
  lastError: string | null
}
type BucketConfig = {
  endpoint: string
  region: string
  provider: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  prefix: string
}
type BackupConfigBody = {
  enabled: boolean
  schedule: string | null
  keepLocal: number
  keepRemote: number
  bucket: BucketConfig | null
}
type ListBody = {
  status: BackupStatusBody
  backups: BackupSummary[]
  config: Partial<BackupConfigBody>
}
type ManifestVolume = { name: string; file: string; bytes: number }
type ManifestBody = {
  manifest: {
    id: string
    startedAt: number
    trigger: string
    label: string | null
    controlDb: { bytes: number } | null
    users: { userId: string; email: string; volumes: ManifestVolume[] }[]
    totalBytes: number
  }
}

function formatBytes(value: number) {
  if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)} GB`
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`
  if (value >= 1_024) return `${(value / 1_024).toFixed(0)} KB`
  return `${value} B`
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString()
}

function emptyBucket(): BucketConfig {
  return {
    endpoint: "",
    region: "",
    provider: "Other",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    prefix: "",
  }
}

function AdminConfig({
  config,
  onSaved,
}: {
  config: BackupConfigBody
  onSaved: () => void
}) {
  const [form, setForm] = useState(config)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    error: string | null
  } | null>(null)
  useEffect(() => setForm(config), [config])

  const set = (patch: Partial<BackupConfigBody>) =>
    setForm((prev) => ({ ...prev, ...patch }))
  const setBucket = (patch: Partial<BucketConfig>) =>
    setForm((prev) => ({
      ...prev,
      bucket: { ...(prev.bucket ?? emptyBucket()), ...patch },
    }))

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{ config: BackupConfigBody }>(
        "/api/backup/config",
        {
          method: "PUT",
          body: JSON.stringify({
            ...form,
            bucket: form.bucket,
          }),
        },
      )
      setForm(body.config)
      setSaved("Backup settings saved.")
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setError("")
    setTestResult(null)
    setBusy(true)
    try {
      const result = await api<{ ok: boolean; error: string | null }>(
        "/api/backup/config/test",
        { method: "POST", body: JSON.stringify(form.bucket ?? {}) },
      )
      setTestResult(result)
    } catch (caught) {
      setTestResult({
        ok: false,
        error: caught instanceof Error ? caught.message : "test failed",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={<BackupIcon />}
      title="Backup destination and schedule"
      description="Backups always land locally on the control plane volume. Add an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi) to push every backup to the cloud too."
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {testResult ? (
          testResult.ok ? (
            <Alert severity="success">Bucket connection works.</Alert>
          ) : (
            <Alert severity="error">
              {testResult.error ?? "bucket test failed"}
            </Alert>
          )
        ) : null}
        <FormControlLabel
          control={
            <CheckBox
              checked={form.enabled}
              onChange={(event) =>
                set({ enabled: event.currentTarget.checked })
              }
            />
          }
          label="Run scheduled backups"
        />
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <TextField
            label="Schedule (5-field UTC cron)"
            value={form.schedule ?? ""}
            placeholder="0 4 * * *"
            onChange={(event) => set({ schedule: event.currentTarget.value })}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Keep local"
            type="number"
            value={String(form.keepLocal)}
            onChange={(event) =>
              set({ keepLocal: Number(event.currentTarget.value) })
            }
            sx={{ maxWidth: 140 }}
          />
          <TextField
            label="Keep in bucket"
            type="number"
            value={String(form.keepRemote)}
            onChange={(event) =>
              set({ keepRemote: Number(event.currentTarget.value) })
            }
            sx={{ maxWidth: 140 }}
          />
        </Stack>
        <Typography variant="subtitle2">S3-compatible bucket</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <TextField
            label="Endpoint (blank for AWS)"
            value={form.bucket?.endpoint ?? ""}
            placeholder="https://<account>.r2.cloudflarestorage.com"
            onChange={(event) =>
              setBucket({ endpoint: event.currentTarget.value })
            }
            sx={{ flex: 2, minWidth: 220 }}
          />
          <TextField
            label="Provider"
            value={form.bucket?.provider ?? "Other"}
            placeholder="Other / AWS / Minio / Wasabi"
            onChange={(event) =>
              setBucket({ provider: event.currentTarget.value })
            }
            sx={{ flex: 1, minWidth: 180 }}
          />
          <TextField
            label="Region"
            value={form.bucket?.region ?? ""}
            placeholder="auto"
            onChange={(event) =>
              setBucket({ region: event.currentTarget.value })
            }
            sx={{ flex: 1, minWidth: 140 }}
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <TextField
            label="Access key ID"
            value={form.bucket?.accessKeyId ?? ""}
            onChange={(event) =>
              setBucket({ accessKeyId: event.currentTarget.value })
            }
            sx={{ flex: 1 }}
          />
          <TextField
            label="Secret access key"
            type="password"
            value={form.bucket?.secretAccessKey ?? ""}
            onChange={(event) =>
              setBucket({ secretAccessKey: event.currentTarget.value })
            }
            sx={{ flex: 1 }}
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <TextField
            label="Bucket"
            value={form.bucket?.bucket ?? ""}
            onChange={(event) =>
              setBucket({ bucket: event.currentTarget.value })
            }
            sx={{ flex: 1 }}
          />
          <TextField
            label="Prefix (optional)"
            value={form.bucket?.prefix ?? ""}
            onChange={(event) =>
              setBucket({ prefix: event.currentTarget.value })
            }
            sx={{ flex: 1 }}
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void save()}
          >
            Save
          </Button>
          <Button
            variant="outlined"
            disabled={busy || !form.bucket?.bucket}
            onClick={() => void test()}
          >
            Test bucket
          </Button>
        </Stack>
      </Stack>
    </ConfigSection>
  )
}

function RestoreDialog({
  backupId,
  me,
  onClose,
  onStarted,
}: {
  backupId: string
  me: Me
  onClose: () => void
  onStarted: () => void
}) {
  const admin = me.role === "admin"
  const [manifest, setManifest] = useState<ManifestBody["manifest"] | null>(
    null,
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [preBackup, setPreBackup] = useState(true)
  const [controlDb, setControlDb] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  useEffect(() => {
    api<ManifestBody>(`/api/backup/${encodeURIComponent(backupId)}`)
      .then((body) => {
        setManifest(body.manifest)
        const next: Record<string, boolean> = {}
        for (const user of body.manifest.users) next[user.userId] = true
        setSelected(next)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "failed"),
      )
  }, [backupId])

  async function restore() {
    if (!manifest) return
    setError("")
    setBusy(true)
    try {
      const body: Record<string, unknown> = { backup: preBackup }
      if (admin) {
        body.controlDb = controlDb
        body.userIds = manifest.users
          .filter((user) => selected[user.userId])
          .map((user) => user.userId)
      }
      await api(`/api/backup/${encodeURIComponent(backupId)}/restore`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      onStarted()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "restore failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Restore backup</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {manifest ? (
            <>
              <Typography variant="body2">
                {formatDate(manifest.startedAt)} ·{" "}
                {formatBytes(manifest.totalBytes)}
                {manifest.controlDb ? " · includes control database" : ""}
              </Typography>
              {manifest.users.map((user) => (
                <Stack
                  key={user.userId}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  {admin ? (
                    <CheckBox
                      checked={Boolean(selected[user.userId])}
                      onChange={(event) =>
                        setSelected((prev) => ({
                          ...prev,
                          [user.userId]: event.currentTarget.checked,
                        }))
                      }
                    />
                  ) : null}
                  <Typography variant="body2">
                    {user.email} — {user.volumes.length} volumes
                  </Typography>
                </Stack>
              ))}
              {admin && manifest.controlDb ? (
                <FormControlLabel
                  control={
                    <CheckBox
                      checked={controlDb}
                      onChange={(event) =>
                        setControlDb(event.currentTarget.checked)
                      }
                    />
                  }
                  label="Also restore the control database (restarts open-bot)"
                />
              ) : null}
              <FormControlLabel
                control={
                  <CheckBox
                    checked={preBackup}
                    onChange={(event) =>
                      setPreBackup(event.currentTarget.checked)
                    }
                  />
                }
                label="Back up current state first (recommended)"
              />
              <Typography variant="caption" color="textSecondary">
                Restoring overwrites the selected desktops' files, packages, and
                memory with this backup. Desktops restart afterwards.
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="textSecondary">
              Loading…
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={<RestoreIcon />}
          disabled={busy || !manifest}
          onClick={() => void restore()}
        >
          Restore
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ResetDesktopDialog({
  me,
  onClose,
  onStarted,
}: {
  me: Me
  onClose: () => void
  onStarted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [preBackup, setPreBackup] = useState(true)

  async function reset() {
    setError("")
    setBusy(true)
    try {
      await api("/api/desktop/reset", {
        method: "POST",
        body: JSON.stringify({ backup: preBackup }),
      })
      onStarted()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reset failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Factory reset your desktop?</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="body2">
            This destroys every container and volume of{" "}
            <strong>{me.email}</strong>'s desktop: chat history, installed
            packages, browser logins, workspace files, and this desktop's
            memory. The next start is a fresh desktop.
          </Typography>
          <FormControlLabel
            control={
              <CheckBox
                checked={preBackup}
                onChange={(event) => setPreBackup(event.currentTarget.checked)}
              />
            }
            label="Back up this desktop first (recommended)"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy}
          onClick={() => void reset()}
        >
          Reset desktop
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function Backup({ me }: { me: Me }) {
  const admin = me.role === "admin"
  const mobile = useMobile()
  const [data, setData] = useState<ListBody | null>(null)
  const [config, setConfig] = useState<BackupConfigBody | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState("")
  const [full, setFull] = useState(false)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    return api<ListBody>("/api/backup")
      .then((body) => {
        setData(body)
        if (admin && body.config) setConfig(body.config as BackupConfigBody)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "failed"),
      )
  }, [admin])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (data?.status.running && !pollRef.current) {
      pollRef.current = setInterval(() => void load(), 3000)
    }
    if (!data?.status.running && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [data?.status.running, load])

  async function runBackup() {
    setError("")
    setBusy(true)
    try {
      await api("/api/backup/run", {
        method: "POST",
        body: JSON.stringify({ full: admin && full, label: label || null }),
      })
      setLabel("")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "backup failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError("")
    setBusy(true)
    try {
      await api(`/api/backup/${encodeURIComponent(id)}`, { method: "DELETE" })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setBusy(false)
    }
  }

  const backups = data?.backups ?? []
  const status = data?.status

  return (
    <Stack spacing={2}>
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
      {status?.lastError ? (
        <Alert severity="warning">Last backup failed: {status.lastError}</Alert>
      ) : null}
      <ConfigSection
        icon={<BackupIcon />}
        title="Backups"
        description="A backup saves the control-plane database and every desktop's volumes (home, packages, memory). Restores and agent resets can pull data back from here."
        status={
          status?.running
            ? { label: "running…", color: "warning" }
            : backups.length > 0
              ? { label: `${backups.length} kept`, color: "success" }
              : { label: "no backups yet" }
        }
      >
        <Stack spacing={1.5}>
          <Stack direction={mobile ? "column" : "row"} spacing={1}>
            <TextField
              label="Label (optional)"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              startIcon={<BackupIcon />}
              disabled={busy || Boolean(status?.running)}
              onClick={() => void runBackup()}
            >
              {status?.running ? "Backup running…" : "Back up now"}
            </Button>
          </Stack>
          {admin ? (
            <FormControlLabel
              control={
                <CheckBox
                  checked={full}
                  onChange={(event) => setFull(event.currentTarget.checked)}
                />
              }
              label="Include all users and the control-plane database"
            />
          ) : (
            <Typography variant="caption" color="textSecondary">
              Your backups cover this desktop only. The admin can back up
              everything from the same tab.
            </Typography>
          )}
          {status?.running ? (
            <Typography variant="caption" color="textSecondary">
              Archives are being written
              {config?.bucket?.bucket ? " and pushed to the bucket" : ""}. Large
              desktops take a few minutes.
            </Typography>
          ) : null}
          {backups.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              No backups yet.
            </Typography>
          ) : (
            backups.map((backup, index) => (
              <Box key={backup.id}>
                {index > 0 ? <Box sx={{ mt: 1 }} /> : null}
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Stack
                    direction={mobile ? "column" : "row"}
                    spacing={1}
                    alignItems={mobile ? "flex-start" : "center"}
                  >
                    <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.25}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                      >
                        <Typography variant="body2" className="ob-mono">
                          {backup.id}
                        </Typography>
                        <Chip size="small" label={backup.trigger} />
                        {backup.hasControlDb ? (
                          <Chip size="small" label="+control db" />
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="textSecondary">
                        {formatDate(backup.startedAt)} ·{" "}
                        {formatBytes(backup.totalBytes)}
                        {backup.label ? ` · ${backup.label}` : ""}
                        {backup.users.length > 0
                          ? ` · ${backup.users.map((u) => u.email).join(", ")}`
                          : ""}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RestoreIcon />}
                        onClick={() => setRestoreId(backup.id)}
                      >
                        Restore
                      </Button>
                      {admin ? (
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          startIcon={<DeleteIcon />}
                          disabled={busy}
                          onClick={() => void remove(backup.id)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Paper>
              </Box>
            ))
          )}
        </Stack>
      </ConfigSection>
      {admin && config ? (
        <AdminConfig config={config} onSaved={() => void load()} />
      ) : null}
      <ConfigSection
        icon={<FactoryIcon />}
        title="Factory reset this desktop"
        description="Destroys this desktop's containers and volumes and starts a fresh one. The desktop's agent can request the same reset, but it only runs after you approve it in the dashboard with your password."
      >
        <Button
          variant="outlined"
          color="error"
          onClick={() => setResetOpen(true)}
        >
          Reset my desktop
        </Button>
      </ConfigSection>
      {restoreId ? (
        <RestoreDialog
          backupId={restoreId}
          me={me}
          onClose={() => setRestoreId(null)}
          onStarted={() =>
            setNotice("Restore started. Desktops restart when it finishes.")
          }
        />
      ) : null}
      {resetOpen ? (
        <ResetDesktopDialog
          me={me}
          onClose={() => setResetOpen(false)}
          onStarted={() => setNotice("Desktop reset started.")}
        />
      ) : null}
    </Stack>
  )
}
