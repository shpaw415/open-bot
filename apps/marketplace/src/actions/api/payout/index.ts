"no action"

import { getSessionUser } from "../../../lib/auth"
import { ensurePayoutAccount, refreshPayoutAccount } from "../../../lib/payouts"
import { getOwnerSales } from "../../../lib/purchases"
import { createAccountLink, stripeConfigured } from "../../../lib/stripe"

// Author payout surface: Connect Express account status + sales summary (GET),
// onboarding link creation (POST). Browser session auth.
export async function onRequestGet(context: EventContext<Env, never, never>) {
  const { DB } = context.env
  const user = await getSessionUser(DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!stripeConfigured(context.env)) {
    return Response.json({ configured: false, account: null })
  }
  const account = await refreshPayoutAccount(context.env, DB, user.userId)
  const sales = await getOwnerSales(DB, user.userId)
  const totalCents = sales.reduce((sum, sale) => sum + sale.earningsCents, 0)
  return Response.json({
    configured: true,
    account: account
      ? {
          connected: true,
          chargesEnabled: account.charges_enabled === 1,
          payoutsEnabled: account.payouts_enabled === 1,
        }
      : { connected: false, chargesEnabled: false, payoutsEnabled: false },
    earnings: {
      totalCents,
      currency: "usd",
      count: sales.length,
      recent: sales.slice(0, 20),
    },
  })
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  const { DB } = context.env
  const user = await getSessionUser(DB, context.request)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!stripeConfigured(context.env)) {
    return Response.json(
      { error: "payouts are not configured on this marketplace" },
      { status: 503 },
    )
  }
  let account: { stripe_account_id: string }
  try {
    account = await ensurePayoutAccount(context.env, DB, user)
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "could not create account",
      },
      { status: 502 },
    )
  }
  try {
    const link = await createAccountLink(
      context.env,
      account.stripe_account_id,
      new URL(context.request.url).origin,
    )
    if (!link.url) throw new Error("stripe did not return an onboarding link")
    return Response.json({ ok: true, onboardingUrl: link.url })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "could not create link",
      },
      { status: 502 },
    )
  }
}
