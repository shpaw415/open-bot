-- Plugin gifting: a comped lifetime license stored in the purchases ledger.
-- Gift rows are status='paid' with amount/fee/earnings = 0 and no Stripe ids,
-- so hasLicense honors them with no change; is_gift keeps money math clean.
ALTER TABLE purchases ADD COLUMN is_gift INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN gifted_by TEXT;
ALTER TABLE purchases ADD COLUMN gift_note TEXT;
CREATE INDEX IF NOT EXISTS purchases_gifted ON purchases (plugin_id, is_gift, status);
