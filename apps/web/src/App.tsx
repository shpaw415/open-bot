import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Divider from "@shpaw415/mui-lite/Divider"
import Drawer from "@shpaw415/mui-lite/Drawer"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Menu from "@shpaw415/mui-lite/Menu"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Admin } from "./Admin"
import { AgentNotices, NoticeBell, SoundBell } from "./AgentNotices"
import { api, type Me } from "./api"
import { Config } from "./Config"
import { CronView } from "./CronView"
import { useMobile } from "./hooks"
import {
  AdminPanelSettingsIcon,
  AppsIcon,
  ChatIcon,
  ChevronRightIcon,
  DarkModeIcon,
  FolderIcon,
  LightModeIcon,
  LogoutIcon,
  MenuIcon,
  PhotoLibraryIcon,
  ScheduleIcon,
  SettingsIcon,
} from "./icons"
import { Login, SetCredentials } from "./Login"
import { openNotifiedThread, setNoticeFocus } from "./notify"
import {
  PluginAppsView,
  type PluginsViewStatus,
  PluginTabView,
  pluginTabs,
} from "./plugin-tabs"
import { useInstalledPlugins } from "./plugin-ui"
import { ResetApprovals } from "./ResetApprovals"
import {
  CONFIG_GROUPS,
  CONFIG_TAB_LABELS,
  type ConfigTab,
  configPath,
  parseRoute,
  type WorkspaceTab,
  workspacePath,
} from "./routes"
import { Tip } from "./Tip"
import { useThemeMode } from "./theme"
import { Workspace } from "./Workspace"

const NAV_RAIL_KEY = "ob-nav-rail"

type NavEntry = {
  view: string
  path: string
  label: string
  icon: React.ReactNode
  roles?: "admin"
}

const NAV_ENTRIES: NavEntry[] = [
  { view: "workspace:chat", path: "/", label: "Chat", icon: <ChatIcon /> },
  {
    view: "workspace:projects",
    path: "/projects",
    label: "Projects",
    icon: <FolderIcon />,
  },
  {
    view: "workspace:media",
    path: "/media",
    label: "Media",
    icon: <PhotoLibraryIcon />,
  },
  { view: "apps", path: "/apps", label: "Apps", icon: <AppsIcon /> },
  {
    view: "automations",
    path: "/automations",
    label: "Automations",
    icon: <ScheduleIcon />,
  },
  {
    view: "config",
    path: "/config",
    label: "Settings",
    icon: <SettingsIcon />,
  },
  {
    view: "admin",
    path: "/admin",
    label: "Admin",
    icon: <AdminPanelSettingsIcon />,
    roles: "admin",
  },
]

function navActiveKey(route: ReturnType<typeof parseRoute>["route"]): string {
  if (route.view === "workspace") return `workspace:${route.tab}`
  return route.view
}

function NavLink({
  entry,
  active,
  rail,
  badge,
  onGo,
}: {
  entry: NavEntry
  active: boolean
  rail: boolean
  badge?: number
  onGo: (path: string) => void
}) {
  const body = (
    <>
      <span className="ob-nav-icon">
        {entry.icon}
        {badge ? <span className="ob-nav-badge">{badge}</span> : null}
      </span>
      {rail ? null : <span className="ob-nav-label">{entry.label}</span>}
    </>
  )
  if (rail)
    return (
      <a
        className={`ob-nav-item${active ? " ob-nav-active" : ""}`}
        href={entry.path}
        title={entry.label}
        aria-label={entry.label}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault()
          onGo(entry.path)
        }}
      >
        {body}
      </a>
    )
  return (
    <a
      className={`ob-nav-item${active ? " ob-nav-active" : ""}`}
      href={entry.path}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault()
        onGo(entry.path)
      }}
    >
      {body}
    </a>
  )
}

/** Section-scoped categories rendered in the sidebar while in Settings. */
function ConfigCategories({
  active,
  onGo,
}: {
  active: ConfigTab | ""
  onGo: (path: string) => void
}) {
  return (
    <Box
      className="ob-side-context"
      role="navigation"
      aria-label="Settings sections"
    >
      {CONFIG_GROUPS.map((group) => (
        <Box key={group.key} className="ob-side-group">
          <Typography className="ob-side-group-label" variant="caption">
            {group.label}
          </Typography>
          {group.tabs.map((tab) => {
            const href = tab === "cron" ? "/automations" : configPath(tab)
            const isActive =
              tab === "cron" ? active === ("cron" as ConfigTab) : active === tab
            return (
              <a
                key={tab}
                className={`ob-side-link${isActive ? " ob-nav-active" : ""}`}
                href={href}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  onGo(href)
                }}
              >
                {CONFIG_TAB_LABELS[tab]}
              </a>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [path, setPath] = useState(
    typeof location !== "undefined" ? location.pathname : "/",
  )
  const mobile = useMobile()
  const { mode, toggle } = useThemeMode()
  // The install list is account-scoped: only fetch with a session, and
  // invalidate whenever the signed-in user changes (or on logout).
  const pluginsState = useInstalledPlugins({
    active: Boolean(me),
    identity: me?.id ?? null,
  })
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem(NAV_RAIL_KEY) === "1"
    } catch {
      return false
    }
  })
  const [navOpen, setNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountButton = useRef<HTMLButtonElement | null>(null)

  const setRailPersisted = useCallback((next: boolean) => {
    setRail(next)
    try {
      localStorage.setItem(NAV_RAIL_KEY, next ? "1" : "0")
    } catch {
      // session-only collapse is fine
    }
  }, [])

  const announce = useCallback(() => {
    window.dispatchEvent(new CustomEvent("ob-navigate"))
  }, [])

  const go = useCallback(
    (next: string) => {
      history.pushState({}, "", next)
      setPath(next)
      announce()
    },
    [announce],
  )

  const replace = useCallback(
    (next: string) => {
      history.replaceState({}, "", next)
      setPath(next)
      announce()
    },
    [announce],
  )

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    const onPop = () => {
      setPath(location.pathname)
      announce()
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [announce])

  const tabs = useMemo(
    () => pluginTabs(pluginsState.plugins),
    [pluginsState.plugins],
  )
  const parsed = useMemo(() => parseRoute(path, tabs), [path, tabs])

  // Canonicalize legacy/unknown paths so the URL always names the active
  // destination (back/forward and reload then restore the same view).
  // On desktop, /config without a section resolves to the first one; on
  // phones it is the group list, so it stays.
  useEffect(() => {
    const target = parsed.redirect
      ? parsed.redirect
      : !mobile && parsed.route.view === "config" && parsed.route.tab === ""
        ? configPath("chat")
        : null
    if (!target || location.pathname === target) return
    replace(target)
  }, [parsed, mobile, replace])

  useEffect(() => {
    setNoticeFocus({ path })
  }, [path])

  const openReply = useCallback(
    (sessionId: string) => {
      openNotifiedThread(sessionId)
      go("/")
    },
    [go],
  )

  const activeKey = navActiveKey(parsed.route)

  if (!ready) {
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        spacing={2}
        sx={{ height: "100dvh" }}
        aria-busy="true"
      >
        <img
          src="/logo.png"
          alt=""
          width={40}
          height={40}
          style={{
            borderRadius: 8,
            animation: "ob-pulse 1.6s ease-in-out infinite",
          }}
        />
        <Box className="ob-skeleton" sx={{ width: 180, height: 10 }} />
        <output className="ob-sr-status">Loading open-bot</output>
      </Stack>
    )
  }
  if (!me) return <Login onLogin={setMe} />
  if (me.mustChangePassword) return <SetCredentials me={me} onSaved={setMe} />

  const pluginsViewStatus: PluginsViewStatus = {
    status: pluginsState.status,
    error: pluginsState.error,
    refreshing: pluginsState.refreshing,
    refresh: pluginsState.refresh,
  }

  const viewKey =
    parsed.route.view === "plugin"
      ? `plugin:${parsed.route.tab.key}`
      : parsed.route.view
  const workspaceTab: WorkspaceTab =
    parsed.route.view === "workspace" ? parsed.route.tab : "chat"

  const sidebar = (railMode: boolean, showCollapse = true) => (
    <>
      <Box className="ob-side-brand">
        <a
          className="ob-side-logo"
          href="/"
          aria-label="open-bot — go to chat"
          onClick={(event) => {
            event.preventDefault()
            go("/")
          }}
        >
          <img src="/logo.png" alt="" width={28} height={28} />
          {railMode ? null : (
            <Typography className="ob-side-name" component="span">
              open-bot
            </Typography>
          )}
        </a>
        {railMode || !showCollapse ? null : (
          <IconButton
            size="small"
            aria-label="Collapse navigation"
            aria-expanded={!railMode}
            onClick={() => setRailPersisted(true)}
            sx={{ ml: "auto" }}
          >
            <ChevronRightIcon
              width={18}
              height={18}
              style={{ transform: "rotate(180deg)" }}
            />
          </IconButton>
        )}
      </Box>
      <nav className="ob-side-nav" aria-label="Main">
        {NAV_ENTRIES.filter(
          (entry) => entry.roles !== "admin" || me.role === "admin",
        ).map((entry) => (
          <NavLink
            key={entry.view}
            entry={entry}
            rail={railMode}
            active={activeKey === entry.view}
            badge={
              entry.view === "apps" && tabs.length > 0 ? tabs.length : undefined
            }
            onGo={(next) => {
              go(next)
              setNavOpen(false)
            }}
          />
        ))}
      </nav>
      {railMode ? null : parsed.route.view === "config" ? (
        <ConfigCategories
          active={parsed.route.view === "config" ? parsed.route.tab : ""}
          onGo={(next) => {
            go(next)
            setNavOpen(false)
          }}
        />
      ) : (
        <Box className="ob-side-context" sx={{ flex: 1 }} aria-hidden />
      )}
      <Box className="ob-side-account">
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ width: "100%" }}
        >
          <SoundBell />
          <NoticeBell />
          <span style={{ flex: 1 }} />
          <Tip title={mode === "dark" ? "Light mode" : "Dark mode"}>
            <IconButton
              size="small"
              aria-label={
                mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
              onClick={toggle}
            >
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tip>
          <Tip title="Account">
            <IconButton
              ref={accountButton}
              size="small"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <MenuIcon />
            </IconButton>
          </Tip>
        </Stack>
        {railMode ? null : (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ width: "100%", mt: 0.75 }}
          >
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {me.email}
            </Typography>
            {me.role === "admin" ? (
              <Chip size="small" variant="outlined">
                admin
              </Chip>
            ) : null}
          </Stack>
        )}
      </Box>
    </>
  )

  const content = (() => {
    if (parsed.route.view === "admin") {
      return me.role === "admin" ? (
        <Admin meId={me.id} />
      ) : (
        <Box className="ob-scroll" sx={{ p: 2 }}>
          <Alert severity="error">Admin only</Alert>
        </Box>
      )
    }
    if (parsed.route.view === "apps")
      return <PluginAppsView tabs={tabs} status={pluginsViewStatus} />
    if (parsed.route.view === "plugin")
      return <PluginTabView key={parsed.route.tab.key} tab={parsed.route.tab} />
    if (parsed.route.view === "automations")
      return (
        <Box className="ob-scroll ob-view-enter">
          <Stack
            spacing={2}
            sx={{ p: 2, maxWidth: 1200, width: "100%", mx: "auto" }}
          >
            <Stack spacing={0.25}>
              <Typography variant="h6">Automations</Typography>
              <Typography variant="body2" color="textSecondary">
                Scheduled jobs the desktop agent runs for you — the same cron
                engine as before, with its own door now.
              </Typography>
            </Stack>
            <CronView me={me} />
          </Stack>
        </Box>
      )
    if (parsed.route.view === "config")
      return (
        <Config
          me={me}
          tab={parsed.route.tab}
          onTab={(next) => go(configPath(next))}
          onChanged={() => {
            void api<Me>("/api/me")
              .then(setMe)
              .catch(() => {})
          }}
        />
      )
    return (
      <Workspace
        me={me}
        tab={workspaceTab}
        onTab={(next) => go(workspacePath(next))}
        onOpenNav={mobile ? () => setNavOpen(true) : undefined}
      />
    )
  })()

  return (
    <Box className="ob-shell">
      {/* Workspace views carry their own bar with the menu button (it opens
          this nav drawer through onOpenNav); other views get a slim bar. */}
      {mobile && parsed.route.view !== "workspace" ? (
        <Box className="ob-mobile-global-bar">
          <IconButton
            size="small"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="subtitle2"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {parsed.route.view === "apps"
              ? "Apps"
              : parsed.route.view === "config"
                ? "Settings"
                : parsed.route.view === "admin"
                  ? "Admin"
                  : parsed.route.view === "automations"
                    ? "Automations"
                    : parsed.route.view === "plugin"
                      ? parsed.route.tab.title
                      : workspaceTab === "chat"
                        ? "open-bot"
                        : workspaceTab === "desktop"
                          ? "Desktop"
                          : workspaceTab === "projects"
                            ? "Projects"
                            : "Media"}
          </Typography>
          <SoundBell />
          <NoticeBell />
        </Box>
      ) : null}
      <Box className="ob-shell-body">
        {mobile ? null : (
          <aside
            className={`ob-sidebar${rail ? " ob-rail" : ""}`}
            aria-label="Sidebar"
          >
            {sidebar(rail)}
            {rail ? (
              <IconButton
                size="small"
                aria-label="Expand navigation"
                aria-expanded={false}
                onClick={() => setRailPersisted(false)}
                sx={{ position: "absolute", top: 8, right: 4 }}
              >
                <ChevronRightIcon width={18} height={18} />
              </IconButton>
            ) : null}
          </aside>
        )}
        <main className="ob-content" key={viewKey}>
          {content}
        </main>
      </Box>

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        variant="temporary"
        anchor="left"
        width={300}
      >
        <Box
          sx={{
            p: 1.25,
            display: "flex",
            flexDirection: "column",
            minHeight: "100%",
            boxSizing: "border-box",
          }}
        >
          {sidebar(false, false)}
        </Box>
      </Drawer>

      <Menu
        open={accountOpen}
        anchorEl={accountButton}
        onClose={() => {
          setAccountOpen(false)
          accountButton.current?.focus()
        }}
      >
        <Box sx={{ px: 1.5, pt: 1, maxWidth: 240 }}>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me.email}
          </Typography>
        </Box>
        <Divider sx={{ my: 0.5 }} />
        <Button
          variant="text"
          startIcon={mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          onClick={() => {
            toggle()
            setAccountOpen(false)
          }}
          sx={{ width: "100%", justifyContent: "flex-start" }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </Button>
        <Button
          variant="text"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => {
            setAccountOpen(false)
            void api("/api/auth/logout", { method: "POST" }).then(() =>
              setMe(null),
            )
          }}
          sx={{ width: "100%", justifyContent: "flex-start" }}
        >
          Log out
        </Button>
      </Menu>

      <AgentNotices onOpen={openReply} />

      <ResetApprovals />
    </Box>
  )
}
