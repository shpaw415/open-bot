import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import Snackbar from "@shpaw415/mui-lite/Snackbar"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useRef, useState } from "react"
import { api } from "./api"
import { useEventStream, useMobile } from "./hooks"

type ApprovalSummary = {
  id: string
  kind: "reset" | "restore"
  backupId: string | null
  label: string
  status: string
  createdAt: number
  expiresAt: number
  attempts: number
  result: {
    state: "running" | "done" | "failed"
    error: string | null
    detail?: string | null
  } | null
}

function actionText(request: ApprovalSummary) {
  return request.kind === "restore"
    ? `restore this desktop from backup ${request.backupId ?? ""}`
    : "factory-reset this desktop"
}

function resultText(result: NonNullable<ApprovalSummary["result"]>) {
  if (result.state === "done") return `Finished: ${result.detail ?? "done"}`
  if (result.state === "failed")
    return `Failed: ${result.error ?? "unknown error"}`
  return "Running…"
}

export function ResetApprovals() {
  const { subscribe } = useEventStream(true)
  const mobile = useMobile()
  const [request, setRequest] = useState<ApprovalSummary | null>(null)
  const [password, setPassword] = useState("")
  const [preBackup, setPreBackup] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "reset.request") {
        const summary = event.properties as ApprovalSummary | undefined
        if (!summary?.id || seen.current.has(summary.id)) return
        seen.current.add(summary.id)
        setRequest(summary)
        setPassword("")
        setError("")
      }
      if (event.type === "reset.result") {
        const result = event.properties as
          | (ApprovalSummary["result"] & { id?: string; kind?: string })
          | undefined
        if (!result?.state) return
        setOutcome(resultText(result))
        setRequest((current) =>
          current && current.result == null ? { ...current, result } : current,
        )
      }
    })
  }, [subscribe])

  async function approve() {
    if (!request) return
    setError("")
    setBusy(true)
    try {
      await api(
        `/api/reset-requests/${encodeURIComponent(request.id)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ password, backup: preBackup }),
        },
      )
      setRequest((current) =>
        current ? { ...current, status: "approved" } : current,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "approval failed")
    } finally {
      setBusy(false)
    }
  }

  async function deny() {
    if (!request) return
    setBusy(true)
    try {
      await api(`/api/reset-requests/${encodeURIComponent(request.id)}/deny`, {
        method: "POST",
      })
      setRequest(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setBusy(false)
    }
  }

  const approved = request?.status === "approved"

  return (
    <>
      {request ? (
        <Dialog open onClose={busy ? undefined : () => setRequest(null)}>
          <DialogTitle>Confirm desktop {request.kind}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <Typography variant="body2">
                The desktop's agent requests permission to {actionText(request)}
                . This destroys this desktop's files, packages, browser logins,
                and memory
                {request.kind === "restore"
                  ? " and replaces them with the backup's contents"
                  : ""}
                . Enter your account password to allow it — without your
                password nothing happens.
              </Typography>
              {approved ? (
                <Alert severity="info">
                  Approved. The desktop is being{" "}
                  {request.kind === "restore" ? "restored" : "reset"}.
                  {request.result
                    ? ` ${resultText(request.result)}`
                    : " This can take a few minutes."}
                </Alert>
              ) : (
                <>
                  <TextField
                    label="Account password"
                    type="password"
                    value={password}
                    autoFocus
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && password && !busy)
                        void approve()
                    }}
                  />
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
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {approved ? (
              <Button variant="contained" onClick={() => setRequest(null)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="text"
                  disabled={busy}
                  onClick={() => void deny()}
                >
                  Deny
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={busy || !password}
                  onClick={() => void approve()}
                >
                  Approve
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      ) : null}
      <Snackbar
        open={outcome != null}
        autoHideDuration={10000}
        onClose={() => setOutcome(null)}
        position={mobile ? "bottom-center" : "bottom-left"}
        message={outcome ?? ""}
      />
    </>
  )
}
