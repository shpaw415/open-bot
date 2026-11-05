-- Product-report issues: ob-improve findings relayed from open-bot
-- instances, managed here and pushed to the relevant GitHub repo (the
-- open-bot repo, or a plugin listing's repo). plugin_id NULL = open-bot.
-- fingerprint dedupes repeat reports across instances (hits); a done or
-- wontfix issue refiled with the same fingerprint opens a fresh row.
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT,
  repo TEXT NOT NULL,
  kind TEXT NOT NULL,
  surface TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  github_url TEXT,
  github_number INTEGER,
  push_error TEXT,
  pushed_at INTEGER,
  author TEXT,
  author_kind TEXT,
  report_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS issues_fingerprint_status ON issues (fingerprint, status);
CREATE INDEX IF NOT EXISTS issues_plugin ON issues (plugin_id, created_at);
CREATE INDEX IF NOT EXISTS issues_status ON issues (status, last_seen_at);
