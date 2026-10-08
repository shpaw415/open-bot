"no action"

import { getSessionUser } from "../../../lib/auth"

export async function onRequestGet(context: EventContext<Env, never, never>) {
  const user = await getSessionUser(context.env.DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  return Response.json({ user })
}
