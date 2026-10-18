import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
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
import { Chip } from "./chip"
import { dirtyForms } from "./dirty-form"
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
import { PluginsProvider, usePlugins } from "./plugin-ui"
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
  if (route.view === "plugin" || route.view === "plugin-pending") return "apps"
  return route.view
}

/** Collapsed-rail preference. Persisted; resize never overwrites the choice. */
function useRailPreference() {
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem(NAV_RAIL_KEY) === "1"
    } catch {
      return false
    }
  })
  const setRailPersisted = useCallback((next: boolean) => {
    setRail(next)
    try {
      localStorage.setItem(NAV_RAIL_KEY, next ? "1" : "0")
    } catch {
      // session-only collapse is fine
    }
  }, [])
  return { rail, setRailPersisted }
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

  const announce = useCallback(() => {
    window.dispatchEvent(new CustomEvent("ob-navigate"))
  }, [])

  // Internal navigation guards forms with unsaved changes. beforeunload only
  // covers tab close/refresh — pushState and popstate come through here.
  const confirmDirty = useCallback(() => {
    if (!dirtyForms.hasDirty()) return true
    return window.confirm("You have unsaved changes. Leave this page anyway?")
  }, [])

  const go = useCallback(
    (next: string) => {
      if (next !== location.pathname && !confirmDirty()) return
      history.pushState({}, "", next)
      setPath(next)
      announce()
    },
    [announce, confirmDirty],
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
      if (!confirmDirty()) {
        // Undo the pop: pin the entry back so the view does not change.
        history.pushState({}, "", path)
        return
      }
      setPath(location.pathname)
      announce()
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [announce, confirmDirty, path])

  useEffect(() => {
    setNoticeFocus({ path })
  }, [path])

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

  // One shared, authenticated plugin list for the whole shell: the Apps view,
  // Settings → Plugins, Endpoints, and the chat composer all read this same
  // account-scoped state instead of each fetching (or not fetching) on their
  // own.
  return (
    <PluginsProvider active={Boolean(me)} identity={me.id}>
      <Shell
        me={me}
        setMe={setMe}
        path={path}
        mobile={mobile}
        go={go}
        replace={replace}
        onToggleTheme={toggle}
        themeMode={mode}
      />
    </PluginsProvider>
  )
}

function Shell({
  me,
  setMe,
  path,
  mobile,
  go,
  replace,
  onToggleTheme,
  themeMode: mode,
}: {
  me: Me
  setMe: (me: Me | null) => void
  path: string
  mobile: boolean
  go: (next: string) => void
  replace: (next: string) => void
  onToggleTheme: () => void
  themeMode: "dark" | "light"
}) {
  const pluginsState = usePlugins()
  const [navOpen, setNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountButton = useRef<HTMLButtonElement | null>(null)
  const { rail, setRailPersisted } = useRailPreference()
  const navTriggerRef = useRef<HTMLButtonElement | null>(null)
  const navDrawerRef = useRef<HTMLDivElement | null>(null)

  const tabs = useMemo(
    () => pluginTabs(pluginsState.plugins),
    [pluginsState.plugins],
  )
  // While the install list has never loaded (first fetch in flight), a
  // plugin-shaped URL stays pending instead of being redirected to chat.
  // Once loading settles — success, empty, or error — the route is decided
  // for real; a network error then falls back cleanly like any unknown path.
  const parsed = useMemo(
    () =>
      parseRoute(path, tabs, {
        awaitingPlugins: pluginsState.status === "loading",
      }),
    [path, tabs, pluginsState.status],
  )

  // Canonicalize legacy/unknown paths so the URL always names the active
  // destination (back/forward and reload then restore the same view).
  // On desktop, /config without a section resolves to the first one; on
  // phones it is the group list, so it stays. Pending plugin routes hold
  // their URL until the tabs arrive.
  useEffect(() => {
    const target = parsed.redirect
      ? parsed.redirect
      : !mobile && parsed.route.view === "config" && parsed.route.tab === ""
        ? configPath("chat")
        : null
    if (!target || location.pathname === target) return
    replace(target)
  }, [parsed, mobile, replace])

  const openReply = useCallback(
    (sessionId: string) => {
      openNotifiedThread(sessionId)
      go("/")
    },
    [go],
  )

  const activeKey = navActiveKey(parsed.route)

  // The nav drawer is a temporary overlay: Escape closes it, focus moves in
  // on open and returns to the trigger on close.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false)
    }
    window.addEventListener("keydown", onKey)
    const focusTimer = window.setTimeout(() => {
      navDrawerRef.current?.focus()
    }, 0)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.clearTimeout(focusTimer)
      navTriggerRef.current?.focus()
    }
  }, [navOpen])

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
      {railMode ? (
        // Collapsed rail: Settings categories cannot fit, so they stay one
        // explicit tap away — the nav drawer renders the full sidebar
        // (categories included) while Settings is open.
        parsed.route.view === "config" ? (
          <Box className="ob-side-context" sx={{ flex: 1 }}>
            <Tip title="Settings sections" placement="right">
              <IconButton
                size="small"
                aria-label="Open Settings sections"
                aria-haspopup="dialog"
                onClick={() => setNavOpen(true)}
              >
                <SettingsIcon />
              </IconButton>
            </Tip>
          </Box>
        ) : (
          <Box className="ob-side-context" sx={{ flex: 1 }} aria-hidden />
        )
      ) : parsed.route.view === "config" ? (
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
      {/* Account cluster: a row in the expanded sidebar, a vertical stack in
          the 64px rail so every control stays inside the column. */}
      <Box className="ob-side-account">
        <Stack
          direction={railMode ? "column" : "row"}
          spacing={0.5}
          alignItems="center"
          sx={{ width: "100%" }}
        >
          <SoundBell />
          <NoticeBell />
          {railMode ? null : <span style={{ flex: 1 }} />}
          <Tip
            title={mode === "dark" ? "Light mode" : "Dark mode"}
            placement={railMode ? "right" : "top"}
          >
            <IconButton
              size="small"
              aria-label={
                mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
              onClick={onToggleTheme}
            >
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tip>
          <Tip title="Account" placement={railMode ? "right" : "top"}>
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
    if (parsed.route.view === "plugin-pending") {
      // The URL may name a plugin page; the install list is still loading.
      // Hold this view — no redirect, no fake empty — until tabs resolve.
      return (
        <Box
          sx={{ height: "100%", p: 2, boxSizing: "border-box" }}
          aria-busy="true"
        >
          <Stack spacing={2} sx={{ maxWidth: 640 }}>
            <Box className="ob-skeleton" sx={{ height: 24, width: 220 }} />
            <Box
              className="ob-skeleton"
              sx={{ height: 200, borderRadius: "12px" }}
            />
            <output className="ob-sr-status">Loading app</output>
          </Stack>
        </Box>
      )
    }
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
                Scheduled jobs the desktop agent runs for you — create one,
                pause it, or read what it did.
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
            ref={navTriggerRef}
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
                      : parsed.route.view === "plugin-pending"
                        ? "Apps"
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
          ref={navDrawerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          sx={{
            p: 1.25,
            display: "flex",
            flexDirection: "column",
            minHeight: "100%",
            boxSizing: "border-box",
            outline: "none",
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
            onToggleTheme()
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
