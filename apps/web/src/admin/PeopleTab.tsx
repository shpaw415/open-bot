import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Menu from "@shpaw415/mui-lite/Menu"
import { TablePagination } from "@shpaw415/mui-lite/Pagination"
import Paper from "@shpaw415/mui-lite/Paper"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Stack from "@shpaw415/mui-lite/Stack"
import Table, {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@shpaw415/mui-lite/Table"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useRef, useState } from "react"
import {
  BlockIcon,
  ContentCopyIcon,
  DeleteIcon,
  LockResetIcon,
  MoreVertIcon,
  PersonAddIcon,
  RefreshIcon,
} from "../icons"
import { formatTokenCount } from "../team"
import { tokensFor, type UsageDay } from "../usage-charts"
import type { AdminUser, DayWindow, Invite } from "./types"

function formatAgo(ts: number | null) {
  if (!ts) return "—"
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function PeopleTab({
  meId,
  users,
  invites,
  daily,
  days,
  loading,
  busy,
  selectedId,
  onSelect,
  onAct,
  onCreateInvite,
  onResetDesktop,
}: {
  meId: string
  users: AdminUser[]
  invites: Invite[]
  daily: UsageDay[]
  days: DayWindow
  loading: boolean
  busy: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onAct: (path: string, init?: RequestInit) => Promise<void>
  onCreateInvite: () => Promise<void>
  onResetDesktop: (user: AdminUser, backup: boolean) => Promise<void>
}) {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [pendingReset, setPendingReset] = useState<AdminUser | null>(null)
  const [resetBackup, setResetBackup] = useState(true)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (days) setPage(0)
  }, [days])

  function act(path: string, init?: RequestInit) {
    setMenuId(null)
    return onAct(path, init)
  }

  const visible = users.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const menuUser = users.find((row) => row.id === menuId) ?? null
  const unused = invites.filter((row) => !row.usedAt)

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PersonAddIcon />}
          disabled={busy}
          onClick={() => void onCreateInvite()}
        >
          Create invite
        </Button>
      </Stack>
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
                      selected={row.id === selectedId}
                      onClick={() => onSelect(row.id)}
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
                        {formatTokenCount(stats.total)}
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
              if (!user) return
              setPendingReset(null)
              void onResetDesktop(user, resetBackup)
            }}
          >
            Reset desktop
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
