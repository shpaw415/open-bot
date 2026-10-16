"no action"

import { getSessionUser } from "../../../../lib/auth"
import { getPluginRow } from "../../../../lib/db"
import { revalidatePluginPage } from "../../../../lib/page-cache"
import { getPayoutAccount } from "../../../../lib/payouts"
import {
  createPurchase,
  hasLicense,
  priceText,
} from "../../../../lib/purchases"
import {
  createCheckoutSession,
  feeSplit,
  platformFeeBps,
  stripeConfigured,
} from "../../../../lib/stripe"

// Starts a Stripe Checkout session for a paid plugin (one-time purchase,
// destination charge to the author's Connect account). Browser session auth.
export async function onRequestPost(context: EventContext<Env, "id", never>) {
  const { DB } = context.env
  const user = await getSessionUser(DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!stripeConfigured(context.env)) {
    return Response.json(
      { error: "purchases are not configured on this marketplace" },
      { status: 503 },
    )
  }
  const id = decodeURIComponent(context.params.id as string)
  const plugin = await getPluginRow(DB, id)
  if (!plugin || plugin.status !== "approved") {
    return Response.json({ error: "plugin not found" }, { status: 404 })
  }
  const priceCents = plugin.price_cents ?? 0
  if (priceCents <= 0) {
    return Response.json({ error: "this plugin is free" }, { status: 400 })
  }
  if (await hasLicense(DB, user.userId, id)) {
    return Response.json({ ok: true, alreadyOwned: true })
  }
  // The author must have finished Stripe Express onboarding with payouts
  // enabled before their plugin can sell; the flag refreshes on the account
  // page and at every checkout.
  const account = await getPayoutAccount(DB, plugin.owner_user_id)
  if (!account || !account.payouts_enabled) {
    return Response.json(
      { error: "the author has not finished payout setup for this plugin" },
      { status: 409 },
    )
  }
  const versions = await DB.prepare(
    "SELECT version FROM plugin_versions WHERE plugin_id = ?1 ORDER BY created_at DESC",
  )
    .bind(id)
    .first<{ version: string }>()
  const { feeCents, earningsCents } = feeSplit(
    priceCents,
    platformFeeBps(context.env),
  )
  const origin = new URL(context.request.url).origin
  let purchase: { id: string; url: string }
  try {
    // A pending row first so the Checkout session metadata carries a stable
    // purchase id; the webhook flips it to paid.
    const placeholder = await createPurchase(DB, {
      userId: user.userId,
      plugin,
      version: versions?.version ?? plugin.latest_version,
      amountCents: priceCents,
      feeCents,
      earningsCents,
      sessionId: `pending-${crypto.randomUUID()}`,
    })
    const session = await createCheckoutSession(context.env, {
      purchaseId: placeholder.id,
      pluginId: plugin.id,
      pluginName: plugin.name,
      amountCents: priceCents,
      feeCents,
      destinationAccount: account.stripe_account_id,
      origin,
    })
    await DB.prepare(
      "UPDATE purchases SET stripe_session_id = ?2 WHERE id = ?1",
    )
      .bind(placeholder.id, session.id)
      .run()
    purchase = { id: placeholder.id, url: session.url }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "could not start checkout",
      },
      { status: 502 },
    )
  }
  await revalidatePluginPage(id, context).catch(() => undefined)
  return Response.json({
    ok: true,
    purchaseId: purchase.id,
    checkoutUrl: purchase.url,
    priceText: priceText(priceCents),
  })
}
