"no action"

import {
  type PluginManifest,
  validatePluginManifest,
} from "@open-bot/plugin-kit"
import { marketplaceWriteAuth, touchApiKey } from "../../lib/auth"
import { getPluginRow, getVersionRow, pluginFromRow } from "../../lib/db"
import { revalidatePluginPage } from "../../lib/page-cache"
import { shouldQueueReview } from "../../lib/review-state"
import {
  applySecurityReview,
  enqueueSecurityReview,
  queuedPublishBody,
  reviewViewFromRow,
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
