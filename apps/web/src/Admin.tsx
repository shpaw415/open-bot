import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Drawer from "@shpaw415/mui-lite/Drawer"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { HostTab } from "./admin/HostTab"
import { PeopleTab } from "./admin/PeopleTab"
import { TeamTab } from "./admin/TeamTab"
import type { AdminUser, DayWindow, Invite, UsageBody } from "./admin/types"
import { UsageTab } from "./admin/UsageTab"
import { api } from "./api"
import { Chip } from "./chip"
import { useMobile } from "./hooks"
import { Improvements } from "./Improvements"
import {
  BarChartIcon,
  ChecklistIcon,
  ComputerIcon,
  ContentCopyIcon,
  PersonIcon,
  WorkIcon,
} from "./icons"
import Stack from "./stack"
import { formatTokenCount } from "./team"

type AdminTab = "people" | "usage" | "improvements" | "team" | "host"

const ADMIN_TABS: { value: AdminTab; label: string; icon: ReactNode }[] = [
  { value: "people", label: "People", icon: <PersonIcon /> },
  { value: "usage", label: "Usage", icon: <BarChartIcon /> },
  { value: "improvements", label: "Improvements", icon: <ChecklistIcon /> },
  { value: "team", label: "Team", icon: <WorkIcon /> },
  { value: "host", label: "Host", icon: <ComputerIcon /> },
]

export function Admin({ meId }: { meId: string }) {
  const mobile = useMobile()
  const [tab, setTab] = useState<AdminTab>("people")
  const [teamMounted, setTeamMounted] = useState(false)
  const [hostMounted, setHostMounted] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [invite, setInvite] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<DayWindow>(30)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usage, setUsage] = useState<UsageBody | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (nextDays: DayWindow) => {
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

  function selectTab(next: AdminTab) {
    setTab(next)
    if (next === "team") setTeamMounted(true)
    if (next === "host") setHostMounted(true)
  }

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

  async function resetDesktop(user: AdminUser, backup: boolean) {
    setError("")
    setBusy(true)
    try {
      await api(`/api/admin/users/${user.id}/reset-desktop`, {
        method: "POST",
        body: JSON.stringify({ backup }),
      })
      setNotice(`Desktop reset started for ${user.email}.`)
      await load(days)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reset failed")
    } finally {
      setBusy(false)
    }
  }

  async function factoryReset(body: {
    confirm: string
    password: string
    backup: boolean
  }) {
    setError("")
    setBusy(true)
    try {
      await api("/api/factory-reset", {
        method: "POST",
        body: JSON.stringify(body),
      })
      setNotice(
        "Factory reset running. All desktops are destroyed, data is wiped, and open-bot restarts with default credentials shortly.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "factory reset failed",
      )
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const daily = usage?.daily ?? []
  const running = users.filter((row) => row.desktop === "running").length

  const header = (
    <>
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
      </Stack>
    </>
  )

  const dayStrip =
    tab === "people" || tab === "usage" ? (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", rowGap: 1 }}
      >
        {([7, 30, 90] as const).map((value) => (
          <Button
            key={value}
            size="small"
            variant={days === value ? "contained" : "outlined"}
            onClick={() => setDays(value)}
          >
            {value}d
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Chip size="small">
          {formatTokenCount(usage?.totals.totalTokens ?? 0)} tokens
        </Chip>
        <Chip size="small">{usage?.totals.calls ?? 0} calls</Chip>
      </Stack>
    ) : null

  const panels = (
    <>
      {tab === "people" ? (
        <PeopleTab
          meId={meId}
          users={users}
          invites={invites}
          daily={daily}
          days={days}
          loading={loading}
          busy={busy}
          selectedId={selected}
          onSelect={setSelected}
          onAct={act}
          onCreateInvite={createInvite}
          onResetDesktop={resetDesktop}
        />
      ) : null}
      {tab === "usage" ? (
        <UsageTab
          users={users}
          daily={daily}
          loading={loading}
          usage={usage}
          selectedId={selected}
          onSelect={setSelected}
        />
      ) : null}
      {tab === "improvements" ? <Improvements /> : null}
      {teamMounted ? (
        <Stack
          spacing={1.5}
          sx={tab === "team" ? undefined : { display: "none" }}
        >
          <TeamTab />
        </Stack>
      ) : null}
      {hostMounted ? (
        <Stack
          spacing={1.5}
          sx={tab === "host" ? undefined : { display: "none" }}
        >
          <HostTab busy={busy} onFactoryReset={factoryReset} />
        </Stack>
      ) : null}
    </>
  )

  const chrome = mobile ? (
    <Tabs
      value={tab}
      variant="scrollable"
      onChange={(_event, value) => selectTab(value as AdminTab)}
    >
      {ADMIN_TABS.map((entry) => (
        <Tab
          key={entry.value}
          label={entry.label}
          value={entry.value}
          icon={entry.icon}
        />
      ))}
    </Tabs>
  ) : (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Drawer
        variant="permanent"
        open
        anchor="left"
        width={220}
        sx={{
          position: "sticky",
          top: 8,
          alignSelf: "flex-start",
          maxHeight: "calc(100vh - 48px)",
        }}
      >
        <List dense sx={{ p: 1 }}>
          {ADMIN_TABS.map((entry) => (
            <ListItemButton
              key={entry.value}
              selected={tab === entry.value}
              onClick={() => selectTab(entry.value)}
            >
              {entry.icon}
              <ListItemText primary={entry.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
        {dayStrip}
        {panels}
      </Stack>
    </Stack>
  )

  return (
    <Box className="ob-scroll" sx={{ p: mobile ? 1 : 2, width: "100%" }}>
      <Stack spacing={1.5}>
        {header}
        {chrome}
        {mobile ? dayStrip : null}
        {mobile ? panels : null}
      </Stack>
    </Box>
  )
}
