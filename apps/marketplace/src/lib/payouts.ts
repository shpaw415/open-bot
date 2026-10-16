import { getSessionUser } from "./auth"
import {
  createExpressAccount,
  retrieveAccount,
  stripeConfigured,
} from "./stripe"

export type PayoutAccountRow = {
  user_id: string
  stripe_account_id: string
  charges_enabled: number
  payouts_enabled: number
  created_at: number
  updated_at: number
}

export async function getPayoutAccount(
  db: D1Database,
  userId: string | null | undefined,
): Promise<PayoutAccountRow | null> {
  if (!userId) return null
  return (await db
    .prepare("SELECT * FROM payout_accounts WHERE user_id = ?1")
    .bind(userId)
    .first<PayoutAccountRow>()) as PayoutAccountRow | null
}

// Refreshes the enabled flags from Stripe (the Express dashboard flips them
// when the author finishes onboarding). Missing Stripe config is a no-op.
export async function refreshPayoutAccount(
  env: Env,
  db: D1Database,
  userId: string,
): Promise<PayoutAccountRow | null> {
  const row = await getPayoutAccount(db, userId)
  if (!row || !stripeConfigured(env)) return row
  try {
    const status = await retrieveAccount(env, row.stripe_account_id)
    await db
      .prepare(
        `UPDATE payout_accounts SET charges_enabled = ?2, payouts_enabled = ?3, updated_at = ?4 WHERE user_id = ?1`,
      )
      .bind(
        userId,
        status.chargesEnabled ? 1 : 0,
        status.payoutsEnabled ? 1 : 0,
        Date.now(),
      )
      .run()
  } catch {
    // Keep the stored flags on a Stripe hiccup.
  }
  return getPayoutAccount(db, userId)
}

// Creates the Connect Express account on first onboarding (never overwrites).
export async function ensurePayoutAccount(
  env: Env,
  db: D1Database,
  user: { userId: string; email: string | null },
): Promise<PayoutAccountRow> {
  const existing = await getPayoutAccount(db, user.userId)
  if (existing) return existing
  const created = await createExpressAccount(env, user.email)
  if (!created.id) throw new Error("stripe did not return an account id")
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO payout_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, created_at, updated_at)
       VALUES (?1, ?2, 0, 0, ?3, ?3)
       ON CONFLICT (user_id) DO NOTHING`,
    )
    .bind(user.userId, created.id, now)
    .run()
  return (await getPayoutAccount(db, user.userId)) as PayoutAccountRow
}

export async function requireSessionUser(
  db: D1Database,
  request: Request,
): Promise<{
  userId: string
  email: string | null
  name: string | null
} | null> {
  return getSessionUser(db, request)
}
