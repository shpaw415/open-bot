"no action"

import {
  getPurchaseBySession,
  markPurchasePaid,
  markPurchaseRefunded,
} from "../../../lib/purchases"
import { verifyStripeSignature } from "../../../lib/stripe"

type StripeEvent = {
  id?: unknown
  type?: unknown
  data?: {
    object?: {
      id?: unknown
      metadata?: { purchase_id?: unknown }
      payment_intent?: unknown
    }
  }
}

// Stripe webhook: the single source of truth for purchase state. Signature
// verified against STRIPE_WEBHOOK_SECRET; every flip is idempotent so Stripe
// retries are harmless.
export async function onRequestPost(context: EventContext<Env, never, never>) {
  const secret = context.env.STRIPE_WEBHOOK_SECRET
  const raw = await context.request.text()
  if (
    !(await verifyStripeSignature(
      raw,
      context.request.headers.get("stripe-signature"),
      secret ?? "",
    ))
  ) {
    return Response.json({ error: "invalid signature" }, { status: 400 })
  }
  let event: StripeEvent
  try {
    event = JSON.parse(raw) as StripeEvent
  } catch {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }
  const type = typeof event.type === "string" ? event.type : ""
  const object = event.data?.object ?? {}
  const db = context.env.DB
  if (type === "checkout.session.completed") {
    const purchaseId =
      typeof object.metadata?.purchase_id === "string"
        ? object.metadata.purchase_id
        : ""
    const session =
      typeof object.id === "string"
        ? await getPurchaseBySession(db, object.id)
        : null
    const id = purchaseId || session?.id || ""
    if (id) {
      const paymentIntent =
        typeof object.payment_intent === "string" ? object.payment_intent : ""
      await markPurchasePaid(db, id, paymentIntent)
    }
  } else if (type === "charge.refunded") {
    const paymentIntent =
      typeof object.payment_intent === "string" ? object.payment_intent : ""
    if (paymentIntent) {
      const row = await db
        .prepare(
          "SELECT id FROM purchases WHERE stripe_payment_intent_id = ?1 LIMIT 1",
        )
        .bind(paymentIntent)
        .first<{ id: string }>()
      if (row) {
        await markPurchaseRefunded(db, row.id, "stripe charge.refunded webhook")
      }
    }
  }
  // Unhandled event types are acknowledged so Stripe stops retrying.
  return Response.json({ received: true })
}
