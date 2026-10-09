import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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
  videoProvider: text("video_provider"),
  videoAccountId: text("video_account_id"),
  videoApiKey: text("video_api_key"),
  videoModel: text("video_model"),
  model3dProvider: text("model3d_provider"),
  model3dAccountId: text("model3d_account_id"),
  model3dApiKey: text("model3d_api_key"),
  model3dModel: text("model3d_model"),
  system1Provider: text("system1_provider"),
  system1Endpoint: text("system1_endpoint"),
  system1ApiKey: text("system1_api_key"),
  system1GatewayToken: text("system1_gateway_token"),
  system1Model: text("system1_model"),
  system1AccountId: text("system1_account_id"),
  system1GatewayId: text("system1_gateway_id"),
  system1Slug: text("system1_slug"),
  sttProvider: text("stt_provider"),
  sttAccountId: text("stt_account_id"),
  sttApiKey: text("stt_api_key"),
  sttModel: text("stt_model"),
  ttsProvider: text("tts_provider"),
  ttsAccountId: text("tts_account_id"),
  ttsApiKey: text("tts_api_key"),
  ttsModel: text("tts_model"),
  ttsVoice: text("tts_voice"),
  voiceLanguage: text("voice_language"),
})

export const userKeys = sqliteTable(
  "user_keys",
  {
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(),
    apiKey: text("api_key"),
    accountId: text("account_id"),
    gatewayId: text("gateway_id"),
    gatewayToken: text("gateway_token"),
    gatewaySlug: text("gateway_slug"),
    baseUrl: text("base_url"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slug] })],
)

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

export const threadScreens = sqliteTable(
  "thread_screens",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    display: integer("display").notNull(),
    rfbPort: integer("rfb_port").notNull(),
    lastActiveAt: integer("last_active_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sessionId] })],
)

export const threadTitles = sqliteTable(
  "thread_titles",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    title: text("title").notNull(),
    author: text("author", { enum: ["ob", "user"] }).notNull(),
    createdAt: integer("created_at").notNull(),
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
    providerId: text("provider_id"),
    modelId: text("model_id"),
    personaId: text("persona_id"),
    runKind: text("run_kind", { enum: ["prompt", "script", "both"] })
      .notNull()
      .default("prompt"),
    script: text("script"),
  },
  (table) => [index("cron_user_due").on(table.userId, table.nextRunAt)],
)

export const improvements = sqliteTable(
  "improvements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    kind: text("kind", { enum: ["bug", "friction", "feature"] }).notNull(),
    surface: text("surface", {
      enum: ["chat", "desktop", "nav", "cron", "persona", "config", "other"],
    }).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    fingerprint: text("fingerprint").notNull(),
    hits: integer("hits").notNull().default(1),
    status: text("status", { enum: ["open", "done", "wontfix"] })
      .notNull()
      .default("open"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    index("improvements_fingerprint_status").on(
      table.fingerprint,
      table.status,
    ),
    index("improvements_user_time").on(table.userId, table.createdAt),
  ],
)

export const cronNotices = sqliteTable(
  "cron_notices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id").notNull(),
    jobName: text("job_name").notNull(),
    runSessionId: text("run_session_id"),
    summary: text("summary"),
    createdAt: integer("created_at").notNull(),
    viewedAt: integer("viewed_at"),
  },
  (table) => [index("cron_notices_user").on(table.userId, table.viewedAt)],
)

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("projects_user").on(table.userId),
    uniqueIndex("projects_user_name").on(table.userId, table.name),
  ],
)

export const installedPlugins = sqliteTable(
  "installed_plugins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    pluginId: text("plugin_id").notNull(),
    version: text("version").notNull(),
    manifest: text("manifest").notNull(),
    readme: text("readme"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    applied: text("applied").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("installed_plugins_user").on(table.userId),
    uniqueIndex("installed_plugins_user_plugin").on(
      table.userId,
      table.pluginId,
    ),
  ],
)

export const pluginSettings = sqliteTable(
  "plugin_settings",
  {
    userId: text("user_id").notNull(),
    pluginId: text("plugin_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.pluginId, table.key] }),
  ],
)

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
})
