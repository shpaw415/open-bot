import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Drawer from "@shpaw415/mui-lite/Drawer"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Admin } from "./Admin"
import { AgentNotices } from "./AgentNotices"
import { AppHeader } from "./AppHeader"
import { api, type Me } from "./api"
import { Config } from "./Config"
import { CronView } from "./CronView"
import { Dashboard } from "./Dashboard"
import { clearComposerSeed, setComposerSeed } from "./dashboard-data"
import { useOverlayA11y } from "./dialog-a11y"
import { dirtyForms } from "./dirty-form"
import { Help } from "./Help"
import { useMobile } from "./hooks"
import {
  AdminPanelSettingsIcon,
  AppsIcon,
  ChatIcon,
  FolderIcon,
  HelpIcon,
  HomeIcon,
  PhotoLibraryIcon,
  RefreshIcon,
  ScheduleIcon,
  SettingsIcon,
} from "./icons"
import { Login, SetCredentials } from "./Login"
import { createPopGuard } from "./nav-guard"
import { clearNotices, markNoticesForSession } from "./notices"
import { openNotifiedThread, setNoticeFocus } from "./notify"
import {
  PluginAppsView,
  type PluginsViewStatus,
  pluginTabs,
} from "./plugin-tabs"
import { PluginsProvider, pluginsAwaitingRoute, usePlugins } from "./plugin-ui"
import { ResetApprovals } from "./ResetApprovals"
import {
  CHAT_PATH,
  CONFIG_GROUPS,
  CONFIG_TAB_LABELS,
  type ConfigTab,
  configPath,
  HELP_PATH,
  HOME_PATH,
  parseRoute,
  pluginPath,
  type WorkspaceTab,
  workspacePath,
} from "./routes"
import Stack from "./stack"
import { Tip } from "./Tip"
import { NAV } from "./texts"
import { useThemeMode } from "./theme"
import { Workspace } from "./Workspace"

const NAV_RAIL_KEY = "ob-nav-rail"

type NavEntry = {
  view: string
  path: string
  label: string
  icon: React.ReactNode
  roles?: "admin"
  /** Secondary zone (Settings, Help, Admin) sits under a divider. */
  secondary?: boolean
}

const NAV_ENTRIES: NavEntry[] = [
  { view: "home", path: HOME_PATH, label: NAV.home, icon: <HomeIcon /> },
  {
    view: "workspace:chat",
    path: CHAT_PATH,
    label: NAV.chat,
    icon: <ChatIcon />,
  },
  { view: "apps", path: "/apps", label: NAV.apps, icon: <AppsIcon /> },
  {
    view: "automations",
    path: "/automations",
    label: NAV.automations,
    icon: <ScheduleIcon />,
  },
  {
    view: "workspace:projects",
    path: "/projects",
    label: NAV.projects,
    icon: <FolderIcon />,
  },
  {
    view: "workspace:media",
    path: "/media",
    label: NAV.media,
    icon: <PhotoLibraryIcon />,
  },
  {
    view: "config",
    path: "/config",
    label: NAV.settings,
    icon: <SettingsIcon />,
    secondary: true,
  },
  {
    view: "help",
    path: HELP_PATH,
    label: NAV.help,
    icon: <HelpIcon />,
    secondary: true,
  },
  {
    view: "admin",
    path: "/admin",
    label: NAV.admin,
    icon: <AdminPanelSettingsIcon />,
    roles: "admin",
    secondary: true,
  },
]

function navActiveKey(route: ReturnType<typeof parseRoute>["route"]): string {
  if (route.view === "home") return "home"
  if (route.view === "help") return "help"
  if (route.view === "workspace") return `workspace:${route.tab}`
  if (route.view === "plugin" || route.view === "plugin-pending") return "apps"
  if (route.view === "not-found") return ""
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

  // The shell tags every history entry with a monotonic id (`ob`, identity)
  // and its traversal position in the stack (`obPos`) so the pop guard knows
  // a pop's direction and distance and can restore the exact entry — exact
  // even after a push truncates the Forward branch, where ids stop being
  // contiguous. See nav-guard.ts. Foreign state fields ride along untouched.
  const popGuardRef = useRef<ReturnType<typeof createPopGuard> | null>(null)
  const posRef = useRef(0)
  const announceRef = useRef(announce)
  const confirmDirtyRef = useRef(confirmDirty)
  confirmDirtyRef.current = confirmDirty
  const pathRef = useRef(path)
  pathRef.current = path

  const go = useCallback((next: string) => {
    if (next !== location.pathname && !confirmDirtyRef.current()) return
    const pos = posRef.current + 1
    const id = popGuardRef.current?.tagPush(pos) ?? 0
    posRef.current = pos
    history.pushState({ ob: id, obPos: pos }, "", next)
    setPath(next)
    announceRef.current()
  }, [])

  const replace = useCallback((next: string) => {
    const id = popGuardRef.current?.tagReplace(posRef.current) ?? 0
    history.replaceState(
      { ...history.state, ob: id, obPos: posRef.current },
      "",
      next,
    )
    setPath(next)
    announceRef.current()
  }, [])

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true))
  }, [])

  // Tab close/refresh guard for every registered form (shell-level, so
  // thinking effort, public origin and future sections are covered by the
  // same rule as the sections that used to carry a private listener).
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirtyForms.hasDirty()) event.preventDefault()
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [])

  // Internal navigation guards forms with unsaved changes; a canceled pop
  // re-enters the current entry in the opposite direction of the pop
  // (forward() after Back, back() after Forward) so the exact guarded entry
  // is restored and no stack is truncated — see nav-guard.ts.
  useEffect(() => {
    const guard = createPopGuard(
      {
        locationPath: () => location.pathname,
        go: (delta) => history.go(delta),
        forward: () => history.forward(),
        // The settle fallback rebuilds the guarded entry — tag it like a
        // shell push so position tracking stays exact afterwards.
        pushState: (next) => {
          const pos = posRef.current + 1
          const id = popGuardRef.current?.tagPush(pos) ?? 0
          posRef.current = pos
          history.pushState({ ob: id, obPos: pos }, "", next)
        },
      },
      {
        isBlocked: () => dirtyForms.hasDirty(),
        confirmLeave: () => confirmDirtyRef.current(),
        getGuardedPath: () => pathRef.current,
      },
    )
    popGuardRef.current = guard
    const entryTags = (event: PopStateEvent) => {
      const state = event.state as { ob?: unknown; obPos?: unknown } | null
      return {
        id: state && typeof state.ob === "number" ? (state.ob as number) : null,
        pos:
          state && typeof state.obPos === "number"
            ? (state.obPos as number)
            : null,
      }
    }
    const onPop = (event: PopStateEvent) => {
      const tags = entryTags(event)
      if (tags.pos != null) posRef.current = tags.pos
      if (guard.onPop(tags.id, tags.pos)) return
      setPath(location.pathname)
      announceRef.current()
    }
    window.addEventListener("popstate", onPop)
    // Tag the entry this tab booted on (position 0) so later pops know
    // where they stand. The search string rides along — boot happens before
    // deep-linked views (?job=…) read the query, and stripping it here used
    // to erase the deep link before its consumer ever mounted.
    history.replaceState(
      { ...history.state, ob: guard.tagReplace(0), obPos: 0 },
      "",
      location.pathname + location.search,
    )
    return () => {
      window.removeEventListener("popstate", onPop)
      popGuardRef.current = null
      guard.reset()
    }
  }, [])

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
  const { rail, setRailPersisted } = useRailPreference()
  const navPaperRef = useRef<HTMLDivElement | null>(null)

  // The notice center is session- and account-scoped: a new sign-in must
  // start from an empty list, never the previous account's entries.
  useEffect(() => {
    if (!me.id) return
    clearNotices()
  }, [me.id])

  const tabs = useMemo(
    () => pluginTabs(pluginsState.plugins),
    [pluginsState.plugins],
  )
  // While the install list has never resolved (first fetch in flight, or a
  // first fetch that FAILED with nothing loaded — an error is not "absent"),
  // a plugin-shaped URL stays pending instead of being redirected to chat.
  // Once a request succeeds — even empty — the route is decided for real.
  const parsed = useMemo(
    () =>
      parseRoute(path, tabs, {
        awaitingPlugins: pluginsAwaitingRoute(pluginsState.status, tabs.length),
      }),
    [path, tabs, pluginsState.status],
  )

  // Canonicalize legacy alias paths so the URL always names the active
  // destination (back/forward and reload then restore the same view).
  // /config without a section is the goal-oriented summary on every size —
  // no automatic hop to a specific section anymore. Pending plugin routes
  // hold their URL until the tabs arrive.
  useEffect(() => {
    const target = parsed.redirect
    if (!target || location.pathname === target) return
    replace(target)
  }, [parsed, replace])

  const openReply = useCallback(
    (sessionId: string) => {
      // Read state agrees with the view: opening the thread clears its
      // notice, wherever the open came from.
      markNoticesForSession(sessionId)
      openNotifiedThread(sessionId)
      go(CHAT_PATH)
    },
    [go],
  )

  // "Nouvelle conversation" intent, owned by the shell (not by storage read
  // at a fragile Workspace mount): it survives Workspace remounts and
  // StrictMode's setup/cleanup cycles, and stays active until the user
  // explicitly opens a thread or the first send creates one. A voluntary
  // notification open clears it; a slow history load never can.
  const blankChatRef = useRef(false)
  const openNewThread = useCallback(
    (seed?: string) => {
      blankChatRef.current = true
      if (seed) setComposerSeed(seed)
      go(CHAT_PATH)
    },
    [go],
  )

  const logout = useCallback(() => {
    blankChatRef.current = false
    clearComposerSeed()
    void api("/api/auth/logout", { method: "POST" }).then(() => setMe(null))
  }, [setMe])

  const activeKey = navActiveKey(parsed.route)

  // The nav drawer is a temporary overlay sharing the app-wide overlay
  // contract: Escape closes, focus enters the paper and returns to the exact
  // trigger (header hamburger, rail Settings button…) on close, Tab stays
  // confined. The Drawer's Paper already carries role="dialog".
  useOverlayA11y(
    navOpen,
    useCallback(() => setNavOpen(false), []),
    navPaperRef,
  )

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

  const pageContext = (() => {
    if (parsed.route.view === "home") return NAV.home
    if (parsed.route.view === "help") return NAV.help
    if (parsed.route.view === "workspace")
      return {
        chat: NAV.chat,
        desktop: "Bureau",
        projects: NAV.projects,
        media: NAV.media,
      }[parsed.route.tab]
    if (parsed.route.view === "apps" || parsed.route.view === "plugin-pending")
      return NAV.apps
    if (parsed.route.view === "plugin") return parsed.route.tab.title
    if (parsed.route.view === "automations") return NAV.automations
    if (parsed.route.view === "admin") return NAV.admin
    if (parsed.route.view === "config")
      return parsed.route.tab
        ? `${NAV.settings} · ${CONFIG_TAB_LABELS[parsed.route.tab]}`
        : NAV.settings
    return ""
  })()

  // The tab title names the screen — reload and history read like the app.
  useEffect(() => {
    document.title = pageContext ? `${pageContext} · open-bot` : "open-bot"
  }, [pageContext])

  // Explicit navigation (go, replace, Back/Forward) moves focus to the
  // content so keyboard and screen-reader users land inside the new view
  // instead of on a stale nav link. Real-time events and in-view state
  // changes never re-path, so they never steal focus. The very first render
  // keeps the browser's default focus position.
  const firstPathRef = useRef(true)
  // Refs only; the trigger is the path itself, not a reactive value inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs only
  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false
      return
    }
    document.getElementById("ob-main")?.focus({ preventScroll: true })
  }, [path])

  const sidebar = (railMode: boolean) => (
    <>
      <nav className="ob-side-nav" aria-label="Main">
        {NAV_ENTRIES.filter((entry) => !entry.secondary).map((entry) => (
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
        <Box Element="hr" className="ob-nav-divider" />
        {NAV_ENTRIES.filter(
          (entry) =>
            entry.secondary && (entry.roles !== "admin" || me.role === "admin"),
        ).map((entry) => (
          <NavLink
            key={entry.view}
            entry={entry}
            rail={railMode}
            active={activeKey === entry.view}
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
    </>
  )

  const content = (() => {
    if (parsed.route.view === "admin") {
      return me.role === "admin" ? (
        <Admin meId={me.id} />
      ) : (
        <Box className="ob-scroll" sx={{ p: 2 }}>
          <Alert severity="error">Administration réservée aux admins</Alert>
        </Box>
      )
    }
    if (parsed.route.view === "home")
      return (
        <Dashboard
          me={me}
          tabs={tabs}
          go={go}
          onOpenThread={openReply}
          onNewThread={openNewThread}
        />
      )
    if (parsed.route.view === "help")
      return <Help go={go} onNewThread={openNewThread} />
    if (parsed.route.view === "not-found") {
      return (
        <Box className="ob-scroll ob-view-enter" sx={{ flex: 1, minHeight: 0 }}>
          <Stack
            spacing={2}
            sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 640, mx: "auto" }}
          >
            <Typography variant="h5" component="h1">
              Cette page n’est pas disponible
            </Typography>
            <Typography variant="body2" color="textSecondary">
              L’adresse <Box Element="code">{parsed.route.path}</Box> ne
              correspond à aucune page. Le lien est peut-être ancien, ou
              l’application a été désinstallée.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button variant="contained" onClick={() => go(HOME_PATH)}>
                {NAV.home}
              </Button>
              <Button variant="outlined" onClick={() => go("/apps")}>
                {NAV.apps}
              </Button>
              <Button variant="text" onClick={() => history.back()}>
                Retour
              </Button>
            </Stack>
          </Stack>
        </Box>
      )
    }
    // One view for both routes: /apps (no selection) and /<pluginId>:<tabId>
    // (an open app). The selection lives in the URL, so the side list, the
    // document title, reload and Back/Forward all agree — picking an app in
    // the list, a Home shortcut and a search hit land on the same page.
    if (parsed.route.view === "apps" || parsed.route.view === "plugin")
      return (
        <PluginAppsView
          tabs={tabs}
          status={pluginsViewStatus}
          selectedKey={
            parsed.route.view === "plugin" ? parsed.route.tab.key : ""
          }
          onOpen={(tab) => go(pluginPath(tab))}
          onClose={() => go("/apps")}
          onAddPlugin={() => go("/config/plugins")}
          onManagePlugins={() => go("/config/plugins")}
        />
      )
    if (parsed.route.view === "plugin-pending") {
      // The URL may name a plugin page. While the install list is in flight
      // the view is a skeleton; if the first load failed, the URL is held
      // with a real error and a retry — never a silent redirect to chat.
      if (pluginsState.status === "error" && tabs.length === 0) {
        return (
          <Box className="ob-scroll" sx={{ p: 2 }}>
            <Stack spacing={2} sx={{ maxWidth: 640, mx: "auto", pt: 4 }}>
              <Alert severity="error">
                <Typography variant="subtitle2" component="h1">
                  Apps could not load
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {pluginsState.error || "The install list is unreachable."}
                </Typography>
              </Alert>
              <Box>
                <Button
                  variant="contained"
                  startIcon={<RefreshIcon width={18} height={18} />}
                  onClick={() => void pluginsState.refresh()}
                >
                  Retry
                </Button>
              </Box>
              <output className="ob-sr-status">
                Loading apps failed — retry available
              </output>
            </Stack>
          </Box>
        )
      }
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
              <Typography variant="h6" component="h1">
                {NAV.automations}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Des tâches exécutées par l’assistant selon un horaire — créez-en
                une, mettez-la en pause, ou consultez son résultat.
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
        onMeRefreshed={setMe}
        blankChatRef={blankChatRef}
      />
    )
  })()

  return (
    <Box className="ob-shell">
      {/* One permanent shell header for every authenticated view: brand,
          nav control, page context on the left; Profile · Theme ·
          Notifications · Search on the right (in that exact order). */}
      <AppHeader
        me={me}
        mobile={mobile}
        pageContext={pageContext}
        themeMode={mode}
        onToggleTheme={onToggleTheme}
        onToggleNav={() => {
          if (mobile) setNavOpen(true)
          else setRailPersisted(!rail)
        }}
        navCollapsed={mobile ? undefined : rail}
        appTabs={tabs}
        onOpenThread={openReply}
        onNewThread={() => openNewThread()}
        go={go}
        onLogout={logout}
      />
      <Box className="ob-shell-body">
        {mobile ? null : (
          <aside
            className={`ob-sidebar${rail ? " ob-rail" : ""}`}
            aria-label="Sidebar"
          >
            {sidebar(rail)}
          </aside>
        )}
        {/* Keyboard escape hatch: first tab stop lands past the chrome. */}
        <a href="#ob-main" className="ob-skip-link">
          Aller au contenu
        </a>
        {/* biome-ignore lint/correctness/useUniqueElementIds: the skip link href must name the same static anchor */}
        <main className="ob-content" key={viewKey} id="ob-main" tabIndex={-1}>
          {content}
        </main>
      </Box>

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        variant="temporary"
        anchor="left"
        width={300}
        ref={navPaperRef}
        aria-label="Navigation"
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
          {sidebar(false)}
        </Box>
      </Drawer>

      <AgentNotices onOpen={openReply} />

      <ResetApprovals />
    </Box>
  )
}
