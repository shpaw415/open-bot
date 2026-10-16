"no action"

import {
  type PluginManifest,
  REVIEW_MANIFEST_CHARS,
  validatePluginManifest,
} from "@open-bot/plugin-kit"
import { marketplaceWriteAuth, touchApiKey } from "../../lib/auth"
import { getPluginRow, getVersionRow, pluginFromRow } from "../../lib/db"
import { revalidatePluginPage } from "../../lib/page-cache"
import { publishOwnerAllowed, shouldQueueReview } from "../../lib/review-state"
import {
  applySecurityReview,
  enqueueSecurityReview,
  queuedPublishBody,
  reviewViewFromRow,
  schemaSelfCheck,
} from "../../lib/review-store"
import { fetchReadme, reviewPublish } from "../../lib/security"

const enqueueError = {
  status: "error" as const,
  findings: [],
  severity: null,
  artifactKey: null,
  artifactSha256: null,
  issueUrl: null,
  error: "failed to enqueue security review",
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  const { DB, MARKETPLACE_TOKEN } = context.env
  const writer = await marketplaceWriteAuth(
    DB,
    context.request,
    MARKETPLACE_TOKEN,
  )
  if (!writer) return Response.json({ error: "unauthorized" }, { status: 401 })
  // Migration guard (the 0005 lesson): a Pages deploy that lands before the
  // remote D1 migrate must fail with a diagnosable error instead of a raw
  // D1 500 on every publish.
  const schema = await schemaSelfCheck(DB)
  if (!schema.ok) {
    return Response.json(
      { error: schema.error, code: "migration_missing" },
      { status: 503 },
    )
  }
  if (writer.keyId) void touchApiKey(DB, writer.keyId).catch(() => undefined)
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
  // The reviewer reads at most REVIEW_MANIFEST_CHARS of manifest JSON
  // (security-relevant fields first) — a manifest past that window would
  // ship content no reviewer ever saw. (Payload bytes are enforced per-file
  // and in total at review time, against the real tarball.)
  if (JSON.stringify(manifest).length > REVIEW_MANIFEST_CHARS) {
    return Response.json(
      {
        error: `manifest is ${JSON.stringify(manifest).length} chars; the security review window is ${REVIEW_MANIFEST_CHARS} — trim skills, personas, tools, or cron content`,
      },
      { status: 400 },
    )
  }
  const existing = await getPluginRow(DB, manifest.id)
  if (
    !publishOwnerAllowed(
      Boolean(existing),
      existing?.owner_user_id,
      writer.userId,
    )
  ) {
    return Response.json(
      { error: "not the plugin owner", code: "plugin_owner" },
      { status: 403 },
    )
  }
  const notes =
    typeof body.notes === "string" ? body.notes.slice(0, 4000) : null
  const readme = await fetchReadme(
    manifest.repo,
    `v${manifest.version}`,
    context.env.GITHUB_TOKEN,
  )
  const queued = await enqueueSecurityReview(
    context.env,
    manifest,
    readme,
    notes,
    existing ? null : writer.userId,
  )
  const queue = shouldQueueReview(
    Boolean(context.env.SECURITY_REVIEW),
    new URL(context.request.url).hostname,
    context.env.SECURITY_REVIEW_ASYNC,
  )
  if (queue && context.env.SECURITY_REVIEW) {
    try {
      await context.env.SECURITY_REVIEW.send({
        pluginId: manifest.id,
        version: manifest.version,
        enqueuedAt: queued.enqueuedAt,
      })
    } catch (error) {
      console.error("security review enqueue failed", error)
      await applySecurityReview(
        context.env,
        manifest,
        enqueueError,
        queued.enqueuedAt,
        readme,
      )
      return Response.json(
        { error: "failed to enqueue security review" },
        { status: 503 },
      )
    }
  } else {
    const review = await reviewPublish(context.env, manifest, readme)
    await applySecurityReview(
      context.env,
      manifest,
      review,
      queued.enqueuedAt,
      readme,
    )
  }
  const row = await getPluginRow(DB, manifest.id)
  const version = await getVersionRow(DB, manifest.id, manifest.version)
  await revalidatePluginPage(manifest.id, context).catch(() => undefined)
  return Response.json(
    queuedPublishBody(
      manifest,
      row?.status ?? "pending",
      readme !== null,
      row ? pluginFromRow(row) : null,
      version ? reviewViewFromRow(version) : queued.review,
    ),
  )
}
