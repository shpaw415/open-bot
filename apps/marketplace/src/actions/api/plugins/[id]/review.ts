"no action"

import { marketplaceWriteAuth, touchApiKey } from "../../../../lib/auth"
import { getPluginRow, getVersionRow } from "../../../../lib/db"
import { reviewViewFromRow } from "../../../../lib/review-store"

export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const { DB, MARKETPLACE_TOKEN } = context.env
  const writer = await marketplaceWriteAuth(
    DB,
    context.request,
    MARKETPLACE_TOKEN,
  )
  if (!writer) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (writer.keyId) void touchApiKey(DB, writer.keyId).catch(() => undefined)
  const id = decodeURIComponent(context.params.id as string)
  if (!id)
    return Response.json({ error: "plugin id is required" }, { status: 400 })
  const plugin = await getPluginRow(DB, id)
  if (!plugin)
    return Response.json({ error: "plugin not found" }, { status: 404 })
  const url = new URL(context.request.url)
  const version = url.searchParams.get("version") ?? plugin.latest_version
  const row = await getVersionRow(DB, id, version)
  if (!row)
    return Response.json({ error: "version not found" }, { status: 404 })
  const review = reviewViewFromRow(row)
  return Response.json({
    pluginId: id,
    version,
    status: review.status,
    pluginStatus: plugin.status,
    analyzedAt: row.analyzed_at,
    enqueuedAt: row.review_enqueued_at,
    security: review,
  })
}
