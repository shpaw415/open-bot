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
import { useEffect, useState } from "react"
import { api } from "../api"
import { FactoryIcon } from "../icons"

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

export function HostTab({
  busy,
  onFactoryReset,
}: {
  busy: boolean
  onFactoryReset: (body: {
    confirm: string
    password: string
    backup: boolean
  }) => Promise<void>
}) {
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [factoryConfirm, setFactoryConfirm] = useState("")
  const [factoryPassword, setFactoryPassword] = useState("")
  const [factoryBackup, setFactoryBackup] = useState(true)

  return (
    <>
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
      </Dialog>
    </>
  )
}
