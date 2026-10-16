import type { PluginRow } from "./db"

export type PurchaseRow = {
  id: string
  user_id: string
  plugin_id: string
  version: string
  amount_cents: number
  fee_cents: number
  earnings_cents: number
  currency: string
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  status: "pending" | "paid" | "refunded"
  refunded_at: number | null
  refund_reason: string | null
  created_at: number
  paid_at: number | null
}

export type PurchaseView = {
  id: string
  pluginId: string
  pluginName: string
  version: string
  amountCents: number
  status: PurchaseRow["status"]
  createdAt: number
  paidAt: number | null
  refundedAt: number | null
}

export type SaleView = PurchaseView & {
  feeCents: number
  earningsCents: number
}

export function priceText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function view(row: PurchaseRow, pluginName: string | null): PurchaseView {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    pluginName: pluginName ?? row.plugin_id,
    version: row.version,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
  }
}

function saleView(row: PurchaseRow, pluginName: string | null): SaleView {
  return {
    ...view(row, pluginName),
    feeCents: row.fee_cents,
    earningsCents: row.earnings_cents,
  }
}

// The buyer's lifetime license for a plugin: exactly one paid purchase.
// Refunded purchases do not count.
export async function hasLicense(
  db: D1Database,
  userId: string,
  pluginId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM purchases WHERE user_id = ?1 AND plugin_id = ?2 AND status = 'paid' LIMIT 1",
    )
    .bind(userId, pluginId)
    .first<{ id: string }>()
  return row !== null
}

export async function createPurchase(
  db: D1Database,
  opts: {
    userId: string
    plugin: PluginRow
    version: string
    amountCents: number
    feeCents: number
    earningsCents: number
    sessionId: string
  },
): Promise<PurchaseRow> {
  const row: PurchaseRow = {
    id: crypto.randomUUID(),
    user_id: opts.userId,
    plugin_id: opts.plugin.id,
    version: opts.version,
    amount_cents: opts.amountCents,
    fee_cents: opts.feeCents,
    earnings_cents: opts.earningsCents,
    currency: "usd",
    stripe_session_id: opts.sessionId,
    stripe_payment_intent_id: null,
    status: "pending",
    refunded_at: null,
    refund_reason: null,
    created_at: Date.now(),
    paid_at: null,
  }
  await db
    .prepare(
      `INSERT INTO purchases (id, user_id, plugin_id, version, amount_cents, fee_cents, earnings_cents, currency, stripe_session_id, stripe_payment_intent_id, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 'pending', ?10)`,
    )
    .bind(
      row.id,
      row.user_id,
      row.plugin_id,
      row.version,
      row.amount_cents,
      row.fee_cents,
      row.earnings_cents,
      row.currency,
      row.stripe_session_id,
      row.created_at,
    )
    .run()
  return row
}

// Webhook-driven state flips — idempotent so Stripe retries are harmless.
export async function markPurchasePaid(
  db: D1Database,
  purchaseId: string,
  paymentIntentId: string,
): Promise<PurchaseRow | null> {
  const written = await db
    .prepare(
      `UPDATE purchases SET status = 'paid', stripe_payment_intent_id = ?2, paid_at = ?3
       WHERE id = ?1 AND stripe_session_id IS NOT NULL
         AND (status = 'pending' OR stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = ?2)`,
    )
    .bind(purchaseId, paymentIntentId, Date.now())
    .run()
  if ((written.meta.changes ?? 0) === 0) {
    return getPurchase(db, purchaseId)
  }
  return getPurchase(db, purchaseId)
}

export async function markPurchaseRefunded(
  db: D1Database,
  purchaseId: string,
  reason: string,
): Promise<PurchaseRow | null> {
  await db
    .prepare(
      `UPDATE purchases SET status = 'refunded', refunded_at = ?2, refund_reason = ?3
       WHERE id = ?1 AND status != 'refunded'`,
    )
    .bind(purchaseId, Date.now(), reason.slice(0, 300))
    .run()
  return getPurchase(db, purchaseId)
}

export async function getPurchase(
  db: D1Database,
  purchaseId: string,
): Promise<PurchaseRow | null> {
  return (await db
    .prepare("SELECT * FROM purchases WHERE id = ?1")
    .bind(purchaseId)
    .first<PurchaseRow>()) as PurchaseRow | null
}

export async function getPurchaseBySession(
  db: D1Database,
  sessionId: string,
): Promise<PurchaseRow | null> {
  return (await db
    .prepare("SELECT * FROM purchases WHERE stripe_session_id = ?1")
    .bind(sessionId)
    .first<PurchaseRow>()) as PurchaseRow | null
}

export async function getUserPurchases(
  db: D1Database,
  userId: string,
): Promise<PurchaseView[]> {
  const result = await db
    .prepare(
      `SELECT p.*, pl.name AS plugin_name FROM purchases p
       LEFT JOIN plugins pl ON pl.id = p.plugin_id
       WHERE p.user_id = ?1 ORDER BY p.created_at DESC LIMIT 200`,
    )
    .bind(userId)
    .all<PurchaseRow & { plugin_name?: string | null }>()
  return (result.results ?? []).map((row) => view(row, row.plugin_name ?? null))
}

// Author sales: purchases of plugins owned by this user, joined to the plugin
// name for display.
export async function getOwnerSales(
  db: D1Database,
  ownerId: string,
): Promise<SaleView[]> {
  const result = await db
    .prepare(
      `SELECT p.*, pl.name AS plugin_name FROM purchases p
       JOIN plugins pl ON pl.id = p.plugin_id AND pl.owner_user_id = ?1
       WHERE p.status = 'paid'
       ORDER BY p.paid_at DESC LIMIT 200`,
    )
    .bind(ownerId)
    .all<PurchaseRow & { plugin_name?: string | null }>()
  return (result.results ?? []).map((row) =>
    saleView(row, row.plugin_name ?? null),
  )
}

// The admin purchase list (refund surface): newest first with plugin names.
export async function listPurchases(
  db: D1Database,
  filter: { status?: string; pluginId?: string },
): Promise<SaleView[]> {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (filter.status) {
    clauses.push("p.status = ?")
    params.push(filter.status)
  }
  if (filter.pluginId) {
    clauses.push("p.plugin_id = ?")
    params.push(filter.pluginId)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const result = await db
    .prepare(
      `SELECT p.*, pl.name AS plugin_name FROM purchases p
       LEFT JOIN plugins pl ON pl.id = p.plugin_id
       ${where} ORDER BY p.created_at DESC LIMIT 500`,
    )
    .bind(...params)
    .all<PurchaseRow & { plugin_name?: string | null }>()
  return (result.results ?? []).map((row) =>
    saleView(row, row.plugin_name ?? null),
  )
}

// Keeps plugins.price_cents in sync with the current listing version's price.
export async function syncListingPrice(
  db: D1Database,
  pluginId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE plugins SET price_cents = (
         SELECT price_cents FROM plugin_versions
         WHERE plugin_id = ?1 AND version = (SELECT latest_version FROM plugins WHERE id = ?1)
       ) WHERE id = ?1`,
    )
    .bind(pluginId)
    .run()
}
