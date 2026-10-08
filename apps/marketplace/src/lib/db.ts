import type { PluginManifest } from "@open-bot/plugin-kit"

export type PluginRow = {
  id: string
  name: string
  description: string
  author: string
  repo: string
  category: string
  tags: string
  latest_version: string
  status: "pending" | "approved" | "rejected"
  security_status: string | null
  downloads: number
  readme: string | null
  created_at: number
  updated_at: number
}

export type VersionRow = {
  plugin_id: string
  version: string
  manifest: string
  notes: string | null
  security_status: string | null
  security_findings: string | null
  artifact_key: string | null
  artifact_sha256: string | null
  analyzed_at: number | null
  created_at: number
}

export type CommentRow = {
  id: string
  plugin_id: string
  author: string
  author_kind: string
  body: string
  created_at: number
}

export type SecuritySummary = {
  status: string | null
  findings: SecurityFindingJson[]
  analyzedAt: number | null
}

export type SecurityFindingJson = {
  title: string
  severity: string
  detail: string
  path: string | null
}

export type MarketPlugin = {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string
  category: string
  tags: string[]
  status: PluginRow["status"]
  securityStatus: string | null
  downloads: number
  createdAt: number
  updatedAt: number
}

export type MarketDetail = {
  plugin: MarketPlugin
  manifest: PluginManifest
  readme: string | null
  security: SecuritySummary
  versions: {
    version: string
    createdAt: number
    notes: string | null
    securityStatus: string | null
    artifactSha256: string | null
  }[]
}

export type MarketComment = {
  id: string
  author: string
  authorKind: string
  body: string
  createdAt: number
}

export function pluginFromRow(row: PluginRow): MarketPlugin {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed))
      tags = parsed.filter((t) => typeof t === "string")
  } catch {
    tags = []
  }
  return {
    id: row.id,
    name: row.name,
    version: row.latest_version,
    description: row.description,
    author: row.author,
    repo: row.repo,
    category: row.category,
    tags,
    status: row.status,
    securityStatus: row.security_status,
    downloads: row.downloads,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseFindings(raw: string | null): SecurityFindingJson[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SecurityFindingJson =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as SecurityFindingJson).title === "string" &&
        typeof (item as SecurityFindingJson).detail === "string",
    )
  } catch {
    return []
  }
}

export function securityFromRow(row: VersionRow): SecuritySummary {
  return {
    status: row.security_status,
    findings: parseFindings(row.security_findings),
    analyzedAt: row.analyzed_at,
  }
}

export function detailFromRows(
  row: PluginRow,
  versions: VersionRow[],
  requestedVersion?: string,
): MarketDetail | null {
  const manifestVersion = requestedVersion ?? row.latest_version
  const chosen = versions.find((item) => item.version === manifestVersion)
  if (!chosen) return null
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(chosen.manifest) as PluginManifest
  } catch {
    return null
  }
  return {
    plugin: pluginFromRow(row),
    manifest,
    readme: row.readme,
    security: securityFromRow(chosen),
    versions: versions
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .map((item) => ({
        version: item.version,
        createdAt: item.created_at,
        notes: item.notes,
        securityStatus: item.security_status,
        artifactSha256: item.artifact_sha256,
      })),
  }
}

export async function searchPlugins(
  db: D1Database,
  opts: { q?: string; category?: string; includeAll?: boolean },
): Promise<MarketPlugin[]> {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (!opts.includeAll) clauses.push("status = 'approved'")
  if (opts.q) {
    clauses.push(
      "(id LIKE ? OR name LIKE ? OR description LIKE ? OR tags LIKE ? OR author LIKE ?)",
    )
    const like = `%${opts.q}%`
    params.push(like, like, like, like, like)
  }
  if (opts.category) {
    clauses.push("category = ?")
    params.push(opts.category)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const result = await db
    .prepare(
      `SELECT * FROM plugins ${where} ORDER BY downloads DESC, updated_at DESC LIMIT 100`,
    )
    .bind(...params)
    .all<PluginRow>()
  return (result.results ?? []).map(pluginFromRow)
}

export async function getPluginRow(
  db: D1Database,
  id: string,
): Promise<PluginRow | null> {
  return (await db
    .prepare("SELECT * FROM plugins WHERE id = ?1")
    .bind(id)
    .first<PluginRow>()) as PluginRow | null
}

export async function getVersions(
  db: D1Database,
  id: string,
): Promise<VersionRow[]> {
  const result = await db
    .prepare("SELECT * FROM plugin_versions WHERE plugin_id = ?1")
    .bind(id)
    .all<VersionRow>()
  return result.results ?? []
}

export async function getComments(
  db: D1Database,
  id: string,
): Promise<MarketComment[]> {
  const result = await db
    .prepare(
      "SELECT * FROM plugin_comments WHERE plugin_id = ?1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(id)
    .all<CommentRow>()
  return (result.results ?? []).map((row) => ({
    id: row.id,
    author: row.author,
    authorKind: row.author_kind,
    body: row.body,
    createdAt: row.created_at,
  }))
}

export async function addComment(
  db: D1Database,
  id: string,
  author: string,
  authorKind: string,
  body: string,
): Promise<MarketComment> {
  const row: CommentRow = {
    id: crypto.randomUUID(),
    plugin_id: id,
    author,
    author_kind: authorKind,
    body,
    created_at: Date.now(),
  }
  await db
    .prepare(
      "INSERT INTO plugin_comments (id, plugin_id, author, author_kind, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(
      row.id,
      row.plugin_id,
      row.author,
      row.author_kind,
      row.body,
      row.created_at,
    )
    .run()
  return {
    id: row.id,
    author: row.author,
    authorKind: row.author_kind,
    body: row.body,
    createdAt: row.created_at,
  }
}
