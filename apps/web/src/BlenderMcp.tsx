import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { Model3dIcon } from "./icons"

type BlenderStatus = {
  installed: boolean
  enabled: boolean
  running: boolean
  applied?: boolean
}

export function BlenderMcp() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<BlenderStatus | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api<BlenderStatus>("/api/mcp"))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to load")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setEnabled(enabled: boolean) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const next = await api<BlenderStatus>("/api/mcp", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      })
      setStatus(next)
      setSaved(
        enabled
          ? "Enabled. The blender worker tools and the headless Blender are available again."
          : "Disabled. Blender stopped and the workers lost the blender tools.",
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  const awake =
    status !== null && (status.installed || status.enabled || status.running)
  const label = !status
    ? "Loading…"
    : !awake
      ? "Desktop asleep"
      : status.running && status.enabled
        ? "Running"
        : status.enabled
          ? "Starting…"
          : "Disabled"

  return (
    <ConfigSection
      icon={<Model3dIcon />}
      title="Blender (local 3D)"
      description="Headless Blender plus the blender MCP bridge on this desktop. The chat agent never carries the blender tools; they load only inside blender-team workers, so sessions stay lean. Toggle the whole feature off if you do not use 3D."
      status={
        label === "Running"
          ? { label, color: "success" }
          : label === "Starting…"
            ? { label, color: "warning" }
            : { label }
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {status && !status.installed && awake ? (
          <Alert severity="warning">
            This desktop image has no Blender installed yet. Update the desktop
            to get it.
          </Alert>
        ) : null}
        <Typography variant="body2" color="textSecondary">
          Workers render previews, save scenes under{" "}
          <code>/home/agent/workspace</code>, and export GLB/STL. The agent
          drives Blender with the <code>blender-team</code> CLI.
        </Typography>
        <Stack direction="row" spacing={1}>
          {status?.enabled ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void setEnabled(false)}
            >
              Disable Blender
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy || (status !== null && !status.installed)}
              onClick={() => void setEnabled(true)}
            >
              Enable Blender
            </Button>
          )}
          <Button variant="text" disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
