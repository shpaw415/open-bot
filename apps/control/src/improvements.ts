import { createHash } from "node:crypto"
import type {
  Db,
  Improvement,
  ImprovementKind,
  ImprovementStatus,
  ImprovementSurface,
  User,
} from "@open-bot/db"
import { GITHUB_REPO_PATTERN, PLUGIN_ID_PATTERN } from "@open-bot/plugin-kit"
import { githubToken, openBotRepo } from "./env"
import { createIssue, postMarketplaceIssue, resolvePluginRepo } from "./plugins"

export const NEW_ROW_LIMIT = 100
export const EXTERNAL_LIMIT = 10
export const HOUR_MS = 60 * 60 * 1000
export const TITLE_MAX = 120
export const DETAIL_MAX = 4000
export const NOTE_MAX = 2000

export const kinds = ["bug", "friction", "feature"] as const
export const surfaces = [
  "chat",
  "desktop",
  "nav",
  "cron",
  "persona",
  "config",
  "other",
] as const
export const statuses = ["open", "done", "wontfix"] as const

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function stripSecrets(value: string) {
  return value
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk)-[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]\s*(?!bearer\b)\S+/gi,
      "$1=[redacted]",
    )
}

export function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
}

export function improvementFingerprint(
  kind: ImprovementKind,
  surface: ImprovementSurface,
  title: string,
  plugin?: string | null,
) {
  // Without a plugin the hash is the legacy one, so reports filed before
  // plugin routing still dedupe against their open rows.
  const scoped = plugin
    ? `${kind}\0${surface}\0${plugin}\0${normalizeTitle(title)}`
    : `${kind}\0${surface}\0${normalizeTitle(title)}`
  return createHash("sha256").update(scoped).digest("hex")
}

function isKind(value: string): value is ImprovementKind {
  return (kinds as readonly string[]).includes(value)
}

function isSurface(value: string): value is ImprovementSurface {
  return (surfaces as readonly string[]).includes(value)
}

export function isStatus(value: string): value is ImprovementStatus {
  return (statuses as readonly string[]).includes(value)
}

export type ImprovementInput = {
  kind: ImprovementKind
  surface: ImprovementSurface
  title: string
  detail: string
  sessionId: string | null
  plugin: string | null
}

export function parseImprovementInput(body: {
  kind?: unknown
  surface?: unknown
  title?: unknown
  detail?: unknown
  sessionId?: unknown
  plugin?: unknown
}): ImprovementInput | { error: string } {
  const kind = typeof body.kind === "string" ? body.kind : ""
  const surface = typeof body.surface === "string" ? body.surface : ""
  if (!isKind(kind)) return { error: "kind must be bug, friction, or feature" }
  if (!isSurface(surface))
    return {
      error:
        "surface must be chat, desktop, nav, cron, persona, config, or other",
    }
  if (typeof body.title !== "string" || typeof body.detail !== "string")
    return { error: "title and detail are required" }
  const title = stripSecrets(body.title).trim().replace(/\s+/g, " ")
  const detail = stripSecrets(body.detail).trim()
  if (!title || title.length > TITLE_MAX)
    return { error: `title must be 1–${TITLE_MAX} characters` }
  if (!detail || detail.length > DETAIL_MAX)
    return { error: `detail must be 1–${DETAIL_MAX} characters` }
  let sessionId: string | null = null
  if (body.sessionId != null && body.sessionId !== "") {
    if (typeof body.sessionId !== "string")
      return { error: "sessionId must be a string" }
    const session = body.sessionId.trim()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session))
      return { error: "sessionId must be 1–128 letters, numbers, _ or -" }
    sessionId = session
  }
  let plugin: string | null = null
  if (body.plugin != null && body.plugin !== "") {
    if (typeof body.plugin !== "string")
      return { error: "plugin must be a string" }
    const slug = body.plugin.trim()
    if (!PLUGIN_ID_PATTERN.test(slug))
      return {
        error: "plugin must be a plugin slug (lowercase letters, digits, -)",
      }
    plugin = slug
  }
  return { kind, surface, title, detail, sessionId, plugin }
}

export function fileImprovement(
  db: Db,
  user: User,
  input: ImprovementInput,
  now = Date.now(),
):
  | { error: string; status: number }
  | { id: string; duplicate: boolean; hits: number } {
  const fingerprint = improvementFingerprint(
    input.kind,
    input.surface,
    input.title,
    input.plugin,
  )
  const open = db.openImprovementByFingerprint(fingerprint)
  if (open) {
    const detail =
      input.detail.length > open.detail.length ? input.detail : open.detail
    const sessionId = input.sessionId ?? open.sessionId
    db.bumpImprovement(open.id, {
      hits: open.hits + 1,
      lastSeenAt: now,
      detail,
      sessionId,
    })
    return { id: open.id, duplicate: true, hits: open.hits + 1 }
  }
  if (db.improvementsSince(user.id, now - HOUR_MS) >= NEW_ROW_LIMIT)
    return { error: "too many new reports this hour", status: 429 }
  const row: Improvement = {
    id: crypto.randomUUID(),
    userId: user.id,
    sessionId: input.sessionId,
    kind: input.kind,
    surface: input.surface,
    title: input.title,
    detail: input.detail,
    fingerprint,
    hits: 1,
    status: "open",
    note: null,
    createdAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    plugin: input.plugin,
    routedTo: null,
    issueUrl: null,
    externalId: null,
  }
  db.insertImprovement(row)
  return { id: row.id, duplicate: false, hits: 1 }
}

// External routing for a filed report, marketplace first: the marketplace
// issue endpoint dedupes the report across instances and pushes it to the
// relevant GitHub repo (the open-bot repo, or the --plugin plugin's repo)
// with the marketplace's own token. When the marketplace is unconfigured,
// unreachable, or does not list the plugin, routing falls back to a direct
// GitHub issue with this instance's token, then to the local row only.
// Routing never blocks the local filing — every failure degrades to a
// warning and the row stays in the local queue.
export type MarketplaceIssuePayload = {
  pluginId: string | null
  kind: string
  surface: string | null
  title: string
  detail: string
  fingerprint: string
  reportId: string
}

export type ImprovementIssueDeps = {
  openBotRepo: string
  githubConfigured: boolean
  allowExternal: (userId: string) => boolean
  postMarketplaceIssue: (
    db: Db,
    payload: MarketplaceIssuePayload,
  ) => Promise<{
    id: string
    repo: string
    githubUrl: string | null
    githubNumber: number | null
    url: string
  }>
  createIssue: (
    repo: string,
    title: string,
    body: string,
  ) => Promise<{ url: string; number: number }>
  resolvePluginRepo: (
    db: Db,
    userId: string,
    pluginId: string,
  ) => Promise<string>
}

export type ImprovementIssue =
  | { via: "github"; repo?: string; url: string; number: number }
  | { via: "marketplace"; url: string; id: string }

const externalLog = new Map<string, number[]>()

function externalAllowed(userId: string) {
  const now = Date.now()
  const recent = (externalLog.get(userId) ?? []).filter(
    (time) => now - time < HOUR_MS,
  )
  externalLog.set(userId, recent)
  if (recent.length >= EXTERNAL_LIMIT) return false
  recent.push(now)
  return true
}

const defaultIssueDeps: ImprovementIssueDeps = {
  openBotRepo,
  githubConfigured: githubToken !== "",
  allowExternal: externalAllowed,
  postMarketplaceIssue,
  createIssue,
  resolvePluginRepo,
}

export function improvementIssueBody(input: ImprovementInput, id: string) {
  const scope = input.plugin ? `plugin \`${input.plugin}\`` : "open-bot"
  return [
    input.detail,
    "",
    `Kind: ${input.kind} · Surface: ${input.surface} · Scope: ${scope}`,
    `open-bot report: ${id}`,
  ].join("\n")
}

function storedIssue(row: Improvement): ImprovementIssue | null {
  if (!row.routedTo || !row.issueUrl) return null
  if (row.routedTo === "github") {
    return {
      via: "github",
      url: row.issueUrl,
      number: Number(row.externalId ?? 0),
    }
  }
  return { via: "marketplace", url: row.issueUrl, id: row.externalId ?? "" }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function routeImprovementIssue(
  db: Db,
  user: User,
  id: string,
  input: ImprovementInput & { fingerprint: string },
  deps: ImprovementIssueDeps,
): Promise<{ issue: ImprovementIssue } | { warning: string }> {
  if (!deps.allowExternal(user.id)) {
    return {
      warning:
        "filed locally only; external issue routing hit its hourly rate limit",
    }
  }
  const failures: string[] = []
  // 1. Marketplace first: it dedupes across instances and pushes to GitHub
  // with its own token. A filed marketplace issue counts as routed even
  // when its GitHub push has not landed yet — the marketplace owns the
  // retry, so this instance must not also file directly.
  try {
    const relayed = await deps.postMarketplaceIssue(db, {
      pluginId: input.plugin,
      kind: input.kind,
      surface: input.surface,
      title: input.title,
      detail: input.detail,
      fingerprint: input.fingerprint,
      reportId: id,
    })
    if (relayed.githubUrl) {
      db.setImprovementIssue(id, {
        routedTo: "github",
        issueUrl: relayed.githubUrl,
        externalId: String(relayed.githubNumber ?? 0),
      })
      return {
        issue: {
          via: "github",
          repo: relayed.repo || undefined,
          url: relayed.githubUrl,
          number: relayed.githubNumber ?? 0,
        },
      }
    }
    db.setImprovementIssue(id, {
      routedTo: "marketplace",
      issueUrl: relayed.url,
      externalId: relayed.id,
    })
    return { issue: { via: "marketplace", url: relayed.url, id: relayed.id } }
  } catch (error) {
    failures.push(`marketplace issue failed: ${errorText(error)}`)
  }
  // 2. Direct GitHub with this instance's token.
  let repo = ""
  if (input.plugin) {
    repo = await deps
      .resolvePluginRepo(db, user.id, input.plugin)
      .catch((error: unknown) => {
        failures.push(`plugin repo lookup failed: ${errorText(error)}`)
        return ""
      })
  } else if (GITHUB_REPO_PATTERN.test(deps.openBotRepo)) {
    repo = deps.openBotRepo
  } else {
    failures.push("the open-bot GitHub repo is misconfigured")
  }
  if (!deps.githubConfigured) {
    failures.push("GitHub is not configured on this instance")
  } else if (repo && GITHUB_REPO_PATTERN.test(repo)) {
    try {
      const issue = await deps.createIssue(
        repo,
        input.title,
        improvementIssueBody(input, id),
      )
      db.setImprovementIssue(id, {
        routedTo: "github",
        issueUrl: issue.url,
        externalId: String(issue.number),
      })
      return {
        issue: { via: "github", repo, url: issue.url, number: issue.number },
      }
    } catch (error) {
      failures.push(`GitHub issue failed: ${errorText(error)}`)
    }
  } else if (input.plugin && !repo) {
    failures.push(`plugin ${input.plugin} has no GitHub repo`)
  }
  return {
    warning: `filed locally only; external routing failed: ${failures.join("; ")}`,
  }
}

export async function handleImprovementPost(
  req: Request,
  db: Db,
  user: User,
  deps: ImprovementIssueDeps = defaultIssueDeps,
) {
  if (req.method !== "POST") return json({ error: "not found" }, 404)
  const body = (await req.json().catch(() => null)) as {
    kind?: unknown
    surface?: unknown
    title?: unknown
    detail?: unknown
    sessionId?: unknown
    plugin?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const parsed = parseImprovementInput(body)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  const filed = fileImprovement(db, user, parsed)
  if ("error" in filed) return json({ error: filed.error }, filed.status)
  const row = db.improvementById(filed.id)
  const already = row ? storedIssue(row) : null
  if (already) {
    return json({ ...filed, plugin: parsed.plugin, issue: already })
  }
  // A new report routes now; a duplicate whose first filing never routed
  // (every external path down at the time) retries with the stored row's
  // longer detail.
  const input: ImprovementInput & { fingerprint: string } = row
    ? {
        kind: row.kind,
        surface: row.surface,
        title: row.title,
        detail: row.detail,
        sessionId: row.sessionId,
        plugin: row.plugin,
        fingerprint: row.fingerprint,
      }
    : {
        ...parsed,
        fingerprint: improvementFingerprint(
          parsed.kind,
          parsed.surface,
          parsed.title,
          parsed.plugin,
        ),
      }
  const routed = await routeImprovementIssue(db, user, filed.id, input, deps)
  return json({ ...filed, plugin: parsed.plugin, ...routed })
}

export async function handleAdminImprovements(req: Request, url: URL, db: Db) {
  if (url.pathname === "/api/admin/improvements" && req.method === "GET") {
    const status = url.searchParams.get("status") ?? "open"
    if (status !== "all" && !isStatus(status))
      return json({ error: "status must be open, done, wontfix, or all" }, 400)
    return json({
      improvements: db.listImprovements(status === "all" ? undefined : status),
    })
  }
  const match = url.pathname.match(/^\/api\/admin\/improvements\/([^/]+)$/)
  if (!match || req.method !== "PATCH") return null
  const id = decodeURIComponent(match[1] ?? "")
  const body = (await req.json().catch(() => null)) as {
    status?: unknown
    note?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const status = typeof body.status === "string" ? body.status : ""
  if (!isStatus(status))
    return json({ error: "status must be open, done, or wontfix" }, 400)
  let note: string | null | undefined
  if (body.note !== undefined) {
    if (typeof body.note !== "string")
      return json({ error: "note must be a string" }, 400)
    const trimmed = body.note.trim()
    if (trimmed.length > NOTE_MAX)
      return json({ error: `note must be at most ${NOTE_MAX} characters` }, 400)
    note = trimmed || null
  }
  const row = db.setImprovementStatus(id, status, note)
  if (!row) return json({ error: "report not found" }, 404)
  return json(row)
}
