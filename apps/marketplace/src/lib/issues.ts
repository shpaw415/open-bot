import { GITHUB_REPO_PATTERN, PLUGIN_ID_PATTERN } from "@open-bot/plugin-kit"
import { sha256Hex } from "./auth"
import { getPluginRow } from "./db"

// Product-report issues relayed from open-bot instances (ob-improve). The
// marketplace is the system of record: it dedupes repeat reports across
// instances by fingerprint, pushes each new issue to the relevant GitHub
// repo (the open-bot repo, or a plugin listing's repo) with its own token,
// and keeps un-pushed issues stored for an admin retry.

export const ISSUE_KINDS = ["bug", "friction", "feature"] as const
export const ISSUE_SURFACES = [
  "chat",
  "desktop",
  "nav",
  "cron",
  "persona",
  "config",
  "other",
] as const
export const ISSUE_STATUSES = ["open", "done", "wontfix"] as const
export const ISSUE_TITLE_MAX = 120
export const ISSUE_DETAIL_MAX = 4000
export const ISSUE_NOTE_MAX = 2000
export const DEFAULT_OPEN_BOT_REPO = "shpaw415/open-bot"

export type IssueKind = (typeof ISSUE_KINDS)[number]
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export type IssueInput = {
  pluginId: string | null
  kind: IssueKind
  surface: string | null
  title: string
  detail: string
  fingerprint: string | null
  reportId: string | null
  author: string | null
  authorKind: string | null
}

export type MarketIssue = {
  id: string
  pluginId: string | null
  repo: string
  kind: string
  surface: string | null
  title: string
  detail: string
  fingerprint: string
  hits: number
  status: IssueStatus
  note: string | null
  githubUrl: string | null
  githubNumber: number | null
  pushError: string | null
  pushedAt: number | null
  author: string | null
  authorKind: string | null
  reportId: string | null
  createdAt: number
  lastSeenAt: number
  resolvedAt: number | null
}

type IssueRow = {
  id: string
  plugin_id: string | null
  repo: string
  kind: string
  surface: string | null
  title: string
  detail: string
  fingerprint: string
  hits: number
  status: IssueStatus
  note: string | null
  github_url: string | null
  github_number: number | null
  push_error: string | null
  pushed_at: number | null
  author: string | null
  author_kind: string | null
  report_id: string | null
  created_at: number
  last_seen_at: number
  resolved_at: number | null
}

export type IssueDeps = {
  githubToken?: string | null
  openBotRepo?: string | null
}

// Migration guard (same pattern as review-store's schemaSelfCheck): a Pages
// deploy landing before the 0008 D1 migrate answers a diagnosable 503
// instead of a raw D1 500; the filing control plane then falls back to a
// direct GitHub issue. Cached per isolate.
let issuesSchemaCache: { ok: true } | { ok: false; error: string } | null = null
export async function issuesSchemaSelfCheck(
  DB: D1Database,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (issuesSchemaCache) return issuesSchemaCache
  try {
    await DB.prepare("SELECT github_url FROM issues LIMIT 1").bind().first()
    issuesSchemaCache = { ok: true }
  } catch (error) {
    issuesSchemaCache = {
      ok: false,
      error: `marketplace issues table is missing — run D1 migrations before deploying (hint: bunx wrangler d1 migrations apply open-bot-marketplace --remote) [${error instanceof Error ? error.message : "probe failed"}]`,
    }
  }
  return issuesSchemaCache
}

// Reports land on public GitHub repos, so credentials are stripped here
// even though the filing control plane already strips them.
export function stripIssueSecrets(value: string) {
  return value
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk)-[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]\s*(?!bearer\b)\S+/gi,
      "$1=[redacted]",
    )
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
}

export async function issueFingerprint(input: IssueInput) {
  return sha256Hex(
    `${input.kind}\0${input.pluginId ?? ""}\0${input.surface ?? ""}\0${normalizeTitle(input.title)}`,
  )
}

export function validateIssueInput(
  body: Record<string, unknown>,
): { input: IssueInput } | { error: string } {
  const kind = typeof body.kind === "string" ? body.kind : ""
  if (!(ISSUE_KINDS as readonly string[]).includes(kind)) {
    return { error: "kind must be bug, friction, or feature" }
  }
  let surface: string | null = null
  if (body.surface != null && body.surface !== "") {
    if (
      typeof body.surface !== "string" ||
      !(ISSUE_SURFACES as readonly string[]).includes(body.surface)
    ) {
      return {
        error:
          "surface must be chat, desktop, nav, cron, persona, config, or other",
      }
    }
    surface = body.surface
  }
  let pluginId: string | null = null
  if (body.pluginId != null && body.pluginId !== "") {
    if (typeof body.pluginId !== "string") {
      return { error: "pluginId must be a string" }
    }
    const slug = body.pluginId.trim()
    if (!PLUGIN_ID_PATTERN.test(slug)) {
      return {
        error: "pluginId must be a plugin slug (lowercase letters, digits, -)",
      }
    }
    pluginId = slug
  }
  const rawTitle = typeof body.title === "string" ? body.title : ""
  // `body` is accepted as the detail alias (comments API vocabulary).
  const rawDetail =
    typeof body.detail === "string"
      ? body.detail
      : typeof body.body === "string"
        ? body.body
        : ""
  if (!rawTitle || !rawDetail) return { error: "title and detail are required" }
  const title = stripIssueSecrets(rawTitle).trim().replace(/\s+/g, " ")
  const detail = stripIssueSecrets(rawDetail).trim()
  if (!title || title.length > ISSUE_TITLE_MAX) {
    return { error: `title must be 1–${ISSUE_TITLE_MAX} characters` }
  }
  if (!detail || detail.length > ISSUE_DETAIL_MAX) {
    return { error: `detail must be 1–${ISSUE_DETAIL_MAX} characters` }
  }
  let fingerprint: string | null = null
  if (body.fingerprint != null && body.fingerprint !== "") {
    if (
      typeof body.fingerprint !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.fingerprint.trim())
    ) {
      return { error: "fingerprint must be 1–128 letters, numbers, _ or -" }
    }
    fingerprint = body.fingerprint.trim()
  }
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim()
      ? stripIssueSecrets(value.trim()).slice(0, max)
      : null
  return {
    input: {
      pluginId,
      kind: kind as IssueKind,
      surface,
      title,
      detail,
      fingerprint,
      reportId: text(body.reportId, 128),
      author: text(body.author, 80),
      authorKind: body.authorKind === "human" ? "human" : "agent",
    },
  }
}

function issueFromRow(row: IssueRow): MarketIssue {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    repo: row.repo,
    kind: row.kind,
    surface: row.surface,
    title: row.title,
    detail: row.detail,
    fingerprint: row.fingerprint,
    hits: row.hits,
    status: row.status,
    note: row.note,
    githubUrl: row.github_url,
    githubNumber: row.github_number,
    pushError: row.push_error,
    pushedAt: row.pushed_at,
    author: row.author,
    authorKind: row.author_kind,
    reportId: row.report_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
  }
}

export async function getIssue(
  db: D1Database,
  id: string,
): Promise<MarketIssue | null> {
  const row = await db
    .prepare("SELECT * FROM issues WHERE id = ?1")
    .bind(id)
    .first<IssueRow>()
  return row ? issueFromRow(row) : null
}

async function openIssueByFingerprint(db: D1Database, fingerprint: string) {
  const row = await db
    .prepare(
      "SELECT * FROM issues WHERE fingerprint = ?1 AND status = 'open' ORDER BY created_at ASC LIMIT 1",
    )
    .bind(fingerprint)
    .first<IssueRow>()
  return row ? issueFromRow(row) : null
}

export async function listIssues(
  db: D1Database,
  filters: { status?: string; pluginId?: string; limit?: number },
): Promise<MarketIssue[]> {
  const status = filters.status ?? "open"
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200)
  const clauses: string[] = []
  const binds: (string | number)[] = []
  if (status !== "all") {
    binds.push(status)
    clauses.push(`status = ?${binds.length}`)
  }
  if (filters.pluginId) {
    binds.push(filters.pluginId)
    clauses.push(`plugin_id = ?${binds.length}`)
  }
  binds.push(limit)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const result = await db
    .prepare(
      `SELECT * FROM issues ${where} ORDER BY last_seen_at DESC LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<IssueRow>()
  return (result.results ?? []).map(issueFromRow)
}

export async function setIssueStatus(
  db: D1Database,
  id: string,
  status: IssueStatus,
  note?: string | null,
): Promise<MarketIssue | null> {
  const row = await getIssue(db, id)
  if (!row) return null
  const resolvedAt = status === "open" ? null : (row.resolvedAt ?? Date.now())
  await db
    .prepare(
      "UPDATE issues SET status = ?2, resolved_at = ?3, note = ?4 WHERE id = ?1",
    )
    .bind(id, status, resolvedAt, note === undefined ? row.note : note)
    .run()
  return getIssue(db, id)
}

function normalizeRepo(repo: string) {
  return repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "")
}

export function githubIssueBody(issue: MarketIssue) {
  const scope = issue.pluginId ? `plugin \`${issue.pluginId}\`` : "open-bot"
  return [
    issue.detail,
    "",
    `Kind: ${issue.kind} · Surface: ${issue.surface ?? "—"} · Scope: ${scope}`,
    ...(issue.reportId ? [`Instance report: ${issue.reportId}`] : []),
    `Marketplace issue: ${issue.id}`,
    "",
    "_Filed via the open-bot marketplace by an open-bot agent._",
  ].join("\n")
}

async function recordPushError(db: D1Database, id: string, message: string) {
  await db
    .prepare("UPDATE issues SET push_error = ?2 WHERE id = ?1")
    .bind(id, message.slice(0, 300))
    .run()
  return getIssue(db, id)
}

// Create the GitHub issue for a stored row. Never throws: the outcome is
// recorded on the row (github_url/number, or push_error) so an admin retry
// can pick it up later.
export async function pushIssueToGithub(
  db: D1Database,
  deps: IssueDeps,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { issue: MarketIssue; alreadyPushed?: boolean }
  | { error: string; status: number }
> {
  const issue = await getIssue(db, id)
  if (!issue) return { error: "issue not found", status: 404 }
  if (issue.githubUrl) return { issue, alreadyPushed: true }
  if (!deps.githubToken) {
    const recorded = await recordPushError(
      db,
      id,
      "GitHub is not configured on the marketplace",
    )
    return { issue: recorded ?? issue }
  }
  const repo = normalizeRepo(issue.repo)
  if (!GITHUB_REPO_PATTERN.test(repo)) {
    const recorded = await recordPushError(
      db,
      id,
      `invalid GitHub repo: ${issue.repo}`,
    )
    return { issue: recorded ?? issue }
  }
  let response: Response
  try {
    response = await fetchFn(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.githubToken}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "open-bot-marketplace",
      },
      body: JSON.stringify({
        title: issue.title,
        body: githubIssueBody(issue),
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const recorded = await recordPushError(
      db,
      id,
      `GitHub unreachable: ${error instanceof Error ? error.message : "request failed"}`,
    )
    return { issue: recorded ?? issue }
  }
  const parsed = (await response.json().catch(() => ({}))) as {
    html_url?: string
    number?: number
    message?: string
  }
  if (!response.ok || !parsed.html_url) {
    const recorded = await recordPushError(
      db,
      id,
      parsed.message || `GitHub issue failed (${response.status})`,
    )
    return { issue: recorded ?? issue }
  }
  await db
    .prepare(
      "UPDATE issues SET github_url = ?2, github_number = ?3, pushed_at = ?4, push_error = NULL WHERE id = ?1",
    )
    .bind(id, parsed.html_url, parsed.number ?? null, Date.now())
    .run()
  return { issue: (await getIssue(db, id)) ?? issue }
}

// File one report: dedupe against the open row with the same fingerprint,
// resolve the target repo, store, and push to GitHub immediately. A report
// for an unlisted plugin is a 404 — the caller's instance can still file
// directly against the plugin's repo.
export async function fileMarketplaceIssue(
  db: D1Database,
  deps: IssueDeps,
  raw: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<
  { issue: MarketIssue; duplicate: boolean } | { error: string; status: number }
> {
  const validated = validateIssueInput(raw)
  if ("error" in validated) return { error: validated.error, status: 400 }
  const input = validated.input
  const fingerprint = input.fingerprint ?? (await issueFingerprint(input))
  const existing = await openIssueByFingerprint(db, fingerprint)
  if (existing) {
    const now = Date.now()
    const detail =
      input.detail.length > existing.detail.length
        ? input.detail
        : existing.detail
    await db
      .prepare(
        "UPDATE issues SET hits = ?2, last_seen_at = ?3, detail = ?4 WHERE id = ?1",
      )
      .bind(existing.id, existing.hits + 1, now, detail)
      .run()
    // A duplicate whose first filing never reached GitHub retries the push.
    if (!existing.githubUrl) {
      const pushed = await pushIssueToGithub(db, deps, existing.id, fetchFn)
      if ("issue" in pushed) return { issue: pushed.issue, duplicate: true }
    }
    return {
      issue: (await getIssue(db, existing.id)) ?? existing,
      duplicate: true,
    }
  }
  let repo: string
  if (input.pluginId) {
    const plugin = await getPluginRow(db, input.pluginId)
    if (!plugin) return { error: "plugin not found", status: 404 }
    repo = normalizeRepo(plugin.repo)
    if (!GITHUB_REPO_PATTERN.test(repo)) {
      return { error: "plugin has no GitHub repo", status: 400 }
    }
  } else {
    repo = normalizeRepo(deps.openBotRepo || DEFAULT_OPEN_BOT_REPO)
  }
  const now = Date.now()
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO issues (id, plugin_id, repo, kind, surface, title, detail, fingerprint, hits, status, author, author_kind, report_id, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 'open', ?9, ?10, ?11, ?12, ?12)`,
    )
    .bind(
      id,
      input.pluginId,
      repo,
      input.kind,
      input.surface,
      input.title,
      input.detail,
      fingerprint,
      input.author,
      input.authorKind,
      input.reportId,
      now,
    )
    .run()
  const pushed = await pushIssueToGithub(db, deps, id, fetchFn)
  if (!("issue" in pushed)) return pushed
  return { issue: pushed.issue, duplicate: false }
}
