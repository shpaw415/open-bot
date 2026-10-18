import Box from "@shpaw415/mui-lite/Box"
import Chip from "@shpaw415/mui-lite/Chip"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useReducer, useRef } from "react"
import { api } from "./api"
import { useEventStream } from "./hooks"

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
  source?: "marketplace" | "local"
  localPath?: string | null
  permissions: string[]
  setupCommands?: string[]
  init?: { ranAt: number; ok: boolean; output: string } | null
  mentionClashes?: { section: string; owner: string }[]
  settings?: Record<string, string>
  updateAvailable?: string | null
  manifest: {
    configs?: {
      key: string
      label: string
      def: string
      type?: "string" | "bool" | "number" | "enum" | "secret"
      options?: string[]
      secret?: boolean
    }[]
    permissions?: {
      vaultRead?: string[]
      vaultCreate?: string[]
    }
    dashboard?: {
      pages?: {
        entry: string
        public?: boolean
      }
      tabs?: {
        id: string
        title: string
        icon?: string
        kind: "page" | "iframe" | "app"
        url?: string
        path?: string
        dataUrl?: string
        pollSeconds?: number
        cards?: PluginCardSpec[]
      }[]
      mentions?: {
        section: string
        label?: string
        path?: string
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
  autoUpdate?: "off" | "stable"
  publicOrigin?: string
  configured: boolean
}

/**
 * Load lifecycle of the account-scoped plugin list.
 *
 * - `initial` — no authenticated session yet (or never fetched); nothing loaded.
 * - `loading` — first fetch in flight, no data to show.
 * - `ready` — last fetch succeeded; `plugins` may legitimately be empty.
 * - `error` — last fetch failed. `plugins` still holds the last good list
 *   (possibly empty on first load); the view must offer a retry and must
 *   never render the failure as "no plugins".
 *
 * `refreshing` is true while a background refetch runs on top of `ready`.
 */
export type PluginsStatus = "initial" | "loading" | "ready" | "error"

export type InstalledPluginsState = {
  plugins: InstalledPluginInfo[]
  policy: "manual" | "auto"
  autoUpdate: "off" | "stable"
  publicOrigin: string
  configured: boolean
  status: PluginsStatus
  refreshing: boolean
  error: string
  /** Account the current data belongs to; null when signed out. Internal. */
  identityKey: string | null
}

export const initialPluginsState: InstalledPluginsState = {
  plugins: [],
  policy: "manual",
  autoUpdate: "off",
  publicOrigin: "",
  configured: false,
  status: "initial",
  refreshing: false,
  error: "",
  identityKey: null,
}

export type PluginsAction =
  | { type: "identity"; identity: string | null }
  | { type: "fetch" }
  | { type: "success"; body: InstalledResponse }
  | { type: "failure"; error: string }

/** Normalize a server body into the state's data fields. */
export function parseInstalledBody(
  body: InstalledResponse,
): Pick<
  InstalledPluginsState,
  "plugins" | "policy" | "autoUpdate" | "publicOrigin" | "configured"
> {
  return {
    plugins: Array.isArray(body.plugins) ? body.plugins : [],
    policy: body.policy === "auto" ? "auto" : "manual",
    autoUpdate: body.autoUpdate === "stable" ? "stable" : "off",
    publicOrigin:
      typeof body.publicOrigin === "string" ? body.publicOrigin : "",
    configured: Boolean(body.configured),
  }
}

/**
 * Pure state machine behind useInstalledPlugins. Identity switches clear the
 * previous user's data immediately — a private install list must never leak
 * across accounts, and a fetch fired before login must not be mistaken for
 * "this account has no plugins".
 */
export function pluginsReducer(
  state: InstalledPluginsState,
  action: PluginsAction,
): InstalledPluginsState {
  switch (action.type) {
    case "identity": {
      if (action.identity === null) {
        // Signed out: drop everything, back to the pre-login state.
        return { ...initialPluginsState }
      }
      if (state.identityKey === action.identity) return state
      return {
        ...initialPluginsState,
        status: "loading",
        identityKey: action.identity,
      }
    }
    case "fetch": {
      if (state.status === "ready")
        return { ...state, refreshing: true, error: "" }
      return { ...state, status: "loading", error: "" }
    }
    case "success":
      return {
        ...parseInstalledBody(action.body),
        status: "ready",
        refreshing: false,
        error: "",
        identityKey: state.identityKey,
      }
    case "failure":
      return {
        // Keep the last good list; an error must not look like "no plugins".
        ...state,
        status: "error",
        refreshing: false,
        error: action.error,
      }
  }
}

export function useInstalledPlugins(opts?: {
  /** True only with an authenticated session; gates the protected fetch. */
  active?: boolean
  /** Account id the data belongs to; switching it invalidates and reloads. */
  identity?: string | null
}): InstalledPluginsState & { refresh: () => Promise<void> } {
  const active = opts?.active ?? true
  const identity = opts?.identity ?? null
  const [state, dispatch] = useReducer(pluginsReducer, {
    ...initialPluginsState,
    // Start in the right phase before the first effect: with a session the
    // first fetch starts immediately; without one nothing is loaded yet.
    status: active ? "loading" : "initial",
    identityKey: active ? identity : null,
  })
  const requestedRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    dispatch({ type: "fetch" })
    try {
      const body = await api<InstalledResponse>("/api/plugins/installed")
      dispatch({ type: "success", body })
    } catch (caught) {
      dispatch({
        type: "failure",
        error:
          caught instanceof Error ? caught.message : "failed to load plugins",
      })
    }
  }, [])

  useEffect(() => {
    dispatch({ type: "identity", identity: active ? identity : null })
  }, [active, identity])

  useEffect(() => {
    if (!active) {
      requestedRef.current = null
      return
    }
    // One request per identity unless a refresh is asked for explicitly.
    if (requestedRef.current === identity) return
    requestedRef.current = identity
    void refresh()
  }, [active, identity, refresh])

  const { subscribe } = useEventStream(active)

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== "plugins.changed") return
        if (!active) return
        requestedRef.current = identity
        void refresh()
      }),
    [subscribe, refresh, active, identity],
  )

  return { ...state, refresh }
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
