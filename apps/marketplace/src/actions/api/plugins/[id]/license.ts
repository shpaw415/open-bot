"no action"

import { apiKeyAuth, timingSafeEqualString } from "../../../../lib/auth"
import { getPluginRow } from "../../../../lib/db"
import { hasLicense } from "../../../../lib/purchases"

// Entitlement check for open-bot instances (control plane): is this plugin
// paid, and does the caller's marketplace user API key hold a license?
// Free plugins answer {paid:false}. An instance token alone never grants a
// license — installs of paid plugins must ride a buyer's obm_ key.
export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const { DB, MARKETPLACE_TOKEN } = context.env
  const apiKey = await apiKeyAuth(DB, context.request)
  let userId: string | null = apiKey?.userId ?? null
  if (!userId && MARKETPLACE_TOKEN) {
    const token = (context.request.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    )
    // Authenticated instance token: valid caller, but licenses belong to
    // users, so it only receives the paid/price facts below.
    if (token && timingSafeEqualString(token, MARKETPLACE_TOKEN)) {
      userId = null
    } else {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }
  } else if (!apiKey && !MARKETPLACE_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  const plugin = await getPluginRow(DB, id)
  if (!plugin)
    return Response.json({ error: "plugin not found" }, { status: 404 })
  const priceCents = plugin.price_cents ?? 0
  const paid = priceCents > 0
  // The author self-grant: the owner_user_id check publish enforces doubles
  // as a free lifetime license for post-publish verification installs —
  // buying your own plugin is not a step anyone should have to take.
  const author = paid && userId !== null && plugin.owner_user_id === userId
  const licensed =
    paid && userId ? author || (await hasLicense(DB, userId, id)) : false
  return Response.json({
    paid,
    licensed,
    author,
    priceCents: paid ? priceCents : null,
    status: plugin.status,
  })
}
