import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import { TablePagination } from "@shpaw415/mui-lite/Pagination"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
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
import { api } from "./api"

type ReportStatus = "open" | "done" | "wontfix"
type Filter = ReportStatus | "all"
type Report = {
  id: string
  email: string | null
  sessionId: string | null
  kind: string
  surface: string
  title: string
  detail: string
  hits: number
  status: ReportStatus
  note: string | null
  lastSeenAt: number
}

function formatAgo(ts: number) {
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function Improvements() {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<Filter>("open")
  const [rows, setRows] = useState<Report[]>([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10)
  const [selected, setSelected] = useState<Report | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (next: Filter) => {
    setError("")
    setLoading(true)
    try {
      const body = await api<{ improvements: Report[] }>(
        `/api/admin/improvements?status=${next}`,
      )
      setRows(body.improvements)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [load, status])

  async function setReportStatus(next: ReportStatus) {
    if (!selected) return
    setBusy(true)
    setError("")
    try {
      await api(`/api/admin/improvements/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next, note }),
      })
      setSelected(null)
      await load(status)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
    } finally {
      setBusy(false)
    }
  }

  const visible = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Product reports</Typography>
      <Typography variant="caption" color="textSecondary">
        Filed by development desktops. Review and patch from the repo queue.
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError("")} sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
      <Stack
        direction="row"
        spacing={1}
        sx={{ flexWrap: "wrap", rowGap: 1, my: 1 }}
      >
        {(["open", "done", "wontfix", "all"] as const).map((value) => (
          <Button
            key={value}
            size="small"
            variant={status === value ? "contained" : "outlined"}
            onClick={() => {
              setStatus(value)
              setPage(0)
            }}
          >
            {value === "wontfix"
              ? "Won't fix"
              : value[0]?.toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </Stack>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Surface</TableCell>
              <TableCell align="right">Hits</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>Loading</TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No reports.</TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  onClick={() => {
                    setSelected(row)
                    setNote(row.note ?? "")
                  }}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.kind}</TableCell>
                  <TableCell>{row.surface}</TableCell>
                  <TableCell align="right">{row.hits}</TableCell>
                  <TableCell>{row.email ?? "—"}</TableCell>
                  <TableCell>{formatAgo(row.lastSeenAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        count={rows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={(_event, next) => setPage(next)}
        onRowsPerPageChange={(next) => {
          setRowsPerPage(next)
          setPage(0)
        }}
      />
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)}>
        <DialogTitle>{selected?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
            {selected?.detail}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            {selected?.kind} · {selected?.surface} · {selected?.hits} hits
            {selected?.sessionId ? ` · ${selected.sessionId}` : ""}
          </Typography>
          <TextField
            label="Note"
            value={note}
            multiline
            rows={3}
            onChange={(event) => setNote(event.currentTarget.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setSelected(null)}>
            Close
          </Button>
          {selected?.status !== "open" ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void setReportStatus("open")}
            >
              Reopen
            </Button>
          ) : null}
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void setReportStatus("wontfix")}
          >
            Won't fix
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void setReportStatus("done")}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
