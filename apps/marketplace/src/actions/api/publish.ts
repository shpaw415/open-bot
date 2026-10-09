"no action"

import {
  isDevVersion,
  type PluginManifest,
  validatePluginManifest,
} from "@open-bot/plugin-kit"
import { apiKeyAuth, touchApiKey } from "../../lib/auth"
import { addComment, getPluginRow, pluginFromRow } from "../../lib/db"
import { findingsComment, reviewPublish } from "../../lib/security"

function authorized(request: Request, token: string | undefined) {
  if (!token) return false
  const header = request.headers.get("authorization") ?? ""
  return header.replace(/^Bearer\s+/i, "") === token
}

async function fetchReadme(
  repo: string,
  tag: string,
  githubToken?: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${repo}/${tag}/README.md`,
      {
        headers: githubToken
          ? { authorization: `Bearer ${githubToken}` }
          : undefined,
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) return null
    const text = await response.text()
    return text.slice(0, 200_000)
  } catch {
    return null
  }
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  const { DB, MARKETPLACE_TOKEN, GITHUB_TOKEN } = context.env
  const apiKey = await apiKeyAuth(DB, context.request)
  if (apiKey) void touchApiKey(DB, apiKey.keyId).catch(() => undefined)
  const authed =
    authorized(context.request, MARKETPLACE_TOKEN) || apiKey !== null
  if (!authed) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  let body: { manifest?: unknown; notes?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const result = validatePluginManifest(body.manifest)
  if (!result.ok) {
    return Response.json(
      { error: "invalid manifest", issues: result.issues },
      { status: 400 },
    )
  }
  const manifest: PluginManifest = result.manifest
  const tag = `v${manifest.version}`
  const readme = await fetchReadme(manifest.repo, tag, GITHUB_TOKEN)
  const now = Date.now()
  const existing = await getPluginRow(DB, manifest.id)
  const security = await reviewPublish(context.env, manifest, readme)
  const status =
    security.status === "pass"
      ? "approved"
      : security.status === "concern"
        ? "rejected"
        : existing?.status === "approved"
          ? "approved"
          : "pending"
  // Dev tags and prereleases stay out of search: only stable publishes move
  // latest_version (what the marketplace listing and default installs use).
  const listedVersion =
    existing && isDevVersion(manifest.version)
      ? (existing.latest_version ?? manifest.version)
      : manifest.version
  if (existing) {
    await DB.prepare(
      `UPDATE plugins SET name = ?2, description = ?3, author = ?4, repo = ?5, category = ?6,
       tags = ?7, latest_version = ?8, status = ?9, security_status = ?10, readme = ?11, updated_at = ?12 WHERE id = ?1`,
    )
      .bind(
        manifest.id,
        manifest.name,
        manifest.description,
        manifest.author,
        manifest.repo,
        manifest.category,
        JSON.stringify(manifest.tags ?? []),
        listedVersion,
        status,
        security.status,
        readme ?? existing.readme,
        now,
      )
      .run()
  } else {
    await DB.prepare(
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
        JSON.stringify(manifest.tags ?? []),
        manifest.version,
        status,
        security.status,
        readme,
        now,
        now,
      )
      .run()
  }
  await DB.prepare(
    `INSERT INTO plugin_versions (plugin_id, version, manifest, notes, security_status, security_findings, artifact_key, artifact_sha256, analyzed_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (plugin_id, version) DO UPDATE SET
       manifest = excluded.manifest,
       notes = excluded.notes,
       security_status = excluded.security_status,
       security_findings = excluded.security_findings,
       artifact_key = excluded.artifact_key,
       artifact_sha256 = excluded.artifact_sha256,
       analyzed_at = excluded.analyzed_at`,
  )
    .bind(
      manifest.id,
      manifest.version,
      JSON.stringify(manifest),
      typeof body.notes === "string"
        ? (body.notes as string).slice(0, 4000)
        : null,
      security.status,
      JSON.stringify(security.findings),
      security.artifactKey,
      security.artifactSha256,
      now,
      now,
    )
    .run()
  if (security.status === "concern" && security.findings.length > 0) {
    await addComment(
      DB,
      manifest.id,
      "security-bot",
      "agent",
      findingsComment(security.findings),
    ).catch(() => undefined)
  }
  const row = await getPluginRow(DB, manifest.id)
  return Response.json({
    ok: true,
    plugin: row ? pluginFromRow(row) : null,
    status,
    readme: readme !== null,
    security: {
      status: security.status,
      severity: security.severity,
      findings: security.findings,
      issueUrl: security.issueUrl,
      artifactKey: security.artifactKey,
      artifactSha256: security.artifactSha256,
      error: security.error,
    },
  })
}
