"no action"

import {
  manifestIssuesText,
  type PluginManifest,
  validatePluginManifest,
} from "@open-bot/plugin-kit"
import { getPluginRow, pluginFromRow } from "../../lib/db"

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
  if (!authorized(context.request, MARKETPLACE_TOKEN)) {
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
  const status = existing?.status === "approved" ? "approved" : "pending"
  if (existing) {
    await DB.prepare(
      `UPDATE plugins SET name = ?2, description = ?3, author = ?4, repo = ?5, category = ?6,
       tags = ?7, latest_version = ?8, status = ?9, readme = ?10, updated_at = ?11 WHERE id = ?1`,
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
        readme ?? existing.readme,
        now,
      )
      .run()
  } else {
    await DB.prepare(
      `INSERT INTO plugins (id, name, description, author, repo, category, tags, latest_version, status, downloads, readme, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12)`,
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
        readme,
        now,
        now,
      )
      .run()
  }
  await DB.prepare(
    `INSERT INTO plugin_versions (plugin_id, version, manifest, notes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (plugin_id, version) DO UPDATE SET manifest = excluded.manifest, notes = excluded.notes`,
  )
    .bind(
      manifest.id,
      manifest.version,
      JSON.stringify(manifest),
      typeof body.notes === "string"
        ? (body.notes as string).slice(0, 4000)
        : null,
      now,
    )
    .run()
  const row = await getPluginRow(DB, manifest.id)
  return Response.json({
    ok: true,
    plugin: row ? pluginFromRow(row) : null,
    status,
    readme: readme !== null,
  })
}
