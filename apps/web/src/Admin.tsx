import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
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
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { useMobile } from "./hooks"
import {
  BlockIcon,
  ContentCopyIcon,
  DeleteIcon,
  LockResetIcon,
  MoreVertIcon,
  PersonAddIcon,
} from "./icons"
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

function formatAgo(ts: number | null) {
  if (!ts) return "—"
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function ChartView({ option, height }: { option: object; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const signature = JSON.stringify(option)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dead = false
    let chart: {
      dispose: () => void
      resize: () => void
      setOption: (value: unknown, notMerge?: boolean) => void
    } | null = null
    const observer = new ResizeObserver(() => chart?.resize())
    observer.observe(el)
    void import("echarts").then((ec) => {
      if (dead) return
      chart = ec.init(el)
      chart.setOption(JSON.parse(signature), true)
    })
    return () => {
      dead = true
      observer.disconnect()
      chart?.dispose()
    }
  }, [signature])
  return <Box ref={ref} sx={{ width: "100%", height }} />
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
    </Box>
  )
}
