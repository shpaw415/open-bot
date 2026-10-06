import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(true),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
})

export const invites = sqliteTable("invites", {
  code: text("code").primaryKey(),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
  usedAt: integer("used_at"),
})

export const desktops = sqliteTable("desktops", {
  userId: text("user_id").primaryKey(),
  llmToken: text("llm_token").notNull(),
  opencodePassword: text("opencode_password").notNull(),
  vikingKey: text("viking_key").notNull(),
  selectedProvider: text("selected_provider"),
  selectedModel: text("selected_model"),
  lastActiveAt: integer("last_active_at").notNull(),
  vikingBaseUrl: text("viking_base_url"),
  vikingApiKey: text("viking_api_key"),
  vikingEmbedModel: text("viking_embed_model"),
  vikingEmbedDimension: integer("viking_embed_dimension"),
  vikingVlmModel: text("viking_vlm_model"),
  imageProvider: text("image_provider"),
  imageAccountId: text("image_account_id"),
  imageApiKey: text("image_api_key"),
  imageModel: text("image_model"),
})

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    kind: text("kind", { enum: ["chat", "small", "embed", "vlm"] }).notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
  },
  (table) => [index("usage_user_time").on(table.userId, table.createdAt)],
)

export const vikingProvider = sqliteTable(
  "viking_provider",
  {
    id: integer("id").primaryKey(),
    baseURL: text("base_url").notNull(),
    apiKey: text("api_key").notNull(),
    embedModel: text("embed_model").notNull(),
    embedDimension: integer("embed_dimension").notNull(),
    vlmModel: text("vlm_model").notNull(),
  },
  (table) => [check("viking_provider_id", sql`${table.id} = 1`)],
)

export const personas = sqliteTable(
  "personas",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    instruction: text("instruction").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("personas_user").on(table.userId)],
)

export const threadPersonas = sqliteTable(
  "thread_personas",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    personaId: text("persona_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sessionId] })],
)

export const cronJobs = sqliteTable(
  "cron_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    message: text("message").notNull(),
    kind: text("kind", { enum: ["cron", "every", "at"] }).notNull(),
    cronExpr: text("cron_expr"),
    everySeconds: integer("every_seconds"),
    atMs: integer("at_ms"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    deleteAfterRun: integer("delete_after_run", { mode: "boolean" })
      .notNull()
      .default(false),
    sessionId: text("session_id"),
    createdAt: integer("created_at").notNull(),
    lastRunAt: integer("last_run_at"),
    nextRunAt: integer("next_run_at"),
    runCount: integer("run_count").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [index("cron_user_due").on(table.userId, table.nextRunAt)],
)
