"no action"

import { generateApiKey, getSessionUser } from "../../../lib/auth"

export async function onRequestGet(context: EventContext<Env, never, never>) {
  const user = await getSessionUser(context.env.DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const result = await context.env.DB.prepare(
    `SELECT id, label, key_hint, created_at, last_used_at, revoked_at
     FROM api_keys WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.userId)
    .all<{
      id: string
      label: string
      key_hint: string
      created_at: number
      last_used_at: number | null
      revoked_at: number | null
    }>()
  return Response.json({
    user,
    keys: (result.results ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      hint: row.key_hint,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revoked: row.revoked_at !== null,
    })),
  })
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  const user = await getSessionUser(context.env.DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  let body: { label?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    body = {}
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : "default"
  const { key, hash, hint } = await generateApiKey()
  const id = crypto.randomUUID()
  const now = Date.now()
  await context.env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, key_hint, label, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, user.userId, hash, hint, label, now)
    .run()
  return Response.json({ ok: true, key, id, label, hint })
}
