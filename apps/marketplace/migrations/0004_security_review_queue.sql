ALTER TABLE plugin_versions ADD COLUMN review_enqueued_at INTEGER;
ALTER TABLE plugin_versions ADD COLUMN security_error TEXT;
ALTER TABLE plugin_versions ADD COLUMN issue_url TEXT;
