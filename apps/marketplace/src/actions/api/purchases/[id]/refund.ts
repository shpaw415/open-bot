"no action"

import {
  getPurchase,
  listPurchases,
  markPurchaseRefunded,
  priceText,
} from "../../../../lib/purchases"
import { createRefund, stripeConfigured } from "../../../../lib/stripe"

function authorized(request: Request, token: string | undefined) {
  if (!token) return false
  const header = request.headers.get("authorization") ?? ""
  return header.replace(/^Bearer\s+/i, "") === token
}

// Admin purchase ledger (GET) and refunds (POST). Refund pulls the transfer
// back out of the author's Connect balance and revokes the license — the
// charge.refunded webhook mirrors the row flip.
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

export async function onRequestPost(context: EventContext<Env, never, never>) {
  if (!authorized(context.request, context.env.ADMIN_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!stripeConfigured(context.env)) {
    return Response.json({ error: "stripe is not configured" }, { status: 503 })
  }
  let body: { purchaseId?: unknown; reason?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const purchaseId = typeof body.purchaseId === "string" ? body.purchaseId : ""
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "admin refund"
  const purchase = purchaseId
    ? await getPurchase(context.env.DB, purchaseId)
    : null
  if (!purchase) {
    return Response.json({ error: "purchase not found" }, { status: 404 })
  }
  if (purchase.status === "refunded") {
    return Response.json({ ok: true, purchase, alreadyRefunded: true })
  }
  if (purchase.status !== "paid" || !purchase.stripe_payment_intent_id) {
    return Response.json(
      { error: "only paid purchases can be refunded" },
      { status: 400 },
    )
  }
  try {
    const refund = await createRefund(
      context.env,
      purchase.stripe_payment_intent_id,
    )
    if (!refund.id) throw new Error("stripe did not return a refund id")
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "refund request failed",
      },
      { status: 502 },
    )
  }
  const updated = await markPurchaseRefunded(
    context.env.DB,
    purchase.id,
    `${reason} (admin)`,
  )
  return Response.json({
    ok: true,
    purchase: updated,
    refundAmount: priceText(purchase.amount_cents),
  })
}
