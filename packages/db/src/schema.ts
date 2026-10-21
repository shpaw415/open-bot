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
  // This user's marketplace API key (obm_…) — used to install paid plugins
  // (the purchase/license belongs to their marketplace account) and to fetch
  // their own publish identity. Falls back to the instance-wide
  // app_settings.marketplace_api_key when unset.
  marketplaceApiKey: text("marketplace_api_key"),
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
  watchdogEnabled: integer("watchdog_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  watchdogStopOnHigh: integer("watchdog_stop_on_high", { mode: "boolean" })
    .notNull()
    .default(true),
  watchdogProvider: text("watchdog_provider"),
  watchdogAccountId: text("watchdog_account_id"),
  watchdogApiKey: text("watchdog_api_key"),
  watchdogModel: text("watchdog_model"),
  watchdogBaseUrl: text("watchdog_base_url"),
  thinkingEffort: text("thinking_effort"),
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
    // Optional skill allowlists (JSON string arrays). skills null = all
    // skills; skills_extra extends a plugin-owned base list. mcp/mcp_extra
    // are the same model for MCP server names (null = all servers).
    skills: text("skills"),
    skillsExtra: text("skills_extra"),
    mcp: text("mcp"),
    mcpExtra: text("mcp_extra"),
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

export const threadDirs = sqliteTable(
  "thread_dirs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("thread_dirs_user_name").on(table.userId, table.name),
    index("thread_dirs_user").on(table.userId, table.createdAt),
  ],
)

export const threadDirAssignments = sqliteTable(
  "thread_dir_assignments",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    dirId: text("dir_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionId] }),
    index("thread_dir_assignments_dir").on(table.userId, table.dirId),
  ],
)

// Directories (labeled groups) for the skills/MCP catalog. Organization
// only — membership never changes what a persona allowlist enforces; the
// picker just expands a directory into names on save.
export const catalogDirs = sqliteTable(
  "catalog_dirs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["skill", "mcp"] }).notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("catalog_dirs_user_kind_label").on(
      table.userId,
      table.kind,
      table.label,
    ),
    index("catalog_dirs_user_kind").on(
      table.userId,
      table.kind,
      table.position,
    ),
  ],
)

// One directory per item per kind: the picker expands membership into the
// flat allowlist, so an item can only live in one labeled group.
export const catalogDirItems = sqliteTable(
  "catalog_dir_items",
  {
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["skill", "mcp"] }).notNull(),
    name: text("name").notNull(),
    dirId: text("dir_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.name] }),
    index("catalog_dir_items_dir").on(table.userId, table.dirId),
  ],
)

export const councils = sqliteTable(
  "councils",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("councils_user_name").on(table.userId, table.name),
    index("councils_user").on(table.userId, table.createdAt),
  ],
)

// Membership of a council: each row is one hidden worker: thread spawned by
// the desktop agent for the council. The session itself lives in opencode;
// this table only maps it into the group so the dashboard viewer can list it.
export const councilMembers = sqliteTable(
  "council_members",
  {
    councilId: text("council_id").notNull(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.councilId, table.sessionId] }),
    index("council_members_user_session").on(table.userId, table.sessionId),
    index("council_members_user").on(table.userId, table.createdAt),
  ],
)

// Delegation watches: one row per delegated session (a council member or a
// persona teammate) recorded at thread creation so the control plane can wake
// the coordinating thread when the work finishes. wokenAt is set once the
// coordinator has been re-prompted and cleared (re-armed) when the subject
// starts working again; pending marks a wake that fired while the coordinator
// was busy and delivers on its next idle.
export const delegationWatches = sqliteTable(
  "delegation_watches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["council", "persona"] }).notNull(),
    creatorSessionId: text("creator_session_id").notNull(),
    subjectSessionId: text("subject_session_id").notNull(),
    councilId: text("council_id"),
    createdAt: integer("created_at").notNull(),
    wokenAt: integer("woken_at"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("delegation_watches_user_subject").on(
      table.userId,
      table.subjectSessionId,
    ),
    index("delegation_watches_user_creator").on(
      table.userId,
      table.creatorSessionId,
    ),
  ],
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
    runKind: text("run_kind", { enum: ["prompt", "script", "both", "auto"] })
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
    source: text("source").notNull().default("marketplace"),
    localPath: text("local_path"),
    latestVersion: text("latest_version"),
    latestCheckedAt: integer("latest_checked_at"),
    webhookToken: text("webhook_token"),
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

// Per-user layout of the plugin dashboard home screen (page order, folders).
// Stored as one JSON blob; keys are tab keys "pluginId:tabId" and stale keys
// are simply ignored until the plugin comes back.
export const dashboardLayouts = sqliteTable("dashboard_layouts", {
  userId: text("user_id").primaryKey(),
  layout: text("layout").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const workspaceMedia = sqliteTable(
  "workspace_media",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_media_message_path").on(table.messageId, table.path),
    index("workspace_media_session").on(table.userId, table.sessionId),
    index("workspace_media_created").on(table.createdAt),
  ],
)

export const watchdogFindings = sqliteTable(
  "watchdog_findings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    source: text("source", {
      enum: ["prompt", "response", "tool_input", "tool_output"],
    }).notNull(),
    category: text("category", {
      enum: [
        "prompt_injection",
        "secret_exfiltration",
        "dangerous_command",
        "credential_access",
        "malicious_content",
        "other",
      ],
    }).notNull(),
    severity: text("severity", {
      enum: ["info", "low", "medium", "high"],
    }).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    fingerprint: text("fingerprint").notNull(),
    hits: integer("hits").notNull().default(1),
    status: text("status", { enum: ["new", "reviewed", "dismissed"] })
      .notNull()
      .default("new"),
    verdict: text("verdict"),
    action: text("action", { enum: ["none", "alerted", "stopped"] })
      .notNull()
      .default("alerted"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    index("watchdog_findings_user_time").on(table.userId, table.createdAt),
    index("watchdog_findings_fingerprint").on(table.userId, table.fingerprint),
  ],
)

export const mediaAlbums = sqliteTable(
  "media_albums",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    sessionId: text("session_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("media_albums_user_name").on(table.userId, table.name),
    uniqueIndex("media_albums_user_session").on(table.userId, table.sessionId),
    index("media_albums_user").on(table.userId, table.createdAt),
  ],
)

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    albumId: text("album_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    sourcePath: text("source_path").notNull(),
    sessionId: text("session_id"),
    messageId: text("message_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("media_items_album_sha").on(table.albumId, table.sha256),
    uniqueIndex("media_items_message_path").on(
      table.messageId,
      table.sourcePath,
    ),
    index("media_items_album").on(table.albumId, table.createdAt),
    index("media_items_user").on(table.userId),
    index("media_items_created").on(table.createdAt),
  ],
)

export const teamKeys = sqliteTable("team_keys", {
  slug: text("slug").primaryKey(),
  apiKey: text("api_key"),
  accountId: text("account_id"),
  gatewayId: text("gateway_id"),
  gatewayToken: text("gateway_token"),
  gatewaySlug: text("gateway_slug"),
  baseUrl: text("base_url"),
  updatedAt: integer("updated_at").notNull(),
})

export const userQuotas = sqliteTable("user_quotas", {
  userId: text("user_id").primaryKey(),
  weeklyTokens: integer("weekly_tokens"),
  updatedAt: integer("updated_at").notNull(),
})
