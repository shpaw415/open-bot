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
import {
  backNav,
  installShellHost,
  layersOf,
  type PaneNav,
  PaneNavContext,
  patchSearch,
  backOr as primaryBackOr,
  pushSearch as primaryPushSearch,
  searchParam,
  splitUrl,
  useLocationSearch,
} from "./back-nav"
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
  FullscreenIcon,
  HelpIcon,
  HomeIcon,
  PhotoLibraryIcon,
  RefreshIcon,
  ScheduleIcon,
  SettingsIcon,
  SwapHorizIcon,
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
  chatThreadPath,
  configPath,
  HELP_PATH,
  HOME_PATH,
  parseRoute,
  pluginPath,
  type Route,
  WORKSPACE_TABS,
  workspacePath,
} from "./routes"
import {
  buildSecondaryPaneNav,
  buildSplitUrl,
  clampSplitRatio,
  parseSplit,
  SPLIT_LAST_KEY,
  SPLIT_RATIO_KEY,
  stripSplit,
} from "./split"
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

/** Human name of a route (header context, document title, pane bar). */
function routeContext(route: Route): string {
  if (route.view === "home") return NAV.home
  if (route.view === "help") return NAV.help
  if (route.view === "workspace")
    return {
      chat: NAV.chat,
      desktop: "Bureau",
      projects: NAV.projects,
      media: NAV.media,
    }[route.tab]
  if (route.view === "apps" || route.view === "plugin-pending") return NAV.apps
  if (route.view === "plugin") return route.tab.title
  if (route.view === "automations") return NAV.automations
  if (route.view === "admin") return NAV.admin
  if (route.view === "config")
    return route.tab
      ? `${NAV.settings} · ${CONFIG_TAB_LABELS[route.tab]}`
      : NAV.settings
  return ""
}

/** Remount key per distinct view, so a pane swap rebuilds only that pane. */
function routeViewKey(route: Route): string {
  return route.view === "plugin" ? `plugin:${route.tab.key}` : route.view
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
  // Full rendered URL (pathname+search): pops compare against it to tell
  // layer dismissals and in-page (search) moves from page navigations.
  const urlRef = useRef(
    typeof location !== "undefined" ? location.pathname + location.search : "/",
  )
  // Dirty-guard suppression for pure layer pops (same full URL — only
  // history.state layers changed): the page and its forms stay mounted,
  // and a dialog-editor's own discard confirm runs through its onClose.
  // Search moves keep the guard: leaving the IDE (?id= removed) unmounts
  // a dirty editor even though the pathname stays /projects.
  const suppressDirtyRef = useRef(false)
  // Inner-scroller positions per history entry (the document itself never
  // scrolls in this shell, so the browser restores nothing on its own).
  const scrollByPosRef = useRef(new Map<number, number>())
  const saveScroll = useCallback(() => {
    const scroller = document.querySelector<HTMLElement>("#ob-main .ob-scroll")
    if (scroller) scrollByPosRef.current.set(posRef.current, scroller.scrollTop)
  }, [])
  const saveScrollRef = useRef(saveScroll)
  saveScrollRef.current = saveScroll

  // Exact navigation: push `next` (pathname+search) as a fresh page entry.
  // Back layers belong to the page being left, so they close silently
  // first and the new entry starts layer-free.
  const goExact = useCallback((next: string) => {
    const current = location.pathname + location.search
    if (next === current) return
    const { pathname } = splitUrl(next)
    if (pathname !== location.pathname && !confirmDirtyRef.current()) return
    saveScrollRef.current()
    backNav.closeAllSilently()
    const pos = posRef.current + 1
    const id = popGuardRef.current?.tagPush(pos) ?? 0
    posRef.current = pos
    history.pushState({ ob: id, obPos: pos, obLayers: [] }, "", next)
    backNav.syncEntry()
    urlRef.current = next
    document.documentElement.dataset.obNav = "forward"
    setPath(pathname)
    announceRef.current()
  }, [])

  // Shell-chrome navigation (nav items, CTAs): workspace destinations keep
  // the open thread (`?thread=`) when coming from another workspace tab,
  // so Chat → Desktop → Projects never drops the conversation context.
  // In-page state changes use goExact via pushSearch/backOr instead.
  const go = useCallback(
    (next: string) => {
      const target = splitUrl(next)
      const here = splitUrl(location.pathname + location.search)
      const workspacePaths = new Set(WORKSPACE_TABS.map(workspacePath))
      let url = next
      if (
        workspacePaths.has(target.pathname) &&
        workspacePaths.has(here.pathname) &&
        !searchParam(target.search, "thread")
      ) {
        const thread = searchParam(here.search, "thread")
        if (thread)
          url = target.pathname + patchSearch(target.search, { thread })
      }
      goExact(url)
    },
    [goExact],
  )

  const replace = useCallback((next: string) => {
    const { pathname } = splitUrl(next)
    const id = popGuardRef.current?.tagReplace(posRef.current) ?? 0
    history.replaceState(
      { ...history.state, ob: id, obPos: posRef.current },
      "",
      next,
    )
    urlRef.current = next
    setPath(pathname)
    announceRef.current()
  }, [])
  const goExactRef = useRef(goExact)
  goExactRef.current = goExact
  const replaceRef = useRef(replace)
  replaceRef.current = replace

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
  //
  // Back layers (back-nav.ts) ride the same stack: a pop onto the same
  // full URL only dismisses/reopens layers (Back = Escape for dialogs,
  // drawers, lightboxes…) and never prompts the dirty guard; in-page
  // search moves (thread, album, project…) sync from the URL through the
  // same accept path as page navigations, dirty guard included.
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
          history.pushState(
            { ob: id, obPos: pos, obLayers: backNav.openTokens() },
            "",
            next,
          )
          backNav.syncEntry()
        },
      },
      {
        isBlocked: () => !suppressDirtyRef.current && dirtyForms.hasDirty(),
        confirmLeave: () => confirmDirtyRef.current(),
        getGuardedPath: () => pathRef.current,
      },
    )
    popGuardRef.current = guard
    // The back-layer host: layer pushes/replaces get the same ob/obPos
    // tags as page pushes so guard position math stays exact; page moves
    // requested from inside views (pushSearch/backOr) come back through
    // goExact/replace so route state, scroll and focus stay shell-owned.
    const uninstallHost = installShellHost({
      getState: () => history.state,
      getUrl: () => location.pathname + location.search,
      push: (patch, url) => {
        const pos = posRef.current + 1
        const id = popGuardRef.current?.tagPush(pos) ?? 0
        posRef.current = pos
        history.pushState({ ob: id, obPos: pos, ...patch }, "", url)
        urlRef.current = url
      },
      replace: (patch, url) => {
        const id = popGuardRef.current?.tagReplace(posRef.current) ?? 0
        history.replaceState(
          { ...history.state, ob: id, obPos: posRef.current, ...patch },
          "",
          url,
        )
        urlRef.current = url
      },
      back: () => history.back(),
      go: (url) => goExactRef.current(url),
      replaceUrl: (url) => replaceRef.current(url),
      canGoBackInApp: () => posRef.current > 0,
    })
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
      const prevPos = posRef.current
      // Record the leaving entry's scroll before position tracking moves.
      const leaving = document.querySelector<HTMLElement>("#ob-main .ob-scroll")
      if (leaving) scrollByPosRef.current.set(prevPos, leaving.scrollTop)
      if (tags.pos != null) posRef.current = tags.pos
      suppressDirtyRef.current =
        urlRef.current === location.pathname + location.search
      const consumed = guard.onPop(tags.id, tags.pos)
      suppressDirtyRef.current = false
      if (consumed) return
      backNav.syncFromPop()
      const pathnameChanged =
        splitUrl(urlRef.current).pathname !== location.pathname
      urlRef.current = location.pathname + location.search
      document.documentElement.dataset.obNav =
        tags.pos != null && tags.pos > prevPos ? "forward" : "back"
      setPath(location.pathname)
      announceRef.current()
      // Restore the landed entry's inner scroll after the view paints —
      // page moves only; layer/search pops keep the live scroller put.
      const restore = pathnameChanged
        ? scrollByPosRef.current.get(posRef.current)
        : undefined
      if (restore != null) {
        requestAnimationFrame(() => {
          const scroller = document.querySelector<HTMLElement>(
            "#ob-main .ob-scroll",
          )
          if (scroller) scroller.scrollTop = restore
        })
      }
    }
    window.addEventListener("popstate", onPop)
    // The shell owns scroll positions (inner scrollers); the browser must
    // not also try to restore document scroll on traversal.
    try {
      history.scrollRestoration = "manual"
    } catch {
      // older engines: document never scrolls here anyway
    }
    // Tag the entry this tab booted on (position 0) so later pops know
    // where they stand. The search string rides along — boot happens before
    // deep-linked views (?job=…) read the query, and stripping it here used
    // to erase the deep link before its consumer ever mounted.
    history.replaceState(
      {
        ...history.state,
        ob: guard.tagReplace(0),
        obPos: 0,
        obLayers: layersOf(history.state),
      },
      "",
      location.pathname + location.search,
    )
    backNav.syncEntry()
    return () => {
      window.removeEventListener("popstate", onPop)
      uninstallHost()
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
        goExact={goExact}
        replace={replace}
        confirmDirty={confirmDirty}
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
  goExact,
  replace,
  confirmDirty,
  onToggleTheme,
  themeMode: mode,
}: {
  me: Me
  setMe: (me: Me | null) => void
  path: string
  mobile: boolean
  go: (next: string) => void
  goExact: (next: string) => void
  replace: (next: string) => void
  confirmDirty: () => boolean
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
    // Canonicalizing the pathname must not drop in-page state (?thread=…).
    replace(target.includes("?") ? target : target + location.search)
  }, [parsed, replace])

  // ---- Global split screen (split.ts) ------------------------------------
  // The second pane's URL rides in ?split= on the primary's address, so a
  // history entry names a pair and Back/Forward/reload restore both
  // panes. Navigation from shell chrome (sidebar, header search, notices)
  // targets the focused pane; each pane's own URL-state (?thread=,
  // ?album=…) stays inside its URL space through PaneNav.
  const locationSearch = useLocationSearch()
  const secondaryUrl = parseSplit(locationSearch)
  const splitOpen = secondaryUrl !== null
  const [focusPane, setFocusPane] = useState<1 | 2>(1)
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(SPLIT_RATIO_KEY)
      return clampSplitRatio(raw === null ? Number.NaN : Number(raw))
    } catch {
      return clampSplitRatio(Number.NaN)
    }
  })
  const splitRowRef = useRef<HTMLDivElement | null>(null)
  const splitRatioRef = useRef(splitRatio)
  splitRatioRef.current = splitRatio

  useEffect(() => {
    if (!splitOpen) setFocusPane(1)
  }, [splitOpen])

  // Reopening the split restores the last pairing on this device.
  useEffect(() => {
    if (!secondaryUrl) return
    try {
      localStorage.setItem(SPLIT_LAST_KEY, secondaryUrl)
    } catch {
      // session-only pairing is fine
    }
  }, [secondaryUrl])

  const secondaryParsed = useMemo(
    () =>
      secondaryUrl
        ? parseRoute(splitUrl(secondaryUrl).pathname, tabs, {
            awaitingPlugins: pluginsAwaitingRoute(
              pluginsState.status,
              tabs.length,
            ),
          })
        : null,
    [secondaryUrl, tabs, pluginsState.status],
  )
  const focusedParsed =
    splitOpen && focusPane === 2 && secondaryParsed ? secondaryParsed : parsed

  const currentFullUrl = () => location.pathname + location.search

  // Primary-pane navigation keeps the second pane attached.
  const primaryGo = useCallback(
    (next: string) => {
      const secondary = parseSplit(location.search)
      go(secondary ? buildSplitUrl(next, secondary) : next)
    },
    [go],
  )

  // Second-pane navigation: the shell `go` rules (the open thread rides
  // across workspace tabs) applied in the pane's own URL space, with the
  // dirty-form guard goExact cannot apply itself (the real pathname
  // does not change when only the second pane moves).
  const secondaryGo = useCallback(
    (next: string) => {
      const currentSecondary = parseSplit(location.search)
      if (!currentSecondary) {
        go(next)
        return
      }
      const target = splitUrl(next)
      const here = splitUrl(currentSecondary)
      const workspacePaths = new Set(WORKSPACE_TABS.map(workspacePath))
      let url = next
      if (
        workspacePaths.has(target.pathname) &&
        workspacePaths.has(here.pathname) &&
        !searchParam(target.search, "thread")
      ) {
        const thread = searchParam(here.search, "thread")
        if (thread)
          url = target.pathname + patchSearch(target.search, { thread })
      }
      if (splitUrl(url).pathname !== here.pathname && !confirmDirty()) return
      goExact(buildSplitUrl(location.pathname + location.search, url))
    },
    [go, goExact, confirmDirty],
  )

  const navGo = splitOpen && focusPane === 2 ? secondaryGo : primaryGo

  // Sidebar/header navigation: re-tapping the focused pane's current
  // destination is a no-op (app tab behavior), never a duplicate entry.
  const navTo = (next: string) => {
    const herePath =
      splitOpen && focusPane === 2 && secondaryUrl
        ? splitUrl(secondaryUrl).pathname
        : location.pathname
    if (splitUrl(next).pathname !== herePath) navGo(next)
  }

  const primaryPaneNav: PaneNav = {
    pathname: path,
    // Includes ?split= itself; consumers read only their own params and
    // patchSearch preserves the rest, so the pair stays attached.
    search: locationSearch,
    pushSearch: primaryPushSearch,
    backOr: primaryBackOr,
    active: !splitOpen || focusPane === 1,
  }
  const secondaryPaneNav: PaneNav | null = secondaryUrl
    ? buildSecondaryPaneNav(secondaryUrl, focusPane === 2, {
        getUrl: currentFullUrl,
        go: goExact,
        replace,
      })
    : null

  function openSplit() {
    let last = HOME_PATH
    try {
      last = localStorage.getItem(SPLIT_LAST_KEY) || HOME_PATH
    } catch {
      // default pairing is fine
    }
    setFocusPane(2)
    goExact(buildSplitUrl(currentFullUrl(), last))
  }

  /** Close the split, keeping `pane` as the single full-screen page. */
  function maximizePane(pane: 1 | 2) {
    const secondary = parseSplit(location.search)
    if (!secondary) return
    if (pane === 1) {
      // The real pathname stays, so goExact would skip its dirty guard
      // while the second pane (maybe a dirty editor) unmounts.
      if (!confirmDirty()) return
      goExact(stripSplit(currentFullUrl()))
    } else {
      goExact(secondary)
    }
  }

  function swapPanes() {
    const secondary = parseSplit(location.search)
    if (!secondary) return
    goExact(buildSplitUrl(secondary, stripSplit(currentFullUrl())))
    setFocusPane(focusPane === 1 ? 2 : 1)
  }

  function toggleSplit() {
    if (splitOpen) maximizePane(focusPane)
    else openSplit()
  }

  function onSplitDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const row = splitRowRef.current
    if (!row) return
    document.body.classList.add("ob-preview-dragging")
    const move = (next: PointerEvent) => {
      const rect = row.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = clampSplitRatio((next.clientX - rect.left) / rect.width)
      splitRatioRef.current = ratio
      setSplitRatio(ratio)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("ob-preview-dragging")
      try {
        localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatioRef.current))
      } catch {
        // session-only ratio is fine
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function nudgeSplit(delta: number) {
    const ratio = clampSplitRatio(splitRatioRef.current + delta)
    splitRatioRef.current = ratio
    setSplitRatio(ratio)
    try {
      localStorage.setItem(SPLIT_RATIO_KEY, String(ratio))
    } catch {
      // session-only ratio is fine
    }
  }

  const makeOpenReply =
    (pane: 1 | 2, paneGo: (next: string) => void) => (sessionId: string) => {
      // Read state agrees with the view: opening the thread clears its
      // notice, wherever the open came from. The thread rides the URL so
      // Back returns to wherever the user was before the notice.
      markNoticesForSession(sessionId)
      if (splitOpen) setFocusPane(pane)
      openNotifiedThread(sessionId)
      paneGo(chatThreadPath(sessionId))
    }

  // "Nouvelle conversation" intent, owned by the shell (not by storage read
  // at a fragile Workspace mount): it survives Workspace remounts and
  // StrictMode's setup/cleanup cycles, and stays active until the user
  // explicitly opens a thread or the first send creates one. A voluntary
  // notification open clears it; a slow history load never can. One ref
  // per pane so a split's two composers never share the intent.
  const blankChatRef = useRef(false)
  const blankChatRef2 = useRef(false)
  const makeOpenNewThread =
    (
      pane: 1 | 2,
      paneGo: (next: string) => void,
      blankRef: { current: boolean },
    ) =>
    (seed?: string) => {
      blankRef.current = true
      if (seed) setComposerSeed(seed)
      if (splitOpen) setFocusPane(pane)
      paneGo(CHAT_PATH)
    }

  const openReply = makeOpenReply(focusPane, navGo)
  const openNewThread = makeOpenNewThread(
    focusPane,
    navGo,
    focusPane === 2 && splitOpen ? blankChatRef2 : blankChatRef,
  )

  const logout = useCallback(() => {
    blankChatRef.current = false
    blankChatRef2.current = false
    clearComposerSeed()
    void api("/api/auth/logout", { method: "POST" }).then(() => setMe(null))
  }, [setMe])

  const activeKey = navActiveKey(focusedParsed.route)

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

  // The header names the focused pane; the tab title names the pair.
  const pageContext = routeContext(focusedParsed.route)
  const primaryContext = routeContext(parsed.route)
  const secondaryContext = secondaryParsed
    ? routeContext(secondaryParsed.route)
    : ""

  // The tab title names the screen — reload and history read like the app.
  useEffect(() => {
    const title =
      splitOpen && secondaryContext
        ? `${primaryContext} | ${secondaryContext}`
        : pageContext
    document.title = title ? `${title} · open-bot` : "open-bot"
  }, [pageContext, primaryContext, secondaryContext, splitOpen])

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
              // Re-tapping the destination already on screen is a no-op
              // (app tab behavior): it must not stack a duplicate history
              // entry or reset in-page state like the open thread. A
              // section entry (Settings) still navigates from a subsection.
              // In a split, "on screen" means the focused pane.
              navTo(next)
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
              navTo(next)
              setNavOpen(false)
            }}
          />
        ))}
      </nav>
      {railMode ? (
        // Collapsed rail: Settings categories cannot fit, so they stay one
        // explicit tap away — the nav drawer renders the full sidebar
        // (categories included) while Settings is open.
        focusedParsed.route.view === "config" ? (
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
      ) : focusedParsed.route.view === "config" ? (
        <ConfigCategories
          active={
            focusedParsed.route.view === "config" ? focusedParsed.route.tab : ""
          }
          onGo={(next) => {
            navGo(next)
            setNavOpen(false)
          }}
        />
      ) : (
        <Box className="ob-side-context" sx={{ flex: 1 }} aria-hidden />
      )}
    </>
  )

  // One renderer for every route, bound to a pane's own navigation: the
  // primary pane renders the real address, the second pane renders the
  // decoded ?split= URL, and every link inside stays in its pane.
  const renderRoute = (
    route: Route,
    paneGo: (next: string) => void,
    paneOpenReply: (sessionId: string) => void,
    paneOpenNewThread: (seed?: string) => void,
    paneBlankRef: { current: boolean },
  ) => {
    if (route.view === "admin") {
      return me.role === "admin" ? (
        <Admin meId={me.id} />
      ) : (
        <Box className="ob-scroll" sx={{ p: 2 }}>
          <Alert severity="error">Administration réservée aux admins</Alert>
        </Box>
      )
    }
    if (route.view === "home")
      return (
        <Dashboard
          me={me}
          tabs={tabs}
          go={paneGo}
          onOpenThread={paneOpenReply}
          onNewThread={paneOpenNewThread}
        />
      )
    if (route.view === "help")
      return <Help go={paneGo} onNewThread={paneOpenNewThread} />
    if (route.view === "not-found") {
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
              L’adresse <Box Element="code">{route.path}</Box> ne correspond à
              aucune page. Le lien est peut-être ancien, ou l’application a été
              désinstallée.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button variant="contained" onClick={() => paneGo(HOME_PATH)}>
                {NAV.home}
              </Button>
              <Button variant="outlined" onClick={() => paneGo("/apps")}>
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
    // One view for both routes: /apps (the launcher) and /<pluginId>:<tabId>
    // (an open app). The selection lives in the URL, so the launcher, the
    // document title, reload and Back/Forward all agree — picking a tile, a
    // Home shortcut and a search hit land on the same page.
    if (route.view === "apps" || route.view === "plugin")
      return (
        <PluginAppsView
          tabs={tabs}
          status={pluginsViewStatus}
          selectedKey={route.view === "plugin" ? route.tab.key : ""}
          onOpen={(tab) => paneGo(pluginPath(tab))}
          onClose={() => paneGo("/apps")}
          onAddPlugin={() => paneGo("/config/plugins")}
          onManagePlugins={() => paneGo("/config/plugins")}
        />
      )
    if (route.view === "plugin-pending") {
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
    if (route.view === "automations")
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
            <CronView me={me} onOpenThread={paneOpenReply} />
          </Stack>
        </Box>
      )
    if (route.view === "config")
      return (
        <Config
          me={me}
          tab={route.tab}
          onTab={(next) => paneGo(configPath(next))}
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
        tab={route.view === "workspace" ? route.tab : "chat"}
        onTab={(next) => paneGo(workspacePath(next))}
        onMeRefreshed={setMe}
        blankChatRef={paneBlankRef}
      />
    )
  }

  const primaryContent = renderRoute(
    parsed.route,
    primaryGo,
    makeOpenReply(1, primaryGo),
    makeOpenNewThread(1, primaryGo, blankChatRef),
    blankChatRef,
  )
  const secondaryContent =
    secondaryParsed && splitOpen
      ? renderRoute(
          secondaryParsed.route,
          secondaryGo,
          makeOpenReply(2, secondaryGo),
          makeOpenNewThread(2, secondaryGo, blankChatRef2),
          blankChatRef2,
        )
      : null

  const paneBar = (pane: 1 | 2, title: string) => (
    <Box className="ob-split-bar">
      <Typography variant="caption" className="ob-split-title">
        {title || "open-bot"}
      </Typography>
      <Tip title="Échanger les panneaux" placement="bottom">
        <IconButton
          size="small"
          aria-label="Échanger les panneaux"
          onClick={swapPanes}
        >
          <SwapHorizIcon width={16} height={16} />
        </IconButton>
      </Tip>
      <Tip title="Afficher ce panneau en plein écran" placement="bottom">
        <IconButton
          size="small"
          aria-label={`Afficher ${title || "ce panneau"} en plein écran`}
          onClick={() => maximizePane(pane)}
        >
          <FullscreenIcon width={16} height={16} />
        </IconButton>
      </Tip>
    </Box>
  )

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
        go={navGo}
        onLogout={logout}
        splitOpen={splitOpen}
        onToggleSplit={toggleSplit}
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
        <div className="ob-split-col">
          {splitOpen && mobile ? (
            // biome-ignore lint/a11y/useSemanticElements: a labelled switcher group, not form controls — fieldset would misdescribe it
            <div
              className="ob-split-switcher"
              role="group"
              aria-label="Écran partagé"
            >
              {(
                [
                  [1, primaryContext],
                  [2, secondaryContext],
                ] as const
              ).map(([pane, title]) => (
                <button
                  key={pane}
                  type="button"
                  className="ob-split-switch"
                  aria-pressed={focusPane === pane}
                  onClick={() => setFocusPane(pane)}
                >
                  {title || "open-bot"}
                </button>
              ))}
            </div>
          ) : null}
          <div className="ob-split-row" ref={splitRowRef}>
            <section
              className="ob-split-pane"
              data-focused={splitOpen && focusPane === 1 ? "true" : undefined}
              aria-label={
                splitOpen ? `Panneau 1 : ${primaryContext}` : undefined
              }
              hidden={splitOpen && mobile && focusPane !== 1}
              style={
                splitOpen && !mobile
                  ? { flexBasis: `${splitRatio * 100}%` }
                  : undefined
              }
              onPointerDownCapture={() => {
                if (splitOpen && focusPane !== 1) setFocusPane(1)
              }}
              onFocusCapture={() => {
                if (splitOpen && focusPane !== 1) setFocusPane(1)
              }}
            >
              {splitOpen ? paneBar(1, primaryContext) : null}
              {/* biome-ignore lint/correctness/useUniqueElementIds: the skip link href must name the same static anchor */}
              <main
                className="ob-content"
                key={routeViewKey(parsed.route)}
                id="ob-main"
                tabIndex={-1}
              >
                <PaneNavContext.Provider value={primaryPaneNav}>
                  {primaryContent}
                </PaneNavContext.Provider>
              </main>
            </section>
            {splitOpen && !mobile ? (
              // biome-ignore lint/a11y/useSemanticElements: interactive window splitter (focusable separator carrying valuenow), not a thematic break
              <div
                className="ob-split-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionner les panneaux"
                aria-valuemin={25}
                aria-valuemax={75}
                aria-valuenow={Math.round(splitRatio * 100)}
                tabIndex={0}
                onPointerDown={onSplitDrag}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    nudgeSplit(-0.02)
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault()
                    nudgeSplit(0.02)
                  }
                }}
              />
            ) : null}
            {splitOpen && secondaryPaneNav ? (
              <section
                className="ob-split-pane"
                data-focused={focusPane === 2 ? "true" : undefined}
                aria-label={`Panneau 2 : ${secondaryContext}`}
                hidden={mobile && focusPane !== 2}
                style={
                  !mobile
                    ? { flexBasis: `${(1 - splitRatio) * 100}%` }
                    : undefined
                }
                onPointerDownCapture={() => {
                  if (focusPane !== 2) setFocusPane(2)
                }}
                onFocusCapture={() => {
                  if (focusPane !== 2) setFocusPane(2)
                }}
              >
                {paneBar(2, secondaryContext)}
                {/* The primary pane owns the <main> landmark; this pane is
                    a labelled region so the document keeps one main. */}
                {/* biome-ignore lint/correctness/useUniqueElementIds: one static anchor per pane, named by shell scroll/focus code */}
                <div
                  className="ob-content"
                  key={
                    secondaryParsed
                      ? routeViewKey(secondaryParsed.route)
                      : "split"
                  }
                  id="ob-main-2"
                  tabIndex={-1}
                >
                  <PaneNavContext.Provider value={secondaryPaneNav}>
                    {secondaryContent}
                  </PaneNavContext.Provider>
                </div>
              </section>
            ) : null}
          </div>
        </div>
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
