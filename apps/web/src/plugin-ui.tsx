import Box from "@shpaw415/mui-lite/Box"
import Chip from "@shpaw415/mui-lite/Chip"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"

export type PluginTextboxManifest = {
  renderers?: {
    type: string
    title: string
    spec: PluginCardSpec[]
  }[]
  commands?: {
    command: string
    title: string
    template: string
  }[]
  buttons?: {
    id: string
    label: string
    template: string
  }[]
  validators?: {
    pattern: string
    message: string
  }[]
  attachments?: {
    accept: string[]
    maxFiles?: number
  }
}

export type PluginCardSpec = {
  kind: string
  text?: string
  label?: string
  value?: string
  hint?: string
  columns?: string[]
  rows?: string[][] | string
  items?: string[] | string
  url?: string
  height?: number
}

export type InstalledPluginInfo = {
  id: string
  pluginId: string
  version: string
  name: string
  description: string
  author: string
  repo: string
  enabled: boolean
  permissions: string[]
  setupCommands?: string[]
  init?: { ranAt: number; ok: boolean; output: string } | null
  manifest: {
    configs?: { key: string; label: string; def: string }[]
    dashboard?: {
      tabs?: {
        id: string
        title: string
        kind: "page" | "iframe"
        url?: string
        cards?: PluginCardSpec[]
      }[]
    }
    textbox?: PluginTextboxManifest
  }
  readme: string | null
  createdAt: number
  updatedAt: number
}

export type InstalledResponse = {
  plugins: InstalledPluginInfo[]
  policy: "manual" | "auto"
  configured: boolean
}

export function useInstalledPlugins() {
  const [plugins, setPlugins] = useState<InstalledPluginInfo[]>([])
  const [policy, setPolicy] = useState<"manual" | "auto">("manual")
  const [configured, setConfigured] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const body = await api<InstalledResponse>("/api/plugins/installed")
      setPlugins(body.plugins ?? [])
      setPolicy(body.policy ?? "manual")
      setConfigured(body.configured ?? false)
      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { plugins, policy, configured, loaded, refresh }
}

export function resolveSpecField(
  value: string | undefined,
  data: Record<string, unknown>,
): string {
  if (value === undefined) return ""
  if (!value.startsWith("$.")) return value
  let current: unknown = data
  for (const segment of value.slice(2).split(".")) {
    if (!current || typeof current !== "object") return ""
    current = (current as Record<string, unknown>)[segment]
  }
  return current === undefined || current === null ? "" : String(current)
}

export function resolveRows(
  rows: string | string[] | string[][] | undefined,
  data: Record<string, unknown>,
): string[][] {
  if (typeof rows === "string") {
    if (!rows.startsWith("$.")) return []
    let current: unknown = data
    for (const segment of rows.slice(2).split(".")) {
      if (!current || typeof current !== "object") return []
      current = (current as Record<string, unknown>)[segment]
    }
    if (!Array.isArray(current)) return []
    return current.map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell)) : [String(row)],
    )
  }
  if (Array.isArray(rows)) {
    return rows.map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell)) : [String(row)],
    )
  }
  return []
}

export function PluginCardView({
  card,
  data,
}: {
  card: PluginCardSpec
  data: Record<string, unknown>
}) {
  const kind = card.kind
  if (kind === "markdown") {
    return (
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {resolveSpecField(card.text, data)}
      </Typography>
    )
  }
  if (kind === "stat") {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="textSecondary">
          {resolveSpecField(card.label, data)}
        </Typography>
        <Typography variant="h6">
          {resolveSpecField(card.value, data)}
        </Typography>
        {card.hint ? (
          <Typography variant="caption" color="textSecondary">
            {resolveSpecField(card.hint, data)}
          </Typography>
        ) : null}
      </Paper>
    )
  }
  if (kind === "table") {
    const rows = resolveRows(card.rows, data)
    return (
      <Box sx={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {(card.columns ?? []).map((column) => (
                <th
                  key={column}
                  style={{ textAlign: "left", padding: "4px 8px" }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .map((row, index) => ({
                id: `row-${index}`,
                cells: row.map((cell, cellIndex) => ({
                  id: `cell-${cellIndex}`,
                  cell,
                })),
              }))
              .map((row) => (
                <tr key={row.id}>
                  {row.cells.map((entry) => (
                    <td key={entry.id} style={{ padding: "4px 8px" }}>
                      {entry.cell}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </Box>
    )
  }
  if (kind === "list") {
    const items = resolveRows(
      Array.isArray(card.items) ? card.items.map(String) : card.items,
      data,
    ).flat()
    return (
      <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
        {items
          .map((item, index) => ({ id: `item-${index}`, item }))
          .map((entry) => (
            <li key={entry.id}>
              <Typography variant="body2">{entry.item}</Typography>
            </li>
          ))}
      </ul>
    )
  }
  if (kind === "link") {
    const url = resolveSpecField(card.url, data)
    if (!/^https?:\/\//.test(url)) return null
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {resolveSpecField(card.label, data) || url}
      </a>
    )
  }
  if (kind === "iframe") {
    const url = resolveSpecField(card.url, data)
    if (!/^https?:\/\//.test(url)) return null
    return (
      <iframe
        title={card.label || url}
        src={url}
        sandbox="allow-scripts allow-forms allow-popups"
        style={{
          width: "100%",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 8,
          height: card.height ?? 320,
        }}
      />
    )
  }
  return null
}

export function PluginCards({
  spec,
  data,
}: {
  spec: PluginCardSpec[]
  data: Record<string, unknown>
}) {
  return (
    <Stack spacing={1}>
      {spec
        .map((card, index) => ({ id: `card-${index}`, card }))
        .map((entry) => (
          <PluginCardView key={entry.id} card={entry.card} data={data} />
        ))}
    </Stack>
  )
}

export function PluginBadges({ permissions }: { permissions: string[] }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      {permissions.map((permission) => (
        <Chip
          key={permission}
          label={permission}
          size="small"
          variant="outlined"
        />
      ))}
    </Stack>
  )
}
