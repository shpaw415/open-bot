import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./schema"

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

function ensureCronNoticeTable(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cron_notices (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_session_id TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL,
      viewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS cron_notices_user ON cron_notices (user_id, viewed_at);
  `)
  const columns = columnNames(sqlite, "cron_notices")
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

function applyMissingBaseline(sqlite: Database, migrationsFolder: string) {
  const baseline = journalEntries(migrationsFolder)[0]
  if (!baseline) return
  const query = readFileSync(
    join(migrationsFolder, `${baseline.tag}.sql`),
    "utf8",
  )
  const tables = tableNames(sqlite)
  const indexes = indexNames(sqlite)
  for (const statement of query.split("--> statement-breakpoint")) {
    const trimmed = statement.trim()
    if (!trimmed) continue
    const table = /^CREATE TABLE `([^`]+)`/i.exec(trimmed)
    if (table?.[1] && tables.has(table[1])) continue
    const index = /^CREATE (?:UNIQUE )?INDEX `([^`]+)`/i.exec(trimmed)
    if (index?.[1] && indexes.has(index[1])) continue
    sqlite.exec(trimmed)
  }
}

function stampBaseline(sqlite: Database, migrationsFolder: string) {
  const baseline = journalEntries(migrationsFolder)[0]
  if (!baseline) return
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`)
  if (migrationsRecorded(sqlite)) return
  const query = readFileSync(
    join(migrationsFolder, `${baseline.tag}.sql`),
    "utf8",
  )
  const hash = createHash("sha256").update(query).digest("hex")
  sqlite
    .query(
      'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
    )
    .run(hash, baseline.when)
}

export function applyMigrations(sqlite: Database, migrationsFolder: string) {
  ensureLegacyColumns(sqlite)
  if (!migrationsRecorded(sqlite) && tableNames(sqlite).has("users")) {
    applyMissingBaseline(sqlite, migrationsFolder)
    stampBaseline(sqlite, migrationsFolder)
  }
  migrate(drizzle(sqlite, { schema }), { migrationsFolder })
  ensureLegacyColumns(sqlite)
  ensurePersonaTables(sqlite)
  ensureThreadScreenTable(sqlite)
  ensureCronNoticeTable(sqlite)
}
