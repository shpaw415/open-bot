import type { Db, Desktop, User } from "@open-bot/db"
import { endpoint, isRunning, opencodeExec, restartOpencode } from "./docker"
import { basicOpencodeAuth } from "./effort"
import { names } from "./env"
import type { EventHub } from "./events"
import { HttpError } from "./http-error"

// MCP servers configured in the desktop's opencode.json (`mcp` map). The
// dashboard's Config → MCP tab lists them with live status from the opencode
// server and can add, enable/disable, or delete user-owned entries. Entries a
// plugin injected via its manifest `opencode.mcp` are read-only here — the
// plugin lifecycle (install/enable/boot re-sync) owns them and would resurrect
// any local edit.

export type McpOwner = { id: string; name: string }

export type McpServerInfo = {
  name: string
  type: "local" | "remote"
  target: string
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
  enabled: boolean
  status:
    | "connected"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration"
    | "unknown"
  error: string | null
  plugin: McpOwner | null
}

export type McpEntry = {
  type: "local" | "remote"
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

const MAX_SERVERS = 16
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/

type PluginLike = {
  pluginId: string
  enabled: boolean
  manifest: Record<string, unknown>
}

/** mcp-key → owning plugin, from every enabled installed manifest. */
export function pluginMcpOwners(db: Db, userId: string) {
  const owners = new Map<string, McpOwner>()
  for (const row of db.installedPlugins(userId) as PluginLike[]) {
    if (!row.enabled) continue
    const opencode = (row.manifest.opencode ?? {}) as Record<string, unknown>
    const mcp = (opencode.mcp ?? {}) as Record<string, unknown>
    const name =
      typeof row.manifest.name === "string" ? row.manifest.name : row.pluginId
    for (const key of Object.keys(mcp))
      owners.set(key, {
        id: row.pluginId,
        name,
      })
  }
  return owners
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Read the desktop's opencode.json `mcp` map. Empty when unset. */
export async function readMcpConfig(userId: string) {
  const result = await opencodeExec(userId, [
    "sh",
    "-c",
    `jq '.mcp // {}' $HOME/.config/opencode/opencode.json`,
  ])
  if (result.code !== 0)
    throw new HttpError(
      502,
      result.stderr.trim() || "could not read the MCP config",
      "opencode_mcp",
    )
  try {
    const parsed = JSON.parse(result.stdout) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}
    return parsed as Record<string, McpEntry>
  } catch {
    throw new HttpError(502, "could not parse the MCP config", "opencode_mcp")
  }
}

/** Live per-server status from the opencode server; null while unreachable. */
async function liveMcpStatus(
  userId: string,
  desktop: Desktop,
): Promise<Record<string, { status: string; error?: string }> | null> {
  try {
    const base = await endpoint(userId, "opencode", 4096)
    const response = await fetch(`${base}/mcp`, {
      headers: basicOpencodeAuth(desktop.opencodePassword),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as unknown
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    return body as Record<string, { status: string; error?: string }>
  } catch {
    return null
  }
}

/** jq write of the `mcp` key + deferred opencode restart. */
async function writeMcpConfig(
  userId: string,
  db: Db,
  hub: EventHub,
  program: string,
  args: string,
) {
  const result = await opencodeExec(userId, [
    "sh",
    "-c",
    `jq ${args} ${shellQuote(program)} $HOME/.config/opencode/opencode.json > /tmp/oc-mcp.json && mv /tmp/oc-mcp.json $HOME/.config/opencode/opencode.json`,
  ])
  if (result.code !== 0)
    throw new HttpError(
      502,
      result.stderr.trim() || "could not update the MCP config",
      "opencode_mcp",
    )
  await restartOpencode(userId, { db, hub })
  hub.emit(userId, { type: "mcp.changed" })
}

export function validateMcpEntry(input: unknown): McpEntry {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "invalid server config", "invalid_mcp")
  const raw = input as Record<string, unknown>
  const type =
    raw.type === "remote" ? "remote" : raw.type === "local" ? "local" : null
  if (!type)
    throw new HttpError(400, "type must be local or remote", "invalid_mcp")
  const entry: McpEntry = { type }
  if (type === "local") {
    const command = raw.command
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      command.some((part) => typeof part !== "string" || !part.trim())
    )
      throw new HttpError(400, "a local server needs a command", "invalid_mcp")
    entry.command = (command as string[]).map((part) => part.trim())
  } else {
    const url = String(raw.url ?? "").trim()
    if (!/^https?:\/\//.test(url))
      throw new HttpError(
        400,
        "a remote server needs an http(s) URL",
        "invalid_mcp",
      )
    entry.url = url
  }
  const stringMap = (value: unknown, label: string) => {
    if (value === undefined || value === null) return undefined
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new HttpError(400, `${label} must be an object`, "invalid_mcp")
    const map: Record<string, string> = {}
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof item !== "string")
        throw new HttpError(
          400,
          `${label} values must be strings`,
          "invalid_mcp",
        )
      map[key] = item
    }
    return map
  }
  const environment = stringMap(raw.environment, "environment")
  if (environment) entry.environment = environment
  const headers = stringMap(raw.headers, "headers")
  if (headers) entry.headers = headers
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean")
      throw new HttpError(400, "enabled must be a boolean", "invalid_mcp")
    entry.enabled = raw.enabled
  }
  if (raw.timeout !== undefined && raw.timeout !== null) {
    const timeout = Number(raw.timeout)
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600_000)
      throw new HttpError(
        400,
        "timeout must be between 1 and 600000 ms",
        "invalid_mcp",
      )
    entry.timeout = Math.round(timeout)
  }
  return entry
}

/** Validate a manifest's whole `opencode.mcp` map (plugin apply path): the
 * same entry rules the MCP tab enforces, keyed by server name. */
export function validateMcpMap(input: unknown): Record<string, McpEntry> {
  if (input === undefined || input === null) return {}
  if (typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "opencode.mcp must be an object", "invalid_mcp")
  const entries: Record<string, McpEntry> = {}
  for (const [name, entry] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (!NAME_RE.test(name))
      throw new HttpError(
        400,
        `invalid MCP server name "${name}" (1-64 letters, digits, dots, dashes, underscores)`,
        "invalid_mcp",
      )
    entries[name] = validateMcpEntry(entry)
  }
  return entries
}

// Plugin apply path: install/enable merges entries into opencode.json, but a
// running daemon only reads that file at boot — and restarting the daemon to
// pick one up drains every live thread first, so the installing agent could
// never see its own tools mid-turn. The opencode server therefore also
// exposes runtime endpoints (POST /mcp to add, POST /mcp/{name}/connect or
// /disconnect), which the plugin lifecycle uses to bring MCP tools live
// without a restart. Everything here is best effort: the merged config stays
// the source of truth and loads at the next boot regardless.

const MCP_CONNECT_TIMEOUT_MS = 10_000

async function mcpBase(userId: string): Promise<string | null> {
  if (!(await isRunning(names(userId).opencode))) return null
  try {
    return await endpoint(userId, "opencode", 4096)
  } catch {
    return null
  }
}

async function mcpStatuses(
  userId: string,
  desktop: Desktop,
): Promise<Record<string, { status: string; error?: string }>> {
  const base = await mcpBase(userId)
  if (!base) return {}
  try {
    const response = await fetch(`${base}/mcp`, {
      headers: basicOpencodeAuth(desktop.opencodePassword),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return {}
    const body = (await response.json()) as unknown
    if (!body || typeof body !== "object" || Array.isArray(body)) return {}
    return body as Record<string, { status: string; error?: string }>
  } catch {
    return {}
  }
}

async function mcpPost(
  userId: string,
  desktop: Desktop,
  path: string,
  body?: unknown,
): Promise<boolean> {
  const base = await mcpBase(userId)
  if (!base) return false
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        ...basicOpencodeAuth(desktop.opencodePassword),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Live-connect freshly merged MCP servers into the desktop's running opencode
 * daemon. Returns one short human-readable status per server ("connected"
 * when tools are already live in new threads); an unreachable desktop yields
 * a note instead — the entry sits in opencode.json and loads at next boot.
 */
export async function connectMcpServers(
  db: Db,
  userId: string,
  servers: Record<string, unknown>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const keys = Object.keys(servers)
  if (keys.length === 0) return result
  if (!(await isRunning(names(userId).opencode))) {
    for (const name of keys)
      result[name] = "desktop asleep — merges when the desktop starts"
    return result
  }
  const desktop = db.desktop(userId)
  if (!desktop) {
    for (const name of keys)
      result[name] = "desktop asleep — merges when the desktop starts"
    return result
  }
  for (const name of keys) {
    const known = (await mcpStatuses(userId, desktop))[name]?.status
    if (known === "connected") {
      result[name] = "connected"
      continue
    }
    if (known) {
      // The daemon knows this server (leftover from an earlier enable) but is
      // not connected — reconnect in place instead of re-adding.
      await mcpPost(userId, desktop, `/mcp/${encodeURIComponent(name)}/connect`)
    } else {
      await mcpPost(userId, desktop, "/mcp", { name, config: servers[name] })
    }
    // Local servers spawn asynchronously; let the daemon settle, then trust
    // whatever GET /mcp reports.
    await Bun.sleep(300)
    const after = (await mcpStatuses(userId, desktop))[name]?.status
    result[name] =
      after === "connected"
        ? "connected"
        : (after ?? "unknown — loads at the next restart")
  }
  return result
}

/**
 * Live-disconnect MCP servers whose config entries were just removed
 * (disable/uninstall) — a running daemon would otherwise keep serving the
 * tools until its next restart. Best effort; the config removal above is the
 * source of truth.
 */
export async function disconnectMcpServers(
  db: Db,
  userId: string,
  serverNames: string[],
): Promise<void> {
  if (serverNames.length === 0) return
  const desktop = db.desktop(userId)
  if (!desktop) return
  for (const name of serverNames) {
    await mcpPost(
      userId,
      desktop,
      `/mcp/${encodeURIComponent(name)}/disconnect`,
    )
  }
}

/**
 * Config → MCP tab routes. `ensure` (server.ts) wakes the desktop first so a
 * sleeping desktop answers instead of erroring. Returns null when the path is
 * not an MCP route so the caller can 404.
 */
export async function handleMcp(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
  ensure: (user: User, db: Db) => Promise<Desktop>,
): Promise<Response | null> {
  const path = url.pathname
  const nameMatch = path.match(/^\/api\/mcp\/([^/]+)$/)
  const actionMatch = path.match(/^\/api\/mcp\/([^/]+)\/(enable|disable)$/)

  if (path === "/api/mcp" && req.method === "GET") {
    const desktop = await ensure(user, db)
    const owners = pluginMcpOwners(db, user.id)
    if (!(await isRunning(names(user.id).opencode)))
      return json({ servers: [], live: false })
    const config = await readMcpConfig(user.id)
    const live = await liveMcpStatus(user.id, desktop)
    const servers: McpServerInfo[] = Object.entries(config).map(
      ([name, entry]) => {
        const enabled = entry.enabled !== false
        const liveStatus = live?.[name]
        const status = liveStatus
          ? (liveStatus.status as McpServerInfo["status"])
          : enabled
            ? "unknown"
            : "disabled"
        return {
          name,
          type: entry.type === "remote" ? "remote" : "local",
          target:
            entry.type === "remote"
              ? (entry.url ?? "")
              : (entry.command ?? []).join(" "),
          command: entry.command,
          url: entry.url,
          environment: entry.environment,
          headers: entry.headers,
          enabled,
          status,
          error: liveStatus?.error ?? null,
          plugin: owners.get(name) ?? null,
        }
      },
    )
    return json({ servers, live: live !== null })
  }

  if (path === "/api/mcp" && req.method === "PUT") {
    await ensure(user, db)
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) throw new HttpError(400, "invalid json", "invalid_mcp")
    const name = String(body.name ?? "").trim()
    if (!NAME_RE.test(name))
      throw new HttpError(
        400,
        "server name must be 1-64 letters, digits, dots, dashes or underscores",
        "invalid_mcp",
      )
    const owners = pluginMcpOwners(db, user.id)
    const owner = owners.get(name)
    if (owner)
      throw new HttpError(
        409,
        `"${name}" is managed by the ${owner.name} plugin — disable the plugin instead`,
        "mcp_plugin_managed",
      )
    const entry = validateMcpEntry(body.server ?? body)
    if (!(await isRunning(names(user.id).opencode)))
      throw new HttpError(502, "the desktop is not running", "desktop_down")
    const config = await readMcpConfig(user.id)
    const replacing = name in config
    if (!replacing && Object.keys(config).length >= MAX_SERVERS)
      throw new HttpError(
        400,
        `at most ${MAX_SERVERS} MCP servers are supported`,
        "invalid_mcp",
      )
    await writeMcpConfig(
      user.id,
      db,
      hub,
      `.mcp = ((.mcp // {}) + {($n): $e})`,
      `--argjson n ${shellQuote(JSON.stringify(name))} --argjson e ${shellQuote(JSON.stringify(entry))}`,
    )
    return json({ ok: true, replaced: replacing })
  }

  if (actionMatch && req.method === "POST") {
    await ensure(user, db)
    const name = decodeURIComponent(actionMatch[1] ?? "")
    const enable = actionMatch[2] === "enable"
    const owners = pluginMcpOwners(db, user.id)
    const owner = owners.get(name)
    if (owner)
      throw new HttpError(
        409,
        `"${name}" is managed by the ${owner.name} plugin — ${enable ? "enable" : "disable"} the plugin instead`,
        "mcp_plugin_managed",
      )
    if (!(await isRunning(names(user.id).opencode)))
      throw new HttpError(502, "the desktop is not running", "desktop_down")
    const config = await readMcpConfig(user.id)
    if (!(name in config))
      throw new HttpError(404, `"${name}" is not configured`, "mcp_missing")
    await writeMcpConfig(
      user.id,
      db,
      hub,
      `.mcp[$n].enabled = $v`,
      `--argjson n ${shellQuote(JSON.stringify(name))} --argjson v ${shellQuote(String(enable))}`,
    )
    return json({ ok: true, enabled: enable })
  }

  if (nameMatch && req.method === "DELETE") {
    await ensure(user, db)
    const name = decodeURIComponent(nameMatch[1] ?? "")
    const owners = pluginMcpOwners(db, user.id)
    const owner = owners.get(name)
    if (owner)
      throw new HttpError(
        409,
        `"${name}" is managed by the ${owner.name} plugin — remove the plugin instead`,
        "mcp_plugin_managed",
      )
    if (!(await isRunning(names(user.id).opencode)))
      throw new HttpError(502, "the desktop is not running", "desktop_down")
    const config = await readMcpConfig(user.id)
    if (!(name in config))
      throw new HttpError(404, `"${name}" is not configured`, "mcp_missing")
    await writeMcpConfig(
      user.id,
      db,
      hub,
      `.mcp = ((.mcp // {}) | del(.[$n]))`,
      `--argjson n ${shellQuote(JSON.stringify(name))}`,
    )
    // The server is gone: its directory membership would dangle.
    db.removeCatalogDirItems(user.id, "mcp", [name])
    return json({ ok: true })
  }

  return null
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}
