import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { HomeScreen } from "./home-screen"
import { useMobile } from "./hooks"
import {
  AddIcon,
  AppTileIcon,
  ArrowBackIcon,
  CloseIcon,
  SearchIcon,
  tileHue,
} from "./icons"
import {
  type InstalledPluginInfo,
  type PluginCardSpec,
  PluginCards,
  type PluginsStatus,
} from "./plugin-ui"
import Stack from "./stack"

/** What the shell's apps view needs to know about the install-list fetch. */
export type PluginsViewStatus = {
  status: PluginsStatus
  error: string
  refreshing: boolean
  refresh: () => Promise<void>
}

export type PluginTab = {
  key: string
  pluginId: string
  pluginName: string
  tabId: string
  title: string
  // App-tile icon for the mobile home screen: emoji or material icon name.
  icon?: string
  kind: "page" | "iframe" | "app"
  url?: string
  path?: string
  dataUrl?: string
  pollSeconds?: number
  cards?: PluginCardSpec[]
}

export function pluginTabs(plugins: InstalledPluginInfo[]): PluginTab[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      (plugin.manifest.dashboard?.tabs ?? []).map((tab) => ({
        key: `${plugin.pluginId}:${tab.id}`,
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        tabId: tab.id,
        title: tab.title,
        icon: tab.icon,
        kind: tab.kind,
        url: tab.url,
        path: tab.path,
        dataUrl: tab.dataUrl,
        pollSeconds: tab.pollSeconds,
        cards: tab.cards,
      })),
    )
}

// Case-insensitive side-list filter on the tab title and plugin name.
export function filterTabs(tabs: PluginTab[], query: string): PluginTab[] {
  const q = query.trim().toLowerCase()
  if (!q) return tabs
  return tabs.filter(
    (tab) =>
      tab.title.toLowerCase().includes(q) ||
      tab.pluginName.toLowerCase().includes(q),
  )
}

// Polls the plugin's page server through the control proxy and feeds the
// result to the tab's `$.`-bound cards. Static tabs keep an empty object.
// The last good payload is kept on poll failures — a flaky refresh must not
// blank a working dashboard; the view shows a quiet "stale" note instead.
export type PageDataState = {
  data: Record<string, unknown>
  loading: boolean
  error: string
  reload: () => void
}

function usePageData(tab: PluginTab): PageDataState {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(Boolean(tab.dataUrl))
  const [error, setError] = useState("")
  const [nonce, setNonce] = useState(0)
  const pollSeconds = tab.dataUrl
    ? Math.min(3600, Math.max(5, tab.pollSeconds ?? 30))
    : 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the manual-retry trigger
  useEffect(() => {
    if (!tab.dataUrl) return
    let alive = true
    const url = `/api/pages/${tab.pluginId}${tab.dataUrl}`
    const tick = () => {
      if (document.visibilityState !== "visible") return
      api<Record<string, unknown>>(url)
        .then((body) => {
          if (!alive) return
          if (body && typeof body === "object") {
            setData(body)
            setError("")
          }
        })
        .catch((caught) => {
          if (!alive) return
          // First load blocks; later failures keep the last good cards and
          // surface the message next to them (hasData branch in PageTab).
          setError(
            caught instanceof Error
              ? caught.message
              : "could not reach the app's data",
          )
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    tick()
    if (pollSeconds > 0) {
      const id = setInterval(tick, pollSeconds * 1000)
      return () => {
        alive = false
        clearInterval(id)
      }
    }
    return () => {
      alive = false
    }
  }, [tab.pluginId, tab.dataUrl, pollSeconds, nonce])
  const reload = useMemo(() => () => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

function PageTabSkeleton() {
  return (
    <Stack spacing={2} aria-busy="true">
      <Box className="ob-skeleton" sx={{ height: 24, width: 220 }} />
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 2 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            className="ob-skeleton"
            sx={{ height: 96, width: 200, borderRadius: "12px" }}
          />
        ))}
      </Stack>
      <Box className="ob-skeleton" sx={{ height: 120, borderRadius: "12px" }} />
      <output className="ob-sr-status">Loading app</output>
    </Stack>
  )
}

function PageTab({ tab }: { tab: PluginTab }) {
  const { data, loading, error, reload } = usePageData(tab)
  const hasData = Object.keys(data).length > 0
  // First load fails: full error state with retry. A later poll fails while
  // good data is on screen: the cards stay, the failure is a quiet note.
  return (
    <Box
      className="ob-scroll"
      sx={{ p: 2, maxWidth: 860, mx: "auto", width: "100%" }}
    >
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          {tab.title}
        </Typography>
        {loading && !hasData ? <PageTabSkeleton /> : null}
        {!loading && error ? (
          <Alert severity={hasData ? "warning" : "error"}>
            {hasData
              ? `Refresh failed — showing the last loaded data. ${error}`
              : error}
            <Box sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" onClick={reload}>
                Retry
              </Button>
            </Box>
          </Alert>
        ) : null}
        {!loading && (hasData || !error) ? (
          <PluginCards spec={tab.cards ?? []} data={data} />
        ) : null}
        {loading && hasData ? (
          <Typography variant="caption" color="textSecondary">
            Refreshing…
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}

// Dedicated pages origin keeps allow-same-origin (that origin is not the
// dashboard). Same-host frames drop it so plugin JS cannot inherit the session.
export function appTabSandbox(isolated: boolean) {
  return isolated
    ? "allow-scripts allow-forms allow-popups allow-same-origin"
    : "allow-scripts allow-forms allow-popups"
}

// Frame tokens live 10 minutes, sliding only on requests, and die with every
// control restart (in-memory grants). A tab parked open — or across a deploy —
// would otherwise show the frame's plain "unauthorized" body forever. While
// the view is mounted, a periodic HEAD slides the token; a 401 remints and
// reloads the frame. 502 (desktop asleep / server down) is skipped so a cold
// desktop does not loop remints. Hidden tabs (background browser tab) skip
// the HEAD so the plugin's page server can idle out; coming back to the tab
// fires an immediate HEAD that revives the frame (and the server) at once.
const APP_TAB_KEEPALIVE_MS = 4 * 60 * 1000

function AppTabSkeleton() {
  return (
    <Box
      sx={{ height: "100%", width: "100%", p: 2, boxSizing: "border-box" }}
      aria-busy="true"
    >
      <Stack spacing={1.5}>
        <Box className="ob-skeleton" sx={{ height: 28, width: 200 }} />
        <Box
          className="ob-skeleton"
          sx={{ height: "70%", minHeight: 260, borderRadius: "12px" }}
        />
        <output className="ob-sr-status">Opening app</output>
      </Stack>
    </Box>
  )
}

function AppTabError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ height: "100%", p: 3, textAlign: "center" }}
    >
      <Typography variant="subtitle1" component="h1">
        This app did not open
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ maxWidth: 440 }}>
        {message}
      </Typography>
      <Button variant="outlined" onClick={onRetry}>
        Retry
      </Button>
    </Stack>
  )
}

function AppTab({ tab }: { tab: PluginTab }) {
  const [src, setSrc] = useState("")
  const [isolated, setIsolated] = useState(false)
  const [phase, setPhase] = useState<"minting" | "ready" | "error">("minting")
  const [error, setError] = useState("")
  const [reconnecting, setReconnecting] = useState(false)
  const [nonce, setNonce] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the retry trigger for a failed frame mint
  useEffect(() => {
    let alive = true
    let current = ""
    const mint = () =>
      api<{ frameUrl: string; isolated?: boolean }>("/api/pages/frame", {
        method: "POST",
        body: JSON.stringify({ pluginId: tab.pluginId, path: tab.path ?? "/" }),
      }).then((body) => {
        if (!alive) return
        current = body.frameUrl
        setSrc(body.frameUrl)
        setIsolated(Boolean(body.isolated))
        setPhase("ready")
        setError("")
        setReconnecting(false)
      })
    // First mint (or an explicit retry) blocks the pane on a skeleton. A
    // keep-alive remint failure keeps the last frame on screen and only
    // raises a soft note — never blank a working app.
    const run = (soft: boolean) => {
      if (!soft) {
        setPhase((prev) => (prev === "ready" ? prev : "minting"))
        setError("")
      }
      return mint().catch((caught) => {
        if (!alive) return
        const message =
          caught instanceof Error
            ? caught.message
            : "the app server did not answer"
        if (soft && current) {
          setReconnecting(true)
          return
        }
        setPhase("error")
        setError(message)
      })
    }
    void run(false)
    const check = () => {
      if (!current || document.visibilityState !== "visible") return
      fetch(current, {
        method: "HEAD",
        cache: "no-store",
        credentials: "include",
      })
        .then((res) => {
          if (!alive || res.ok || res.status === 502) return
          void run(true)
        })
        .catch(() => {})
    }
    const timer = setInterval(check, APP_TAB_KEEPALIVE_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [tab.pluginId, tab.path, nonce])
  if (phase === "minting") return <AppTabSkeleton />
  if (phase === "error" || !src)
    return (
      <AppTabError
        message={error || "The app server could not be reached."}
        onRetry={() => setNonce((n) => n + 1)}
      />
    )
  return (
    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
      {reconnecting ? (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{
            position: "absolute",
            top: 4,
            right: 8,
            zIndex: 2,
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.85)",
            px: 1,
            borderRadius: 1,
            pointerEvents: "none",
          }}
        >
          Reconnecting…
        </Typography>
      ) : null}
      {/* The iframe fires `load` for error pages too, so readiness comes from
          the frame mint above — not from this event. No cross-origin probing
          happens here: the frame's interior is the plugin's business. */}
      <iframe
        title={tab.title}
        src={src}
        sandbox={appTabSandbox(isolated)}
        referrerPolicy="no-referrer"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </Box>
  )
}

export function PluginTabView({ tab }: { tab: PluginTab }) {
  if (tab.kind === "app") return <AppTab tab={tab} />
  if (tab.kind === "iframe" && tab.url && /^https:\/\//.test(tab.url)) {
    return (
      <Box sx={{ height: "100%", width: "100%" }}>
        <iframe
          title={tab.title}
          src={tab.url}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </Box>
    )
  }
  return <PageTab tab={tab} />
}

function AppsLoadState({ status }: { status: PluginsViewStatus }) {
  return (
    <Stack
      spacing={2}
      sx={{ p: 3, maxWidth: 640, width: "100%", mx: "auto" }}
      aria-busy={status.status !== "ready"}
    >
      {status.status === "loading" ? (
        <>
          <output className="ob-sr-status">Loading apps</output>
          <Stack
            direction="row"
            spacing={2}
            sx={{ flexWrap: "wrap", rowGap: 2 }}
          >
            {[0, 1, 2, 3].map((i) => (
              <Stack key={i} spacing={1} sx={{ width: 96 }}>
                <Box
                  className="ob-skeleton"
                  sx={{ width: 96, height: 96, borderRadius: "18px" }}
                />
                <Box className="ob-skeleton" sx={{ height: 10, width: 72 }} />
              </Stack>
            ))}
          </Stack>
        </>
      ) : null}
      {status.status === "error" ? (
        <>
          <Typography variant="subtitle1" component="h1">
            Apps could not load
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {status.error ||
              "The installed plugin list did not load. Nothing is broken on this page — the request failed."}
          </Typography>
          <Box>
            <Button variant="outlined" onClick={() => void status.refresh()}>
              Retry
            </Button>
          </Box>
        </>
      ) : null}
    </Stack>
  )
}

/**
 * Quiet banner shown above the Apps view when a background refresh of the
 * install list fails: the previously loaded tabs stay usable, the failure
 * never replaces them.
 */
function AppsStaleBanner({ status }: { status: PluginsViewStatus }) {
  if (status.status !== "error") return null
  return (
    <Alert severity="warning" sx={{ m: 1 }}>
      {status.error || "The installed plugin list could not refresh."}
      <Box sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void status.refresh()}
        >
          Retry
        </Button>
      </Box>
    </Alert>
  )
}

// The main navigation's Apps view. Desktop keeps the side list +
// pane; mobile renders a phone-style home screen (apps, swipe pages,
// long-press to move, drop on an entry to create a folder).
export function PluginAppsView({
  tabs,
  status,
  onAddPlugin,
  onManagePlugins,
}: {
  tabs: PluginTab[]
  status: PluginsViewStatus
  /** Where "Ajouter une application" leads (the extensions manager). */
  onAddPlugin: () => void
  onManagePlugins: () => void
}) {
  const mobile = useMobile()
  const [selected, setSelected] = useState("")
  const [query, setQuery] = useState("")
  const shown = useMemo(() => filterTabs(tabs, query), [tabs, query])
  const active = useMemo(
    () => tabs.find((tab) => tab.key === selected) ?? null,
    [tabs, selected],
  )
  useEffect(() => {
    if (selected && !tabs.some((tab) => tab.key === selected)) {
      setSelected("")
    }
  }, [tabs, selected])

  // Full-screen load/error states only when there is nothing to show yet.
  // A failed refresh (or a loading one) with tabs already on screen keeps
  // the view: the tabs are the last good data, the state becomes a banner.
  if (tabs.length === 0 && status.status !== "ready") {
    return (
      <Box
        className="ob-scroll"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        <AppsLoadState status={status} />
      </Box>
    )
  }
  if (tabs.length === 0) {
    return (
      <Box
        className="ob-scroll"
        sx={{ p: 3, maxWidth: 640, mx: "auto", width: "100%" }}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" color="textSecondary">
            Aucune application pour l’instant. Les extensions qui livrent une
            page de tableau de bord apparaissent ici une fois installées et
            activées; certaines extensions fonctionnent directement dans les
            conversations, sans interface.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              variant="contained"
              startIcon={<AddIcon width={18} height={18} />}
              onClick={() => onAddPlugin()}
            >
              Ajouter une application
            </Button>
            <Button variant="outlined" onClick={() => onManagePlugins()}>
              Gérer les extensions
            </Button>
          </Stack>
          {status.refreshing ? (
            <Typography variant="caption" color="textSecondary">
              Actualisation…
            </Typography>
          ) : null}
        </Stack>
      </Box>
    )
  }
  if (mobile) {
    if (active) {
      return (
        <Stack sx={{ height: "100%", minHeight: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ px: 1, py: 0.75, flexShrink: 0 }}
          >
            <IconButton
              aria-label="Back to apps"
              onClick={() => setSelected("")}
              size="small"
            >
              <ArrowBackIcon width={20} height={20} />
            </IconButton>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle2"
                sx={{ lineHeight: 1.2, whiteSpace: "nowrap" }}
              >
                {active.title}
              </Typography>
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ lineHeight: 1.2 }}
              >
                {active.pluginName}
              </Typography>
            </Box>
          </Stack>
          <AppsStaleBanner status={status} />
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <PluginTabView key={active.key} tab={active} />
          </Box>
        </Stack>
      )
    }
    return <HomeScreen tabs={tabs} onOpen={setSelected} />
  }
  const current = active ?? tabs[0]
  return (
    <Stack direction="row" sx={{ height: "100%", minHeight: 0 }}>
      <Box
        sx={{
          width: 264,
          flexShrink: 0,
          borderRight: "1px solid",
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <AppsStaleBanner status={status} />
        <Box sx={{ px: 1.25, pt: 1, pb: 0.75, flexShrink: 0 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 0.5, px: 0.25 }}
          >
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.6px",
              }}
            >
              Apps
            </Typography>
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {query.trim() ? `${shown.length} of ${tabs.length}` : tabs.length}
            </Typography>
          </Stack>
          {/* Native field like the threads filter: mui-lite hides
              ::placeholder (its floating-label animation keys off
              :placeholder-shown), so a label-less TextField shows nothing.
              This filters the apps already listed here; it is not a server
              search. */}
          <label className="ob-filter-field">
            <SearchIcon width={14} height={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Filter apps"
              aria-label="Filter apps"
              type="search"
            />
            {query ? (
              <button
                type="button"
                className="ob-filter-clear"
                aria-label="Clear app filter"
                onClick={() => setQuery("")}
              >
                <CloseIcon width={13} height={13} />
              </button>
            ) : null}
          </label>
        </Box>
        <List
          dense
          disablePadding
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: 0.75,
            pb: 0.75,
          }}
        >
          {shown.map((tab) => {
            const hue = tileHue(tab.key)
            const isSelected = tab.key === current?.key
            return (
              <ListItemButton
                key={tab.key}
                selected={isSelected}
                onClick={() => setSelected(tab.key)}
                sx={{
                  borderRadius: 2,
                  mb: 0.25,
                  minHeight: 52,
                  flexGrow: 0,
                  ...(isSelected
                    ? {
                        backgroundColor: `hsl(${hue} 62% 56% / 0.15)`,
                        "&:hover": {
                          backgroundColor: `hsl(${hue} 62% 56% / 0.22)`,
                        },
                      }
                    : {}),
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    mr: 1.25,
                    flexShrink: 0,
                    borderRadius: "8px",
                    background: `linear-gradient(145deg, hsl(${hue} 62% 56%), hsl(${
                      (hue + 28) % 360
                    } 58% 44%))`,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,.25)",
                  }}
                >
                  <AppTileIcon icon={tab.icon} name={tab.title} size={16} />
                </Box>
                <ListItemText
                  primary={tab.title}
                  secondary={tab.pluginName}
                  sx={{
                    minWidth: 0,
                    "& .MUI_ListItemText_Secondary": {
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    },
                  }}
                  SlotProps={{
                    primary: {
                      sx: {
                        display: "block",
                        fontSize: 13.5,
                        fontWeight: isSelected ? 650 : 500,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    },
                  }}
                />
              </ListItemButton>
            )
          })}
          {shown.length === 0 ? (
            <Box sx={{ px: 1.5, py: 2 }}>
              <Typography variant="caption" color="textSecondary">
                No apps match “{query.trim()}”.
              </Typography>
            </Box>
          ) : null}
        </List>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <PluginTabView key={current.key} tab={current} />
      </Box>
    </Stack>
  )
}
