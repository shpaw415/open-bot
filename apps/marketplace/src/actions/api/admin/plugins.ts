"no action"

import { getPluginRow, pluginFromRow, searchPlugins } from "../../../lib/db"
import { revalidatePluginPage } from "../../../lib/page-cache"

function authorized(request: Request, token: string | undefined) {
  if (!token) return false
  const header = request.headers.get("authorization") ?? ""
  return header.replace(/^Bearer\s+/i, "") === token
}

export async function onRequestGet(context: EventContext<Env, never, never>) {
  if (!authorized(context.request, context.env.ADMIN_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const plugins = await searchPlugins(context.env.DB, { includeAll: true })
  return Response.json({ plugins })
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  if (!authorized(context.request, context.env.ADMIN_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  let body: { id?: unknown; status?: unknown; ownerUserId?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id.trim() : ""
  const status = typeof body.status === "string" ? body.status : ""
  const ownerUserId =
    typeof body.ownerUserId === "string" ? body.ownerUserId.trim() : ""
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 })
  }
  if (status && !["approved", "rejected", "pending"].includes(status)) {
    return Response.json(
      { error: "status must be approved|rejected|pending" },
      { status: 400 },
    )
  }
  if (
    ownerUserId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      ownerUserId,
    )
  ) {
    return Response.json(
      { error: "ownerUserId must be a user id (uuid) or omitted" },
      { status: 400 },
    )
  }
  if (!status && !ownerUserId) {
    return Response.json(
      {
        error: "status (approved|rejected|pending) or ownerUserId is required",
      },
      { status: 400 },
    )
  }
  const row = await getPluginRow(context.env.DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  if (ownerUserId) {
    // Legacy ownerless rows (instance-token publishes before ownership
    // existed) can never be claimed by an account — the admin assigns the
    // owner once so the listing can be republished or sold.
    await context.env.DB.prepare(
      "UPDATE plugins SET owner_user_id = ?2, updated_at = ?3 WHERE id = ?1",
    )
      .bind(id, ownerUserId, Date.now())
      .run()
  }
  if (status) {
    await context.env.DB.prepare(
      "UPDATE plugins SET status = ?2, updated_at = ?3 WHERE id = ?1",
    )
      .bind(id, status, Date.now())
      .run()
  }
  const updated = await getPluginRow(context.env.DB, id)
  await revalidatePluginPage(id, context).catch(() => undefined)
  return Response.json({
    ok: true,
    plugin: updated ? pluginFromRow(updated) : null,
  })
}
