import Box from "@shpaw415/mui-lite/Box"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { HomeScreen } from "./home-screen"
import { useMobile } from "./hooks"
import { AppTileIcon, ArrowBackIcon, tileHue } from "./icons"
import {
  type InstalledPluginInfo,
  type PluginCardSpec,
  PluginCards,
  useInstalledPlugins,
} from "./plugin-ui"

export { useInstalledPlugins }

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

// Polls the plugin's page server through the control proxy and feeds the
// result to the tab's `$.`-bound cards. Static tabs keep an empty object.
function usePageData(tab: PluginTab): Record<string, unknown> {
  const [data, setData] = useState<Record<string, unknown>>({})
  const pollSeconds = tab.dataUrl
    ? Math.min(3600, Math.max(5, tab.pollSeconds ?? 30))
    : 0
  useEffect(() => {
    if (!tab.dataUrl) return
    let alive = true
    const url = `/api/pages/${tab.pluginId}${tab.dataUrl}`
    const tick = () => {
      if (document.visibilityState !== "visible") return
      api<Record<string, unknown>>(url)
        .then((body) => {
          if (alive && body && typeof body === "object") setData(body)
        })
        .catch(() => {})
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
  }, [tab.pluginId, tab.dataUrl, pollSeconds])
  return data
}

function PageTab({ tab }: { tab: PluginTab }) {
  const data = usePageData(tab)
  return (
    <Box
      className="ob-scroll"
      sx={{ p: 2, maxWidth: 860, mx: "auto", width: "100%" }}
    >
      <Stack spacing={2}>
        <Typography variant="h6">{tab.title}</Typography>
        <PluginCards spec={tab.cards ?? []} data={data} />
      </Stack>
    </Box>
  )
}

// Full dynamic plugin UI served by the plugin's page server on the desktop,
// proxied same-origin under /api/pages/<pluginId>/ (SSE + WebSockets work).
function AppTab({ tab }: { tab: PluginTab }) {
  const src = `/api/pages/${tab.pluginId}${tab.path ?? "/"}`
  return (
    <Box sx={{ height: "100%", width: "100%" }}>
      <iframe
        title={tab.title}
        src={src}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </Box>
  )
}

export function PluginTabView({ tab }: { tab: PluginTab }) {
  if (tab.kind === "app") return <AppTab tab={tab} />
  if (tab.kind === "iframe" && tab.url && /^https?:\/\//.test(tab.url)) {
    return (
      <Box sx={{ height: "100%", width: "100%" }}>
        <iframe
          title={tab.title}
          src={tab.url}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </Box>
    )
  }
  return <PageTab tab={tab} />
}

// The main navigation's Apps view. Desktop keeps the side list +
// pane; mobile renders a phone-style home screen (apps, swipe pages,
// long-press to move, drop on an entry to create a folder).
export function PluginAppsView({ tabs }: { tabs: PluginTab[] }) {
  const mobile = useMobile()
  const [selected, setSelected] = useState("")
  const active = useMemo(
    () => tabs.find((tab) => tab.key === selected) ?? null,
    [tabs, selected],
  )
  useEffect(() => {
    if (selected && !tabs.some((tab) => tab.key === selected)) {
      setSelected("")
    }
  }, [tabs, selected])
  if (tabs.length === 0) {
    return (
      <Box
        className="ob-scroll"
        sx={{ p: 3, maxWidth: 640, mx: "auto", width: "100%" }}
      >
        <Typography variant="body2" color="textSecondary">
          No plugin apps here yet. Plugins that ship a dashboard page (manifest
          dashboard.pages + tabs) show up here once installed and enabled.
        </Typography>
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
      <List
        dense
        disablePadding
        sx={{
          width: 230,
          flexShrink: 0,
          borderRight: "1px solid",
          borderColor: "divider",
          overflowY: "auto",
          py: 0.5,
        }}
      >
        {tabs.map((tab) => {
          const hue = tileHue(tab.key)
          return (
            <ListItemButton
              key={tab.key}
              selected={tab.key === current?.key}
              onClick={() => setSelected(tab.key)}
            >
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  mr: 1.25,
                  flexShrink: 0,
                  borderRadius: "6px",
                  background: `linear-gradient(145deg, hsl(${hue} 62% 56%), hsl(${
                    (hue + 28) % 360
                  } 58% 44%))`,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AppTileIcon icon={tab.icon} name={tab.title} size={14} />
              </Box>
              <ListItemText primary={tab.title} secondary={tab.pluginName} />
            </ListItemButton>
          )
        })}
      </List>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {current ? <PluginTabView key={current.key} tab={current} /> : null}
      </Box>
    </Stack>
  )
}
