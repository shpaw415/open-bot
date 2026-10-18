import { isDevVersion, type PluginManifest } from "@open-bot/plugin-kit"

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
  owner_user_id?: string | null
  // Listing price (USD cents) of the current version; null = free.
  price_cents?: number | null
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
  review_enqueued_at: number | null
  security_error: string | null
  issue_url: string | null
  created_at: number
  // Price snapshot (USD cents) from the version manifest; null = free.
  price_cents?: number | null
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
  // Listing price (USD cents); null/undefined = free.
  priceCents: number | null
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
    stability: "stable" | "dev"
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
    priceCents: typeof row.price_cents === "number" ? row.price_cents : null,
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
        stability: isDevVersion(item.version)
          ? ("dev" as const)
          : ("stable" as const),
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
  // Dev-only listings (the current listing version is a dev tag or a semver
  // prerelease) stay out of search until a stable version publishes.
  if (!opts.includeAll) {
    clauses.push(
      "latest_version GLOB '[0-9]*' AND latest_version NOT LIKE '%-%'",
    )
  }
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

// ——— Catalogue search (additive extension of the API above) —————————————————
// Sorting and price filters are applied in SQL BEFORE the LIMIT so pagination
// and ordering cover the whole catalogue, not just the first page.

export type CatalogSort = "popular" | "name" | "price" | "new"
export type CatalogPrice = "all" | "free" | "paid"

export type CatalogQuery = {
  q?: string
  category?: string
  price?: CatalogPrice
  sort?: CatalogSort
  limit?: number
  offset?: number
  includeAll?: boolean
}

export type CatalogFacet = { category: string; count: number }

export type CatalogResult = {
  plugins: MarketPlugin[]
  total: number
  facets: CatalogFacet[]
}

const CATALOG_SORTS: Record<CatalogSort, string> = {
  popular: "downloads DESC, updated_at DESC, name COLLATE NOCASE ASC",
  name: "name COLLATE NOCASE ASC",
  price: "COALESCE(price_cents, 0) ASC, name COLLATE NOCASE ASC",
  new: "created_at DESC, name COLLATE NOCASE ASC",
}

// Pure SQL builder, exported for tests: the WHERE/ORDER clauses must cover the
// whole table before LIMIT/OFFSET are applied.
export function buildCatalogQuery(opts: CatalogQuery): {
  where: string
  facetWhere: string
  params: (string | number)[]
  facetParams: (string | number)[]
  order: string
  limit: number
  offset: number
} {
  const base: string[] = []
  const baseParams: (string | number)[] = []
  if (!opts.includeAll) {
    base.push("status = 'approved'")
    // Dev-only listings stay out of the public catalogue until a stable
    // version publishes (same rule as searchPlugins).
    base.push("latest_version GLOB '[0-9]*' AND latest_version NOT LIKE '%-%'")
  }
  const q = opts.q?.trim()
  if (q) {
    base.push(
      "(id LIKE ? OR name LIKE ? OR description LIKE ? OR tags LIKE ? OR author LIKE ?)",
    )
    const like = `%${q}%`
    baseParams.push(like, like, like, like, like)
  }
  const price = opts.price ?? "all"
  if (price === "free") base.push("(price_cents IS NULL OR price_cents <= 0)")
  if (price === "paid") base.push("(price_cents IS NOT NULL AND price_cents > 0)")

  const filtered = [...base]
  const filteredParams = [...baseParams]
  const category = opts.category?.trim().toLowerCase()
  if (category) {
    filtered.push("LOWER(category) = ?")
    filteredParams.push(category)
  }

  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 100)))
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const order = CATALOG_SORTS[opts.sort ?? "popular"]
  return {
    where: filtered.length > 0 ? `WHERE ${filtered.join(" AND ")}` : "",
    // Facets ignore the selected category so counts stay stable while
    // narrowing; they DO respect q + price so they reflect the search.
    facetWhere: base.length > 0 ? `WHERE ${base.join(" AND ")}` : "",
    facetParams: baseParams,
    params: filteredParams,
    order,
    limit,
    offset,
  }
}

export async function searchCatalog(
  db: D1Database,
  opts: CatalogQuery,
): Promise<CatalogResult> {
  const query = buildCatalogQuery(opts)
  const [rows, totalRow, facets] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM plugins ${query.where} ORDER BY ${query.order} LIMIT ${query.limit} OFFSET ${query.offset}`,
      )
      .bind(...query.params)
      .all<PluginRow>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM plugins ${query.where}`)
      .bind(...query.params)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT category, COUNT(*) AS count FROM plugins ${query.facetWhere} GROUP BY category ORDER BY count DESC, category ASC`,
      )
      .bind(...query.facetParams)
      .all<CatalogFacet>(),
  ])
  return {
    plugins: (rows.results ?? []).map(pluginFromRow),
    total: totalRow?.count ?? 0,
    facets: (facets.results ?? []).filter(
      (facet): facet is CatalogFacet =>
        typeof facet.category === "string" && typeof facet.count === "number",
    ),
  }
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

export async function getVersionRow(
  db: D1Database,
  id: string,
  version: string,
): Promise<VersionRow | null> {
  return (await db
    .prepare(
      "SELECT * FROM plugin_versions WHERE plugin_id = ?1 AND version = ?2",
    )
    .bind(id, version)
    .first<VersionRow>()) as VersionRow | null
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
