"no action"

import { getPluginRow } from "../../../../lib/db"

export async function onRequestPost(context: EventContext<Env, "id", never>) {
  const header = context.request.headers.get("authorization") ?? ""
  if (!/^Bearer\s+/i.test(header)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  const row = await getPluginRow(context.env.DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  await context.env.DB.prepare(
    "UPDATE plugins SET downloads = downloads + 1, updated_at = ?1 WHERE id = ?2",
  )
    .bind(Date.now(), id)
    .run()
  return Response.json({ ok: true, downloads: row.downloads + 1 })
}
