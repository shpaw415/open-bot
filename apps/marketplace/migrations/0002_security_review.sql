ALTER TABLE plugins ADD COLUMN security_status TEXT;
ALTER TABLE plugin_versions ADD COLUMN security_status TEXT;
ALTER TABLE plugin_versions ADD COLUMN security_findings TEXT;
ALTER TABLE plugin_versions ADD COLUMN artifact_key TEXT;
ALTER TABLE plugin_versions ADD COLUMN artifact_sha256 TEXT;
ALTER TABLE plugin_versions ADD COLUMN analyzed_at INTEGER;
