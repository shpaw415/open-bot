"no action"

import { getPluginRow, pluginFromRow, searchPlugins } from "../../../lib/db"

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
  let body: { id?: unknown; status?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id.trim() : ""
  const status = typeof body.status === "string" ? body.status : ""
  if (!id || !["approved", "rejected", "pending"].includes(status)) {
    return Response.json(
      { error: "id and status (approved|rejected|pending) are required" },
      { status: 400 },
    )
  }
  const row = await getPluginRow(context.env.DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  await context.env.DB.prepare(
    "UPDATE plugins SET status = ?2, updated_at = ?3 WHERE id = ?1",
  )
    .bind(id, status, Date.now())
    .run()
  const updated = await getPluginRow(context.env.DB, id)
  return Response.json({
    ok: true,
    plugin: updated ? pluginFromRow(updated) : null,
  })
}
