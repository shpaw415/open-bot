"no action"

import { getSessionUser } from "../../../lib/auth"
import { getUserPurchases } from "../../../lib/purchases"

// The signed-in buyer's purchase history (account page).
export async function onRequestGet(context: EventContext<Env, never, never>) {
  const user = await getSessionUser(context.env.DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const purchases = await getUserPurchases(context.env.DB, user.userId)
  return Response.json({ user, purchases })
}
