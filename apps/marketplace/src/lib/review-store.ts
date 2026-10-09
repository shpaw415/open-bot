import { isDevVersion, type PluginManifest } from "@open-bot/plugin-kit"
import {
  addComment,
  getPluginRow,
  getVersionRow,
  type PluginRow,
  type VersionRow,
} from "./db"
import {
  emptyReview,
  highestSeverity,
  listingOnEnqueue,
  listingOnVerdict,
  type PluginListing,
  type ReviewView,
  reviewPollPath,
  type SecurityReviewMessage,
} from "./review-state"
import {
  fetchReadme,
  findingsComment,
  type ReviewRuntime,
  reviewPublish,
  type SecurityFinding,
  type SecurityReview,
} from "./security"

type ReviewEnv = ReviewRuntime & {
  DB: D1Database
  DYNAMIC_PAGE_KV?: KVNamespace
  SECURITY_REVIEW?: Queue<SecurityReviewMessage>
  SECURITY_REVIEW_ASYNC?: string
}

function listingFromRow(row: PluginRow): PluginListing {
  return {
    status: row.status,
    latestVersion: row.latest_version,
    securityStatus: row.security_status,
  }
}

function parseFindings(raw: string | null): SecurityFinding[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SecurityFinding =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as SecurityFinding).title === "string" &&
        typeof (item as SecurityFinding).detail === "string",
    )
  } catch {
    return []
  }
}

export function reviewViewFromRow(row: VersionRow): ReviewView {
  const findings = parseFindings(row.security_findings)
  const status = row.security_status
  const phase =
    status === "queued" ||
    status === "running" ||
    status === "pass" ||
    status === "concern" ||
    status === "error"
      ? status
      : "error"
  return {
    status: phase,
    severity: phase === "pass" ? null : highestSeverity(findings),
    findings,
    issueUrl: row.issue_url,
    artifactKey: row.artifact_key,
    artifactSha256: row.artifact_sha256,
    error: row.security_error,
  }
}

export function reviewViewFromResult(review: SecurityReview): ReviewView {
  return {
    status: review.status,
    severity: review.severity,
    findings: review.findings,
    issueUrl: review.issueUrl,
    artifactKey: review.artifactKey,
    artifactSha256: review.artifactSha256,
    error: review.error,
  }
}

function pluginPagePath(id: string) {
  return `/plugins/${encodeURIComponent(id)}`
}

async function bustPluginPage(kv: KVNamespace | undefined, id: string) {
  if (!kv) return
  const path = pluginPagePath(id)
  await kv.delete(path).catch(() => undefined)
  await kv.delete(`props::${path}`).catch(() => undefined)
}

async function upsertQueuedVersion(
  db: D1Database,
  manifest: PluginManifest,
  notes: string | null,
  enqueuedAt: number,
) {
  await db
    .prepare(
      `INSERT INTO plugin_versions (plugin_id, version, manifest, notes, security_status, security_findings, artifact_key, artifact_sha256, analyzed_at, review_enqueued_at, security_error, issue_url, created_at)
       VALUES (?1, ?2, ?3, ?4, 'queued', '[]', NULL, NULL, NULL, ?5, NULL, NULL, ?6)
       ON CONFLICT (plugin_id, version) DO UPDATE SET
         manifest = excluded.manifest,
         notes = excluded.notes,
         security_status = 'queued',
         security_findings = '[]',
         artifact_key = NULL,
         artifact_sha256 = NULL,
         analyzed_at = NULL,
         review_enqueued_at = excluded.review_enqueued_at,
         security_error = NULL,
         issue_url = NULL`,
    )
    .bind(
      manifest.id,
      manifest.version,
      JSON.stringify(manifest),
      notes,
      enqueuedAt,
      enqueuedAt,
    )
    .run()
}

async function writeListing(
  db: D1Database,
  manifest: PluginManifest,
  listing: PluginListing,
  readme: string | null,
  now: number,
  existing: PluginRow | null,
) {
  const tags = JSON.stringify(manifest.tags ?? [])
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO plugins (id, name, description, author, repo, category, tags, latest_version, status, security_status, downloads, readme, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13)`,
      )
      .bind(
        manifest.id,
        manifest.name,
        manifest.description,
        manifest.author,
        manifest.repo,
        manifest.category,
        tags,
        listing.latestVersion,
        listing.status,
        listing.securityStatus,
        readme,
        now,
        now,
      )
      .run()
    return
  }
  await db
    .prepare(
      `UPDATE plugins SET name = ?2, description = ?3, author = ?4, repo = ?5, category = ?6,
       tags = ?7, latest_version = ?8, status = ?9, security_status = ?10, readme = COALESCE(?11, readme), updated_at = ?12
       WHERE id = ?1`,
    )
    .bind(
      manifest.id,
      manifest.name,
      manifest.description,
      manifest.author,
      manifest.repo,
      manifest.category,
      tags,
      listing.latestVersion,
      listing.status,
      listing.securityStatus,
      readme,
      now,
    )
    .run()
}

export async function enqueueSecurityReview(
  env: ReviewEnv,
  manifest: PluginManifest,
  readme: string | null,
  notes: string | null,
): Promise<{
  enqueuedAt: number
  plugin: PluginRow | null
  review: ReviewView
}> {
  const db = env.DB
  const enqueuedAt = Date.now()
  const existing = await getPluginRow(db, manifest.id)
  const decision = listingOnEnqueue(
    existing ? listingFromRow(existing) : null,
    manifest.version,
  )
  if (decision.touchListing) {
    await writeListing(
      db,
      manifest,
      decision.listing,
      readme,
      enqueuedAt,
      existing,
    )
  } else if (existing) {
    await db
      .prepare("UPDATE plugins SET updated_at = ?2 WHERE id = ?1")
      .bind(manifest.id, enqueuedAt)
      .run()
  }
  await upsertQueuedVersion(db, manifest, notes, enqueuedAt)
  const plugin = await getPluginRow(db, manifest.id)
  return {
    enqueuedAt,
    plugin,
    review: emptyReview("queued"),
  }
}

export async function applySecurityReview(
  env: ReviewEnv,
  manifest: PluginManifest,
  review: SecurityReview,
  enqueuedAt: number,
  readme: string | null,
): Promise<boolean> {
  const db = env.DB
  const now = Date.now()
  const written = await db
    .prepare(
      `UPDATE plugin_versions SET
         security_status = ?3,
         security_findings = ?4,
         artifact_key = ?5,
         artifact_sha256 = ?6,
         analyzed_at = ?7,
         security_error = ?8,
         issue_url = ?9
       WHERE plugin_id = ?1 AND version = ?2 AND review_enqueued_at = ?10`,
    )
    .bind(
      manifest.id,
      manifest.version,
      review.status,
      JSON.stringify(review.findings),
      review.artifactKey,
      review.artifactSha256,
      now,
      review.error,
      review.issueUrl,
      enqueuedAt,
    )
    .run()
  if ((written.meta.changes ?? 0) === 0) return false

  const plugin = await getPluginRow(db, manifest.id)
  if (!plugin) return true
  const latest = await getVersionRow(db, manifest.id, plugin.latest_version)
  const decision = listingOnVerdict(
    listingFromRow(plugin),
    manifest.version,
    isDevVersion(manifest.version),
    review.status,
    latest?.review_enqueued_at ?? null,
    enqueuedAt,
  )
  if (decision.touchListing) {
    await writeListing(db, manifest, decision.listing, readme, now, plugin)
  }
  if (review.status === "concern" && review.findings.length > 0) {
    const body = findingsComment(review.findings)
    const previous = await db
      .prepare(
        "SELECT body FROM plugin_comments WHERE plugin_id = ?1 AND author = 'security-bot' ORDER BY created_at DESC LIMIT 1",
      )
      .bind(manifest.id)
      .first<{ body: string }>()
    if (previous?.body !== body) {
      await addComment(db, manifest.id, "security-bot", "agent", body).catch(
        () => undefined,
      )
    }
  }
  await bustPluginPage(env.DYNAMIC_PAGE_KV, manifest.id)
  return true
}

export async function markReviewRunning(
  db: D1Database,
  message: SecurityReviewMessage,
): Promise<boolean> {
  const written = await db
    .prepare(
      `UPDATE plugin_versions SET security_status = 'running'
       WHERE plugin_id = ?1 AND version = ?2 AND review_enqueued_at = ?3
         AND security_status IN ('queued', 'running')`,
    )
    .bind(message.pluginId, message.version, message.enqueuedAt)
    .run()
  if ((written.meta.changes ?? 0) === 0) return false
  await db
    .prepare(
      `UPDATE plugins SET security_status = 'running', updated_at = ?3
       WHERE id = ?1 AND latest_version = ?2 AND security_status = 'queued'`,
    )
    .bind(message.pluginId, message.version, Date.now())
    .run()
  return true
}

function errorReview(message: string): SecurityReview {
  return {
    status: "error",
    findings: [],
    severity: null,
    artifactKey: null,
    artifactSha256: null,
    issueUrl: null,
    error: message.slice(0, 500),
  }
}

export async function failSecurityReview(
  env: ReviewEnv,
  message: SecurityReviewMessage,
  error: string,
): Promise<void> {
  const version = await getVersionRow(env.DB, message.pluginId, message.version)
  if (!version || version.review_enqueued_at !== message.enqueuedAt) return
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(version.manifest) as PluginManifest
  } catch {
    return
  }
  await applySecurityReview(
    env,
    manifest,
    errorReview(error),
    message.enqueuedAt,
    null,
  )
}

export async function processSecurityReview(
  env: ReviewEnv,
  message: SecurityReviewMessage,
): Promise<void> {
  const version = await getVersionRow(env.DB, message.pluginId, message.version)
  if (!version || version.review_enqueued_at !== message.enqueuedAt) return
  if (
    version.analyzed_at &&
    (version.security_status === "pass" ||
      version.security_status === "concern" ||
      version.security_status === "error")
  ) {
    return
  }
  const running = await markReviewRunning(env.DB, message)
  if (!running && version.security_status !== "running") return
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(version.manifest) as PluginManifest
  } catch {
    await failSecurityReview(env, message, "stored manifest is not json")
    return
  }
  const plugin = await getPluginRow(env.DB, manifest.id)
  const tag = `v${manifest.version}`
  const readme =
    (await fetchReadme(manifest.repo, tag, env.GITHUB_TOKEN)) ??
    plugin?.readme ??
    null
  const review = await reviewPublish(env, manifest, readme)
  await applySecurityReview(env, manifest, review, message.enqueuedAt, readme)
}

export function queuedPublishBody(
  manifest: PluginManifest,
  pluginStatus: string,
  readme: boolean,
  plugin: unknown,
  review: ReviewView,
) {
  return {
    ok: true,
    plugin,
    status: pluginStatus,
    readme,
    security: review,
    review: {
      pluginId: manifest.id,
      version: manifest.version,
      status: review.status,
      poll: reviewPollPath(manifest.id, manifest.version),
    },
  }
}
