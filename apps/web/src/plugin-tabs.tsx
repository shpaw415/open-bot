import Box from "@shpaw415/mui-lite/Box"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { useMobile } from "./hooks"
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

// The workspace drawer's "Dashboards" view: every enabled plugin's tabs in
// one picker; the user selects a dashboard and it fills the pane.
export function PluginDashboardsView({ tabs }: { tabs: PluginTab[] }) {
  const mobile = useMobile()
  const [selected, setSelected] = useState(tabs[0]?.key ?? "")
  const active = useMemo(
    () => tabs.find((tab) => tab.key === selected) ?? tabs[0],
    [tabs, selected],
  )
  useEffect(() => {
    if (selected && !tabs.some((tab) => tab.key === selected)) {
      setSelected(tabs[0]?.key ?? "")
    }
  }, [tabs, selected])
  if (tabs.length === 0) {
    return (
      <Box
        className="ob-scroll"
        sx={{ p: 3, maxWidth: 640, mx: "auto", width: "100%" }}
      >
        <Typography variant="body2" color="textSecondary">
          No plugin dashboards here yet. Plugins that ship a dashboard page
          (manifest dashboard.pages + tabs) show up in this view once installed
          and enabled.
        </Typography>
      </Box>
    )
  }
  if (mobile) {
    return (
      <Stack sx={{ height: "100%", minHeight: 0 }}>
        <Box sx={{ px: 1, pt: 1 }}>
          <select
            aria-label="Dashboard"
            value={active?.key ?? ""}
            onChange={(event) => setSelected(event.target.value)}
            style={{ width: "100%", padding: "6px 8px" }}
          >
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.title} — {tab.pluginName}
              </option>
            ))}
          </select>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {active ? <PluginTabView tab={active} /> : null}
        </Box>
      </Stack>
    )
  }
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
        {tabs.map((tab) => (
          <ListItemButton
            key={tab.key}
            selected={tab.key === active?.key}
            onClick={() => setSelected(tab.key)}
          >
            <ListItemText primary={tab.title} secondary={tab.pluginName} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {active ? <PluginTabView key={active.key} tab={active} /> : null}
      </Box>
    </Stack>
  )
}
