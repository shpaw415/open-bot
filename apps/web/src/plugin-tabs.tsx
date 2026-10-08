import Box from "@shpaw415/mui-lite/Box"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useMemo } from "react"
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
  tabId: string
  title: string
  kind: "page" | "iframe"
  url?: string
  cards?: PluginCardSpec[]
}

export function pluginTabs(plugins: InstalledPluginInfo[]): PluginTab[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      (plugin.manifest.dashboard?.tabs ?? []).map((tab) => ({
        key: `${plugin.pluginId}:${tab.id}`,
        pluginId: plugin.pluginId,
        tabId: tab.id,
        title: tab.title,
        kind: tab.kind,
        url: tab.url,
        cards: tab.cards,
      })),
    )
}

function PageTab({ tab }: { tab: PluginTab }) {
  const data = useMemo<Record<string, object>>(() => ({}), [])
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

export function PluginTabView({ tab }: { tab: PluginTab }) {
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
