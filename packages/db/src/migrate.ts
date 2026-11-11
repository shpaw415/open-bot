import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function tableNames(sqlite: Database) {
  return new Set(
    (
      sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name),
  )
}

function indexNames(sqlite: Database) {
  return new Set(
    (
      sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name),
  )
}

function columnNames(sqlite: Database, table: string) {
  return new Set(
    (
      sqlite.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map((column) => column.name),
  )
}

function journalEntries(migrationsFolder: string) {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: { when: number; tag: string }[] }
  return journal.entries
}

function ensureCronJobColumns(sqlite: Database) {
  if (!tableNames(sqlite).has("cron_jobs")) return
  const columns = columnNames(sqlite, "cron_jobs")
  if (!columns.has("session_id")) {
    sqlite.exec("ALTER TABLE cron_jobs ADD COLUMN session_id TEXT")
  }
  if (!columns.has("provider_id")) {
    sqlite.exec("ALTER TABLE cron_jobs ADD COLUMN provider_id TEXT")
  }
  if (!columns.has("model_id")) {
    sqlite.exec("ALTER TABLE cron_jobs ADD COLUMN model_id TEXT")
  }
  if (!columns.has("persona_id")) {
    sqlite.exec("ALTER TABLE cron_jobs ADD COLUMN persona_id TEXT")
  }
  if (!columns.has("run_kind")) {
    sqlite.exec(
      "ALTER TABLE cron_jobs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'prompt'",
    )
  }
  if (!columns.has("script")) {
    sqlite.exec("ALTER TABLE cron_jobs ADD COLUMN script TEXT")
  }
}

function ensureImprovementTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS improvements (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      kind TEXT NOT NULL,
      surface TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      resolved_at INTEGER,
      plugin TEXT,
      routed_to TEXT,
      issue_url TEXT,
      external_id TEXT
    );
    CREATE INDEX IF NOT EXISTS improvements_fingerprint_status ON improvements (fingerprint, status);
    CREATE INDEX IF NOT EXISTS improvements_user_time ON improvements (user_id, created_at);
  `)
  const columns = columnNames(sqlite, "improvements")
  if (!columns.has("plugin")) {
    sqlite.exec("ALTER TABLE improvements ADD COLUMN plugin TEXT")
  }
  if (!columns.has("routed_to")) {
    sqlite.exec("ALTER TABLE improvements ADD COLUMN routed_to TEXT")
  }
  if (!columns.has("issue_url")) {
    sqlite.exec("ALTER TABLE improvements ADD COLUMN issue_url TEXT")
  }
  if (!columns.has("external_id")) {
    sqlite.exec("ALTER TABLE improvements ADD COLUMN external_id TEXT")
  }
}

function ensureCronNoticeTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cron_notices (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      run_session_id TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL,
      viewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS cron_notices_user ON cron_notices (user_id, viewed_at);
  `)
  const columns = columnNames(sqlite, "cron_notices")
  if (columns.has("session_id")) {
    sqlite.exec("ALTER TABLE cron_notices DROP COLUMN session_id")
  }
  if (!columns.has("run_session_id")) {
    sqlite.exec("ALTER TABLE cron_notices ADD COLUMN run_session_id TEXT")
  }
}

function ensureThreadScreenTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_screens (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display INTEGER NOT NULL,
      rfb_port INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, session_id)
    );
  `)
}

function ensureThreadTitleTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_titles (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, session_id)
    );
  `)
}

function ensureThreadModelTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_models (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      effort TEXT,
      PRIMARY KEY (user_id, session_id)
    );
  `)
}

function ensureSandboxTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      profile TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sandbox_profiles_user_name
      ON sandbox_profiles (user_id, name);
    CREATE TABLE IF NOT EXISTS sandbox_threads (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      profile_id TEXT,
      profile TEXT NOT NULL,
      container TEXT NOT NULL,
      network TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sandbox_threads_user
      ON sandbox_threads (user_id, state);
    CREATE INDEX IF NOT EXISTS sandbox_threads_session
      ON sandbox_threads (session_id);
  `)
}

function ensureThreadQueueTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_queue (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      files TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS thread_queue_session ON thread_queue (user_id, session_id, seq);
  `)
}

function ensurePersonaTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      instruction TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS personas_user ON personas (user_id);
    CREATE TABLE IF NOT EXISTS thread_personas (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      PRIMARY KEY (user_id, session_id)
    );
  `)
}

function ensureBuiltinPersonaScopeTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS builtin_persona_scopes (
      user_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      skills_extra TEXT,
      skills_none INTEGER NOT NULL DEFAULT 0,
      mcp_extra TEXT,
      mcp_none INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, persona_id)
    );
  `)
  if (tableNames(sqlite).has("builtin_persona_scopes")) {
    const columns = columnNames(sqlite, "builtin_persona_scopes")
    if (!columns.has("skills_none")) {
      sqlite.exec(
        "ALTER TABLE builtin_persona_scopes ADD COLUMN skills_none INTEGER NOT NULL DEFAULT 0",
      )
    }
    if (!columns.has("mcp_none")) {
      sqlite.exec(
        "ALTER TABLE builtin_persona_scopes ADD COLUMN mcp_none INTEGER NOT NULL DEFAULT 0",
      )
    }
  }
  if (tableNames(sqlite).has("personas")) {
    const columns = columnNames(sqlite, "personas")
    if (!columns.has("skills_none")) {
      sqlite.exec(
        "ALTER TABLE personas ADD COLUMN skills_none INTEGER NOT NULL DEFAULT 0",
      )
    }
    if (!columns.has("mcp_none")) {
      sqlite.exec(
        "ALTER TABLE personas ADD COLUMN mcp_none INTEGER NOT NULL DEFAULT 0",
      )
    }
  }
}

// Built-in personas removed from the roster (only Assistant and the
// plugin creator remain): stored bindings to a removed id would fail to
// resolve — a cron run would throw "personality not found" — so thread
// bindings are rewritten to the assistant, cron jobs (which store the
// assistant as NULL) are cleared, and orphaned scope rows are dropped.
// Idempotent; runs on every open like the other ensure* fixups.
const REMOVED_BUILTIN_PERSONAS = [
  "designer",
  "political-expert",
  "software-designer",
]

function cleanupRemovedBuiltinPersonas(sqlite: Database) {
  const names = tableNames(sqlite)
  const ids = REMOVED_BUILTIN_PERSONAS.map((id) => `'${id}'`).join(", ")
  if (names.has("thread_personas")) {
    sqlite.exec(
      `UPDATE thread_personas SET persona_id = 'assistant' WHERE persona_id IN (${ids})`,
    )
  }
  if (
    names.has("cron_jobs") &&
    columnNames(sqlite, "cron_jobs").has("persona_id")
  ) {
    sqlite.exec(
      `UPDATE cron_jobs SET persona_id = NULL WHERE persona_id IN (${ids})`,
    )
  }
  if (names.has("builtin_persona_scopes")) {
    sqlite.exec(
      `DELETE FROM builtin_persona_scopes WHERE persona_id IN (${ids})`,
    )
  }
}

function ensureUserKeysTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_keys (
      user_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      api_key TEXT,
      account_id TEXT,
      gateway_id TEXT,
      gateway_token TEXT,
      gateway_slug TEXT,
      base_url TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, slug)
    );
  `)
}

function ensureProjectsTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_user ON projects (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS projects_user_name ON projects (user_id, name);
  `)
}

function ensureLegacyColumns(sqlite: Database) {
  const names = tableNames(sqlite)
  if (names.has("users")) {
    const columns = columnNames(sqlite, "users")
    if (!columns.has("must_change_password")) {
      sqlite.exec(
        "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1",
      )
    }
    if (!columns.has("disabled")) {
      sqlite.exec(
        "ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0",
      )
    }
  }
  if (names.has("desktops")) {
    const columns = columnNames(sqlite, "desktops")
    const add: Record<string, string> = {
      viking_base_url: "TEXT",
      viking_api_key: "TEXT",
      viking_embed_model: "TEXT",
      viking_embed_dimension: "INTEGER",
      viking_vlm_model: "TEXT",
      image_provider: "TEXT",
      image_account_id: "TEXT",
      image_api_key: "TEXT",
      image_model: "TEXT",
      video_provider: "TEXT",
      video_account_id: "TEXT",
      video_api_key: "TEXT",
      video_model: "TEXT",
      model3d_provider: "TEXT",
      model3d_account_id: "TEXT",
      model3d_api_key: "TEXT",
      model3d_model: "TEXT",
      system1_provider: "TEXT",
      system1_endpoint: "TEXT",
      system1_api_key: "TEXT",
      system1_gateway_token: "TEXT",
      system1_model: "TEXT",
      system1_account_id: "TEXT",
      system1_gateway_id: "TEXT",
      system1_slug: "TEXT",
    }
    for (const [name, type] of Object.entries(add)) {
      if (!columns.has(name)) {
        sqlite.exec(`ALTER TABLE desktops ADD COLUMN ${name} ${type}`)
      }
    }
  }
}

function migrationsRecorded(sqlite: Database) {
  if (!tableNames(sqlite).has("__drizzle_migrations")) return false
  const row = sqlite
    .query('SELECT COUNT(*) AS n FROM "__drizzle_migrations"')
    .get() as { n: number }
  return row.n > 0
}

function lastMigrationStamp(sqlite: Database) {
  if (!migrationsRecorded(sqlite)) return -1
  const row = sqlite
    .query(
      'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
    )
    .get() as { created_at: number | string | null } | undefined
  return row?.created_at === null || row?.created_at === undefined
    ? -1
    : Number(row.created_at)
}

// Live databases contain hand-rolled copies of tables and columns that later
// drizzle snapshots also declare. Skip statements whose target already exists
// so migrations apply on fresh databases and no-op on live ones.
function statementApplicable(
  sqlite: Database,
  statement: string,
  tables: Set<string>,
  indexes: Set<string>,
): boolean {
  const table = /^CREATE TABLE (?:IF NOT EXISTS )?`?"?(\w+)`?"?/i.exec(
    statement,
  )
  if (table?.[1] && tables.has(table[1])) return false
  const index =
    /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?`?"?(\w+)`?"?/i.exec(
      statement,
    )
  if (index?.[1] && indexes.has(index[1])) return false
  const alter =
    /^ALTER TABLE `?"?(\w+)`?"?\s+ADD (?:COLUMN )?`?"?(\w+)`?"?/i.exec(
      statement,
    )
  if (alter?.[1] && tables.has(alter[1])) {
    const columns = columnNames(sqlite, alter[1])
    if (alter[2] && columns.has(alter[2])) return false
  }
  return true
}

export function applyMigrations(sqlite: Database, migrationsFolder: string) {
  ensureLegacyColumns(sqlite)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`)
  const last = lastMigrationStamp(sqlite)
  for (const entry of journalEntries(migrationsFolder)) {
    if (Number(entry.when) <= last) continue
    const query = readFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      "utf8",
    )
    const tables = tableNames(sqlite)
    const indexes = indexNames(sqlite)
    for (const statement of query.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (!trimmed) continue
      if (!statementApplicable(sqlite, trimmed, tables, indexes)) continue
      sqlite.exec(trimmed)
    }
    const hash = createHash("sha256").update(query).digest("hex")
    sqlite
      .query(
        'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
      )
      .run(hash, entry.when)
  }
  ensureLegacyColumns(sqlite)
  ensurePersonaTables(sqlite)
  ensureBuiltinPersonaScopeTable(sqlite)
  ensureThreadScreenTable(sqlite)
  ensureThreadTitleTable(sqlite)
  ensureThreadModelTable(sqlite)
  ensureThreadQueueTable(sqlite)
  ensureCronNoticeTable(sqlite)
  ensureCronJobColumns(sqlite)
  cleanupRemovedBuiltinPersonas(sqlite)
  ensureImprovementTable(sqlite)
  ensureProjectsTable(sqlite)
  ensureUserKeysTable(sqlite)
  ensureSandboxTables(sqlite)
}
