-- Paid premium plugins: Stripe Checkout (one-time) + Connect Express payouts.
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  earnings_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  refunded_at INTEGER,
  refund_reason TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS purchases_user ON purchases (user_id, status);
CREATE INDEX IF NOT EXISTS purchases_plugin ON purchases (plugin_id, user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS purchases_session ON purchases (stripe_session_id);
CREATE INDEX IF NOT EXISTS purchases_owner ON purchases (plugin_id, status, paid_at);

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id TEXT PRIMARY KEY,
  stripe_account_id TEXT NOT NULL,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE plugins ADD COLUMN price_cents INTEGER;
ALTER TABLE plugin_versions ADD COLUMN price_cents INTEGER;
