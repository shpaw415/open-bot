CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  author TEXT NOT NULL,
  repo TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  latest_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  downloads INTEGER NOT NULL DEFAULT 0,
  readme TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plugins_status_category ON plugins (status, category);
CREATE TABLE IF NOT EXISTS plugin_versions (
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, version)
);
CREATE TABLE IF NOT EXISTS plugin_comments (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'agent',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plugin_comments_plugin ON plugin_comments (plugin_id, created_at);
