"no action"

import { adminAuthorized } from "../../../lib/auth"
import { listPurchases } from "../../../lib/purchases"

// Admin purchase ledger backing the admin page's Purchases panel.
export async function onRequestGet(context: EventContext<Env, never, never>) {
  if (!(await adminAuthorized(context.request, context.env.ADMIN_TOKEN))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = new URL(context.request.url)
  const purchases = await listPurchases(context.env.DB, {
    status: url.searchParams.get("status") ?? undefined,
    pluginId: url.searchParams.get("pluginId") ?? undefined,
  })
  return Response.json({ purchases })
}
