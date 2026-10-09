"no action"

import { getSessionUser } from "../../../lib/auth"

export async function onRequestDelete(context: EventContext<Env, "id", never>) {
  const user = await getSessionUser(context.env.DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const id = decodeURIComponent(context.params.id as string)
  const result = await context.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?3
     WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
  )
    .bind(id, user.userId, Date.now())
    .run()
  if (!result.meta.changes) {
    return Response.json({ error: "key not found" }, { status: 404 })
  }
  return Response.json({ ok: true })
}
