"no action"

import { listPurchases } from "../../../lib/purchases"

function authorized(request: Request, token: string | undefined) {
  if (!token) return false
  const header = request.headers.get("authorization") ?? ""
  return header.replace(/^Bearer\s+/i, "") === token
}

// Admin purchase ledger backing the admin page's Purchases panel.
export async function onRequestGet(context: EventContext<Env, never, never>) {
  if (!authorized(context.request, context.env.ADMIN_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = new URL(context.request.url)
  const purchases = await listPurchases(context.env.DB, {
    status: url.searchParams.get("status") ?? undefined,
    pluginId: url.searchParams.get("pluginId") ?? undefined,
  })
  return Response.json({ purchases })
}
