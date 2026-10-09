import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
  sum,
} from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { applyMigrations } from "./migrate"
import {
  appSettings,
  cronJobs,
  cronNotices,
  desktops,
  improvements,
  installedPlugins,
  invites,
  personas,
  pluginSettings,
  projects,
  sessions,
  threadPersonas,
  threadScreens,
  threadTitles,
  usageEvents,
  userKeys,
  users,
  vikingProvider,
} from "./schema"

export type Role = "admin" | "user"

export type User = {
  id: string
  email: string
  passwordHash: string
  role: Role
  createdAt: number
  mustChangePassword: boolean
  disabled: boolean
}

export type UsageKind = "chat" | "small" | "embed" | "vlm"

export type UsageEvent = {
  userId: string
  createdAt: number
  kind: UsageKind
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type UsageGroup = {
  userId: string
  kind: string
  day: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
}

export type PublicUserRow = {
  id: string
  email: string
  role: Role
  createdAt: number
  mustChangePassword: boolean
  disabled: boolean
  lastActiveAt: number | null
}

export type InviteRow = {
  code: string
  email: string | null
  createdAt: number
  usedAt: number | null
}

export type Session = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: number
}

export type ImageProvider = {
  provider: string
  accountId: string
  apiKey: string
  model: string
}

export type VideoProvider = {
  provider: string
  accountId: string
  apiKey: string
  model: string
}

export type Model3dProvider = {
  provider: string
  accountId: string
  apiKey: string
  model: string
}

export type System1Provider = {
  provider: string
  endpoint: string
  apiKey: string
  gatewayToken: string
  model: string
  accountId: string
  gatewayId: string
  slug: string
}

export type VoiceConfig = {
  sttProvider: string
  sttAccountId: string
  sttApiKey: string
  sttModel: string
  ttsProvider: string
  ttsAccountId: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  language: string
}

export type VikingProvider = {
  baseURL: string
  apiKey: string
  embedModel: string
  embedDimension: number
  vlmModel: string
}

export type UserKey = {
  userId: string
  slug: string
  apiKey: string
  accountId: string
  gatewayId: string
  gatewayToken: string
  gatewaySlug: string
  baseUrl: string
  updatedAt: number
}

export function vikingProviderReady(
  value: VikingProvider | null,
): value is VikingProvider {
  if (!value) return false
  try {
    const url = new URL(value.baseURL)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
  } catch {
    return false
  }
  return (
    value.apiKey.trim() !== "" &&
    value.embedModel.trim() !== "" &&
    value.vlmModel.trim() !== "" &&
    Number.isInteger(value.embedDimension) &&
    value.embedDimension > 0
  )
}

export type Desktop = {
  userId: string
  llmToken: string
  opencodePassword: string
  vikingKey: string
  selectedProvider: string | null
  selectedModel: string | null
  lastActiveAt: number
}

export type ImprovementKind = "bug" | "friction" | "feature"
export type ImprovementStatus = "open" | "done" | "wontfix"
export type ImprovementSurface =
  | "chat"
  | "desktop"
  | "nav"
  | "cron"
  | "persona"
  | "config"
  | "other"

export type Improvement = {
  id: string
  userId: string
  sessionId: string | null
  kind: ImprovementKind
  surface: ImprovementSurface
  title: string
  detail: string
  fingerprint: string
  hits: number
  status: ImprovementStatus
  note: string | null
  createdAt: number
  lastSeenAt: number
  resolvedAt: number | null
}

export type ImprovementRow = Improvement & { email: string | null }

export type Persona = {
  id: string
  userId: string
  name: string
  instruction: string
  createdAt: number
}

export type ThreadPersona = {
  userId: string
  sessionId: string
  personaId: string
}

export type ThreadScreen = {
  userId: string
  sessionId: string
  display: number
  rfbPort: number
  lastActiveAt: number
}

export type ThreadTitleAuthor = "ob" | "user"

export type ThreadTitle = {
  userId: string
  sessionId: string
  title: string
  author: ThreadTitleAuthor
  createdAt: number
}

export type CronScheduleKind = "cron" | "every" | "at"
export type CronRunKind = "prompt" | "script" | "both"

export type CronJob = {
  id: string
  userId: string
  name: string
  message: string
  kind: CronScheduleKind
  cronExpr: string | null
  everySeconds: number | null
  atMs: number | null
  enabled: boolean
  deleteAfterRun: boolean
  sessionId: string | null
  createdAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  lastError: string | null
  providerId: string | null
  modelId: string | null
  personaId: string | null
  runKind: CronRunKind
  script: string | null
}

export type CronNotice = {
  id: string
  userId: string
  jobId: string
  jobName: string
  runSessionId: string | null
  summary: string | null
  createdAt: number
  viewedAt: number | null
}

export type Project = {
  id: string
  userId: string
  name: string
  path: string
  createdAt: number
}

export type PluginAppliedLog = {
  personaIds: string[]
  cronJobIds: string[]
  skills: string[]
  keys: string[]
  tools: string[]
  opencode: boolean
  agentsMd?: boolean
  init?: { ranAt: number; ok: boolean; output: string }
}

export type InstalledPlugin = {
  id: string
  userId: string
  pluginId: string
  version: string
  manifest: Record<string, unknown>
  readme: string | null
  enabled: boolean
  applied: PluginAppliedLog
  createdAt: number
  updatedAt: number
}

export type PluginSetting = {
  key: string
  value: string
  updatedAt: number
}

export function emptyAppliedLog(): PluginAppliedLog {
  return {
    personaIds: [],
    cronJobIds: [],
    skills: [],
    keys: [],
    tools: [],
    opencode: false,
  }
}

function mapInstalledPlugin(
  row: typeof installedPlugins.$inferSelect | undefined,
): InstalledPlugin | null {
  if (!row) return null
  let manifest: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.manifest)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      manifest = parsed as Record<string, unknown>
    }
  } catch {
    manifest = {}
  }
  let applied = emptyAppliedLog()
  try {
    const parsed = JSON.parse(row.applied)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      applied = { ...emptyAppliedLog(), ...(parsed as PluginAppliedLog) }
    }
  } catch {
    applied = emptyAppliedLog()
  }
  return {
    id: row.id,
    userId: row.userId,
    pluginId: row.pluginId,
    version: row.version,
    manifest,
    readme: row.readme,
    enabled: row.enabled,
    applied,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
)

const desktopColumns = {
  userId: desktops.userId,
  llmToken: desktops.llmToken,
  opencodePassword: desktops.opencodePassword,
  vikingKey: desktops.vikingKey,
  selectedProvider: desktops.selectedProvider,
  selectedModel: desktops.selectedModel,
  lastActiveAt: desktops.lastActiveAt,
}

function mapUser(row: typeof users.$inferSelect | undefined): User | null {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.createdAt,
    mustChangePassword: row.mustChangePassword,
    disabled: row.disabled,
  }
}

function mapCronJob(
  row: typeof cronJobs.$inferSelect | undefined,
): CronJob | null {
  if (!row) return null
  const kind =
    row.kind === "cron" || row.kind === "every" || row.kind === "at"
      ? row.kind
      : "every"
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    message: row.message,
    kind,
    cronExpr: row.cronExpr,
    everySeconds: row.everySeconds,
    atMs: row.atMs,
    enabled: row.enabled,
    deleteAfterRun: row.deleteAfterRun,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    runCount: row.runCount,
    lastError: row.lastError,
    providerId: row.providerId,
    modelId: row.modelId,
    personaId: row.personaId,
    runKind:
      row.runKind === "script" || row.runKind === "both"
        ? row.runKind
        : "prompt",
    script: row.script,
  }
}

function mapCronNotice(row: typeof cronNotices.$inferSelect): CronNotice {
  return {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    jobName: row.jobName,
    runSessionId: row.runSessionId,
    summary: row.summary,
    createdAt: row.createdAt,
    viewedAt: row.viewedAt,
  }
}

export type UserKeyFields = {
  apiKey: string
  accountId: string
  gatewayId: string
  gatewayToken: string
  gatewaySlug: string
  baseUrl: string
}

function rowFromUserKeys(row: typeof userKeys.$inferSelect): UserKey {
  return {
    userId: row.userId,
    slug: row.slug,
    apiKey: row.apiKey ?? "",
    accountId: row.accountId ?? "",
    gatewayId: row.gatewayId ?? "",
    gatewayToken: row.gatewayToken ?? "",
    gatewaySlug: row.gatewaySlug ?? "",
    baseUrl: row.baseUrl ?? "",
    updatedAt: row.updatedAt,
  }
}

export function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.exec("PRAGMA journal_mode = WAL")
  // Concurrent control-plane processes (thread screens, cron, the server)
  // write at once; without a busy timeout they die instantly on SQLITE_BUSY.
  sqlite.exec("PRAGMA busy_timeout = 10000")
  applyMigrations(sqlite, migrationsFolder)
  const orm = drizzle(sqlite, {
    schema: {
      users,
      sessions,
      invites,
      desktops,
      usageEvents,
      vikingProvider,
      cronJobs,
      cronNotices,
      personas,
      threadPersonas,
      threadScreens,
      improvements,
      projects,
      installedPlugins,
      pluginSettings,
      appSettings,
    },
  })

  return {
    createUser(user: User) {
      orm.insert(users).values(user).run()
    },
    userByEmail(email: string) {
      return mapUser(
        orm.select().from(users).where(eq(users.email, email)).get(),
      )
    },
    userById(id: string) {
      return mapUser(orm.select().from(users).where(eq(users.id, id)).get())
    },
    setCredentials(userId: string, email: string, passwordHash: string) {
      orm
        .update(users)
        .set({ email, passwordHash, mustChangePassword: false })
        .where(eq(users.id, userId))
        .run()
    },
    userCount() {
      const row = orm.select({ n: count() }).from(users).get()
      return Number(row?.n ?? 0)
    },
    createSession(session: Session) {
      orm.insert(sessions).values(session).run()
    },
    sessionByHash(tokenHash: string) {
      return (
        orm
          .select()
          .from(sessions)
          .where(eq(sessions.tokenHash, tokenHash))
          .get() ?? null
      )
    },
    deleteSession(id: string) {
      orm.delete(sessions).where(eq(sessions.id, id)).run()
    },
    createInvite(code: string, email: string | null) {
      orm.insert(invites).values({ code, email, createdAt: Date.now() }).run()
    },
    takeInvite(code: string) {
      const row =
        orm
          .select({
            code: invites.code,
            email: invites.email,
            usedAt: invites.usedAt,
          })
          .from(invites)
          .where(eq(invites.code, code))
          .get() ?? null
      if (!row || row.usedAt) return null
      orm
        .update(invites)
        .set({ usedAt: Date.now() })
        .where(eq(invites.code, code))
        .run()
      return row
    },
    ensureDesktop(desktop: Desktop) {
      orm.insert(desktops).values(desktop).onConflictDoNothing().run()
    },
    desktop(userId: string) {
      return (
        orm
          .select(desktopColumns)
          .from(desktops)
          .where(eq(desktops.userId, userId))
          .get() ?? null
      )
    },
    getVikingProvider(userId?: string): VikingProvider | null {
      if (userId) {
        const own = orm
          .select({
            baseURL: desktops.vikingBaseUrl,
            apiKey: desktops.vikingApiKey,
            embedModel: desktops.vikingEmbedModel,
            embedDimension: desktops.vikingEmbedDimension,
            vlmModel: desktops.vikingVlmModel,
          })
          .from(desktops)
          .where(eq(desktops.userId, userId))
          .get()
        if (own?.baseURL) {
          return {
            baseURL: own.baseURL,
            apiKey: own.apiKey ?? "",
            embedModel: own.embedModel ?? "",
            embedDimension: own.embedDimension ?? 1536,
            vlmModel: own.vlmModel ?? "",
          }
        }
      }
      const row = orm
        .select()
        .from(vikingProvider)
        .where(eq(vikingProvider.id, 1))
        .get()
      if (!row) return null
      return {
        baseURL: row.baseURL,
        apiKey: row.apiKey,
        embedModel: row.embedModel,
        embedDimension: row.embedDimension,
        vlmModel: row.vlmModel,
      }
    },
    setVikingProvider(value: VikingProvider) {
      orm
        .insert(vikingProvider)
        .values({ id: 1, ...value })
        .onConflictDoUpdate({
          target: vikingProvider.id,
          set: value,
        })
        .run()
    },
    setUserVikingProvider(userId: string, value: VikingProvider) {
      orm
        .update(desktops)
        .set({
          vikingBaseUrl: value.baseURL,
          vikingApiKey: value.apiKey,
          vikingEmbedModel: value.embedModel,
          vikingEmbedDimension: value.embedDimension,
          vikingVlmModel: value.vlmModel,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    getRawImageProvider(userId: string): ImageProvider | null {
      const row = orm
        .select({
          provider: desktops.imageProvider,
          accountId: desktops.imageAccountId,
          apiKey: desktops.imageApiKey,
          model: desktops.imageModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey ?? "",
        model: row.model ?? "",
      }
    },
    getImageProvider(userId: string): ImageProvider | null {
      const row = orm
        .select({
          provider: desktops.imageProvider,
          accountId: desktops.imageAccountId,
          apiKey: desktops.imageApiKey,
          model: desktops.imageModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider || !row.apiKey || !row.model) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey,
        model: row.model,
      }
    },
    setImageProvider(userId: string, value: ImageProvider) {
      orm
        .update(desktops)
        .set({
          imageProvider: value.provider,
          imageAccountId: value.accountId,
          imageApiKey: value.apiKey,
          imageModel: value.model,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    clearImageProvider(userId: string) {
      orm
        .update(desktops)
        .set({
          imageProvider: null,
          imageAccountId: null,
          imageApiKey: null,
          imageModel: null,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    getRawVideoProvider(userId: string): VideoProvider | null {
      const row = orm
        .select({
          provider: desktops.videoProvider,
          accountId: desktops.videoAccountId,
          apiKey: desktops.videoApiKey,
          model: desktops.videoModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey ?? "",
        model: row.model ?? "",
      }
    },
    getVideoProvider(userId: string): VideoProvider | null {
      const row = orm
        .select({
          provider: desktops.videoProvider,
          accountId: desktops.videoAccountId,
          apiKey: desktops.videoApiKey,
          model: desktops.videoModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider || !row.apiKey || !row.model) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey,
        model: row.model,
      }
    },
    setVideoProvider(userId: string, value: VideoProvider) {
      orm
        .update(desktops)
        .set({
          videoProvider: value.provider,
          videoAccountId: value.accountId,
          videoApiKey: value.apiKey,
          videoModel: value.model,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    clearVideoProvider(userId: string) {
      orm
        .update(desktops)
        .set({
          videoProvider: null,
          videoAccountId: null,
          videoApiKey: null,
          videoModel: null,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    getRawModel3dProvider(userId: string): Model3dProvider | null {
      const row = orm
        .select({
          provider: desktops.model3dProvider,
          accountId: desktops.model3dAccountId,
          apiKey: desktops.model3dApiKey,
          model: desktops.model3dModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey ?? "",
        model: row.model ?? "",
      }
    },
    getModel3dProvider(userId: string): Model3dProvider | null {
      const row = orm
        .select({
          provider: desktops.model3dProvider,
          accountId: desktops.model3dAccountId,
          apiKey: desktops.model3dApiKey,
          model: desktops.model3dModel,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider || !row.apiKey || !row.model) return null
      return {
        provider: row.provider,
        accountId: row.accountId ?? "",
        apiKey: row.apiKey,
        model: row.model,
      }
    },
    setModel3dProvider(userId: string, value: Model3dProvider) {
      orm
        .update(desktops)
        .set({
          model3dProvider: value.provider,
          model3dAccountId: value.accountId,
          model3dApiKey: value.apiKey,
          model3dModel: value.model,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    clearModel3dProvider(userId: string) {
      orm
        .update(desktops)
        .set({
          model3dProvider: null,
          model3dAccountId: null,
          model3dApiKey: null,
          model3dModel: null,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    getSystem1(userId: string): System1Provider | null {
      const row = orm
        .select({
          provider: desktops.system1Provider,
          endpoint: desktops.system1Endpoint,
          apiKey: desktops.system1ApiKey,
          gatewayToken: desktops.system1GatewayToken,
          model: desktops.system1Model,
          accountId: desktops.system1AccountId,
          gatewayId: desktops.system1GatewayId,
          slug: desktops.system1Slug,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      if (!row?.provider || !row.endpoint) return null
      return {
        provider: row.provider,
        endpoint: row.endpoint,
        apiKey: row.apiKey ?? "",
        gatewayToken: row.gatewayToken ?? "",
        model: row.model ?? "",
        accountId: row.accountId ?? "",
        gatewayId: row.gatewayId ?? "",
        slug: row.slug ?? "",
      }
    },
    setSystem1(userId: string, value: System1Provider) {
      orm
        .update(desktops)
        .set({
          system1Provider: value.provider,
          system1Endpoint: value.endpoint,
          system1ApiKey: value.apiKey,
          system1GatewayToken: value.gatewayToken,
          system1Model: value.model,
          system1AccountId: value.accountId,
          system1GatewayId: value.gatewayId,
          system1Slug: value.slug,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    clearSystem1(userId: string) {
      orm
        .update(desktops)
        .set({
          system1Provider: null,
          system1Endpoint: null,
          system1ApiKey: null,
          system1GatewayToken: null,
          system1Model: null,
          system1AccountId: null,
          system1GatewayId: null,
          system1Slug: null,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    getVoiceConfig(userId: string): VoiceConfig {
      const row = orm
        .select({
          sttProvider: desktops.sttProvider,
          sttAccountId: desktops.sttAccountId,
          sttApiKey: desktops.sttApiKey,
          sttModel: desktops.sttModel,
          ttsProvider: desktops.ttsProvider,
          ttsAccountId: desktops.ttsAccountId,
          ttsApiKey: desktops.ttsApiKey,
          ttsModel: desktops.ttsModel,
          ttsVoice: desktops.ttsVoice,
          language: desktops.voiceLanguage,
        })
        .from(desktops)
        .where(eq(desktops.userId, userId))
        .get()
      return {
        sttProvider: row?.sttProvider ?? "",
        sttAccountId: row?.sttAccountId ?? "",
        sttApiKey: row?.sttApiKey ?? "",
        sttModel: row?.sttModel ?? "",
        ttsProvider: row?.ttsProvider ?? "",
        ttsAccountId: row?.ttsAccountId ?? "",
        ttsApiKey: row?.ttsApiKey ?? "",
        ttsModel: row?.ttsModel ?? "",
        ttsVoice: row?.ttsVoice ?? "",
        language: row?.language ?? "",
      }
    },
    setVoiceConfig(userId: string, value: VoiceConfig) {
      orm
        .update(desktops)
        .set({
          sttProvider: value.sttProvider,
          sttAccountId: value.sttAccountId,
          sttApiKey: value.sttApiKey,
          sttModel: value.sttModel,
          ttsProvider: value.ttsProvider,
          ttsAccountId: value.ttsAccountId,
          ttsApiKey: value.ttsApiKey,
          ttsModel: value.ttsModel,
          ttsVoice: value.ttsVoice,
          voiceLanguage: value.language,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    clearVoiceConfig(userId: string) {
      orm
        .update(desktops)
        .set({
          sttProvider: null,
          sttAccountId: null,
          sttApiKey: null,
          sttModel: null,
          ttsProvider: null,
          ttsAccountId: null,
          ttsApiKey: null,
          ttsModel: null,
          ttsVoice: null,
          voiceLanguage: null,
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    desktopUserIds() {
      return orm
        .select({ userId: desktops.userId })
        .from(desktops)
        .all()
        .map((row) => row.userId)
    },
    getUserKeys(userId: string): UserKey[] {
      return orm
        .select()
        .from(userKeys)
        .where(eq(userKeys.userId, userId))
        .all()
        .map(rowFromUserKeys)
    },
    getUserKey(userId: string, slug: string): UserKey | null {
      const row = orm
        .select()
        .from(userKeys)
        .where(and(eq(userKeys.userId, userId), eq(userKeys.slug, slug)))
        .get()
      return row ? rowFromUserKeys(row) : null
    },
    setUserKey(userId: string, slug: string, value: UserKeyFields) {
      const updatedAt = Date.now()
      orm
        .insert(userKeys)
        .values({ userId, slug, ...value, updatedAt })
        .onConflictDoUpdate({
          target: [userKeys.userId, userKeys.slug],
          set: { ...value, updatedAt },
        })
        .run()
    },
    clearUserKey(userId: string, slug: string) {
      orm
        .delete(userKeys)
        .where(and(eq(userKeys.userId, userId), eq(userKeys.slug, slug)))
        .run()
    },
    clearUserKeys(userId: string) {
      orm.delete(userKeys).where(eq(userKeys.userId, userId)).run()
    },
    touchDesktop(userId: string) {
      orm
        .update(desktops)
        .set({ lastActiveAt: Date.now() })
        .where(eq(desktops.userId, userId))
        .run()
    },
    setModel(userId: string, provider: string, model: string) {
      orm
        .update(desktops)
        .set({
          selectedProvider: provider,
          selectedModel: model,
          lastActiveAt: Date.now(),
        })
        .where(eq(desktops.userId, userId))
        .run()
    },
    idleDesktops(before: number) {
      return orm
        .select({ userId: desktops.userId })
        .from(desktops)
        .where(lt(desktops.lastActiveAt, before))
        .all()
    },
    activeDesktops(since: number) {
      return orm
        .select({ userId: desktops.userId })
        .from(desktops)
        .where(gte(desktops.lastActiveAt, since))
        .all()
    },
    createPersona(persona: Persona) {
      orm.insert(personas).values(persona).run()
    },
    personas(userId: string) {
      return orm
        .select()
        .from(personas)
        .where(eq(personas.userId, userId))
        .orderBy(personas.createdAt)
        .all()
    },
    personaById(id: string, userId: string) {
      return (
        orm
          .select()
          .from(personas)
          .where(and(eq(personas.id, id), eq(personas.userId, userId)))
          .get() ?? null
      )
    },
    updatePersona(
      id: string,
      userId: string,
      changes: { name: string; instruction: string },
    ) {
      if (!this.personaById(id, userId)) return null
      orm
        .update(personas)
        .set(changes)
        .where(and(eq(personas.id, id), eq(personas.userId, userId)))
        .run()
      return this.personaById(id, userId)
    },
    deletePersona(id: string, userId: string) {
      if (!this.personaById(id, userId)) return false
      orm
        .delete(threadPersonas)
        .where(
          and(
            eq(threadPersonas.userId, userId),
            eq(threadPersonas.personaId, id),
          ),
        )
        .run()
      orm
        .delete(personas)
        .where(and(eq(personas.id, id), eq(personas.userId, userId)))
        .run()
      return true
    },
    setThreadPersona(userId: string, sessionId: string, personaId: string) {
      orm
        .insert(threadPersonas)
        .values({ userId, sessionId, personaId })
        .onConflictDoUpdate({
          target: [threadPersonas.userId, threadPersonas.sessionId],
          set: { personaId },
        })
        .run()
    },
    threadPersona(userId: string, sessionId: string) {
      return (
        orm
          .select()
          .from(threadPersonas)
          .where(
            and(
              eq(threadPersonas.userId, userId),
              eq(threadPersonas.sessionId, sessionId),
            ),
          )
          .get() ?? null
      )
    },
    threadPersonas(userId: string) {
      return orm
        .select()
        .from(threadPersonas)
        .where(eq(threadPersonas.userId, userId))
        .all()
    },
    clearThreadPersona(userId: string, sessionId: string) {
      orm
        .delete(threadPersonas)
        .where(
          and(
            eq(threadPersonas.userId, userId),
            eq(threadPersonas.sessionId, sessionId),
          ),
        )
        .run()
    },
    upsertThreadScreen(row: ThreadScreen) {
      orm
        .insert(threadScreens)
        .values(row)
        .onConflictDoUpdate({
          target: [threadScreens.userId, threadScreens.sessionId],
          set: {
            display: row.display,
            rfbPort: row.rfbPort,
            lastActiveAt: row.lastActiveAt,
          },
        })
        .run()
    },
    threadScreen(userId: string, sessionId: string) {
      return (
        orm
          .select()
          .from(threadScreens)
          .where(
            and(
              eq(threadScreens.userId, userId),
              eq(threadScreens.sessionId, sessionId),
            ),
          )
          .get() ?? null
      )
    },
    threadScreens(userId: string) {
      return orm
        .select()
        .from(threadScreens)
        .where(eq(threadScreens.userId, userId))
        .all()
    },
    clearThreadScreen(userId: string, sessionId: string) {
      orm
        .delete(threadScreens)
        .where(
          and(
            eq(threadScreens.userId, userId),
            eq(threadScreens.sessionId, sessionId),
          ),
        )
        .run()
    },
    setThreadTitle(row: ThreadTitle) {
      orm
        .insert(threadTitles)
        .values(row)
        .onConflictDoUpdate({
          target: [threadTitles.userId, threadTitles.sessionId],
          set: {
            title: row.title,
            author: row.author,
            createdAt: row.createdAt,
          },
        })
        .run()
    },
    threadTitle(userId: string, sessionId: string) {
      return (
        orm
          .select()
          .from(threadTitles)
          .where(
            and(
              eq(threadTitles.userId, userId),
              eq(threadTitles.sessionId, sessionId),
            ),
          )
          .get() ?? null
      )
    },
    clearThreadTitle(userId: string, sessionId: string) {
      orm
        .delete(threadTitles)
        .where(
          and(
            eq(threadTitles.userId, userId),
            eq(threadTitles.sessionId, sessionId),
          ),
        )
        .run()
    },
    createCronJob(job: CronJob) {
      orm.insert(cronJobs).values(job).run()
    },
    cronJobs(userId: string) {
      return orm
        .select()
        .from(cronJobs)
        .where(eq(cronJobs.userId, userId))
        .orderBy(cronJobs.createdAt)
        .all()
        .map(mapCronJob)
        .filter((job): job is CronJob => job !== null)
    },
    cronJobById(id: string, userId: string) {
      return mapCronJob(
        orm
          .select()
          .from(cronJobs)
          .where(and(eq(cronJobs.id, id), eq(cronJobs.userId, userId)))
          .get(),
      )
    },
    dueCronJobs(now: number) {
      return orm
        .select()
        .from(cronJobs)
        .where(
          and(
            eq(cronJobs.enabled, true),
            isNotNull(cronJobs.nextRunAt),
            lte(cronJobs.nextRunAt, now),
          ),
        )
        .orderBy(cronJobs.nextRunAt)
        .all()
        .map(mapCronJob)
        .filter((job): job is CronJob => job !== null)
    },
    userIdByLlmToken(token: string) {
      const row = orm
        .select({ userId: desktops.userId })
        .from(desktops)
        .where(eq(desktops.llmToken, token))
        .get()
      return row?.userId ?? null
    },
    setCronNextRun(id: string, nextRunAt: number | null) {
      orm.update(cronJobs).set({ nextRunAt }).where(eq(cronJobs.id, id)).run()
    },
    recordCronRun(id: string, error: string | null) {
      orm
        .update(cronJobs)
        .set({
          lastRunAt: Date.now(),
          runCount: sql`${cronJobs.runCount} + 1`,
          lastError: error,
        })
        .where(eq(cronJobs.id, id))
        .run()
    },
    setCronSession(id: string, sessionId: string) {
      orm.update(cronJobs).set({ sessionId }).where(eq(cronJobs.id, id)).run()
    },
    updateCronJob(
      id: string,
      userId: string,
      changes: {
        name?: string
        message?: string
        enabled?: boolean
        nextRunAt?: number | null
        providerId?: string | null
        modelId?: string | null
        personaId?: string | null
        runKind?: CronRunKind
        script?: string | null
      },
    ) {
      const job = this.cronJobById(id, userId)
      if (!job) return null
      orm
        .update(cronJobs)
        .set({
          name: changes.name ?? job.name,
          message: changes.message ?? job.message,
          enabled: changes.enabled ?? job.enabled,
          nextRunAt:
            changes.nextRunAt !== undefined ? changes.nextRunAt : job.nextRunAt,
          providerId:
            changes.providerId !== undefined
              ? changes.providerId
              : job.providerId,
          modelId:
            changes.modelId !== undefined ? changes.modelId : job.modelId,
          personaId:
            changes.personaId !== undefined ? changes.personaId : job.personaId,
          runKind: changes.runKind ?? job.runKind,
          script: changes.script !== undefined ? changes.script : job.script,
        })
        .where(eq(cronJobs.id, id))
        .run()
      return this.cronJobById(id, userId)
    },
    deleteCronJob(id: string, userId: string) {
      if (!this.cronJobById(id, userId)) return false
      orm
        .delete(cronJobs)
        .where(and(eq(cronJobs.id, id), eq(cronJobs.userId, userId)))
        .run()
      orm
        .delete(cronNotices)
        .where(and(eq(cronNotices.jobId, id), eq(cronNotices.userId, userId)))
        .run()
      return true
    },
    createCronNotice(notice: CronNotice) {
      orm.insert(cronNotices).values(notice).run()
    },
    createProject(project: Project) {
      orm.insert(projects).values(project).run()
    },
    projects(userId: string) {
      return orm
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(projects.createdAt)
        .all()
    },
    projectByName(userId: string, name: string) {
      return (
        orm
          .select()
          .from(projects)
          .where(and(eq(projects.userId, userId), eq(projects.name, name)))
          .get() ?? null
      )
    },
    projectById(id: string, userId: string) {
      return (
        orm
          .select()
          .from(projects)
          .where(and(eq(projects.id, id), eq(projects.userId, userId)))
          .get() ?? null
      )
    },
    deleteProject(id: string, userId: string) {
      if (!this.projectById(id, userId)) return false
      orm
        .delete(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .run()
      return true
    },
    pendingCronNotices() {
      return orm
        .select()
        .from(cronNotices)
        .where(isNull(cronNotices.summary))
        .all()
        .map(mapCronNotice)
    },
    cronNoticeById(id: string) {
      const row = orm
        .select()
        .from(cronNotices)
        .where(eq(cronNotices.id, id))
        .get()
      return row ? mapCronNotice(row) : null
    },
    unreadCronNotices(userId: string) {
      return orm
        .select()
        .from(cronNotices)
        .where(
          and(
            eq(cronNotices.userId, userId),
            isNotNull(cronNotices.summary),
            isNull(cronNotices.viewedAt),
          ),
        )
        .orderBy(desc(cronNotices.createdAt))
        .all()
        .map(mapCronNotice)
    },
    recentCronNotices(userId: string, limit: number) {
      return orm
        .select()
        .from(cronNotices)
        .where(eq(cronNotices.userId, userId))
        .orderBy(desc(cronNotices.createdAt))
        .limit(limit)
        .all()
        .map(mapCronNotice)
    },
    settleCronNotice(id: string, summary: string) {
      const notice = this.cronNoticeById(id)
      if (!notice || notice.summary) return false
      const duplicate = orm
        .select()
        .from(cronNotices)
        .where(
          and(
            eq(cronNotices.userId, notice.userId),
            eq(cronNotices.jobId, notice.jobId),
            eq(cronNotices.summary, summary),
            isNull(cronNotices.viewedAt),
          ),
        )
        .get()
      if (duplicate) {
        orm.delete(cronNotices).where(eq(cronNotices.id, id)).run()
        return true
      }
      orm
        .update(cronNotices)
        .set({ summary })
        .where(eq(cronNotices.id, id))
        .run()
      return true
    },
    viewCronNotice(id: string, userId: string) {
      orm
        .update(cronNotices)
        .set({ viewedAt: Date.now() })
        .where(
          and(
            eq(cronNotices.id, id),
            eq(cronNotices.userId, userId),
            isNotNull(cronNotices.summary),
            isNull(cronNotices.viewedAt),
          ),
        )
        .run()
    },
    createInstalledPlugin(
      row: Omit<InstalledPlugin, "manifest" | "applied"> & {
        manifest: string
        applied?: string
      },
    ) {
      orm.insert(installedPlugins).values(row).run()
    },
    installedPlugins(userId: string) {
      return orm
        .select()
        .from(installedPlugins)
        .where(eq(installedPlugins.userId, userId))
        .orderBy(installedPlugins.createdAt)
        .all()
        .map(mapInstalledPlugin)
        .filter((row): row is InstalledPlugin => row !== null)
    },
    installedPlugin(userId: string, pluginId: string) {
      return mapInstalledPlugin(
        orm
          .select()
          .from(installedPlugins)
          .where(
            and(
              eq(installedPlugins.userId, userId),
              eq(installedPlugins.pluginId, pluginId),
            ),
          )
          .get(),
      )
    },
    setInstalledPluginEnabled(
      userId: string,
      pluginId: string,
      enabled: boolean,
    ) {
      if (!this.installedPlugin(userId, pluginId)) return null
      orm
        .update(installedPlugins)
        .set({ enabled, updatedAt: Date.now() })
        .where(
          and(
            eq(installedPlugins.userId, userId),
            eq(installedPlugins.pluginId, pluginId),
          ),
        )
        .run()
      return this.installedPlugin(userId, pluginId)
    },
    updateInstalledPlugin(
      userId: string,
      pluginId: string,
      changes: { version: string; manifest: string; readme: string | null },
    ) {
      if (!this.installedPlugin(userId, pluginId)) return null
      orm
        .update(installedPlugins)
        .set({ ...changes, updatedAt: Date.now() })
        .where(
          and(
            eq(installedPlugins.userId, userId),
            eq(installedPlugins.pluginId, pluginId),
          ),
        )
        .run()
      return this.installedPlugin(userId, pluginId)
    },
    setInstalledPluginApplied(
      userId: string,
      pluginId: string,
      applied: PluginAppliedLog,
    ) {
      orm
        .update(installedPlugins)
        .set({ applied: JSON.stringify(applied), updatedAt: Date.now() })
        .where(
          and(
            eq(installedPlugins.userId, userId),
            eq(installedPlugins.pluginId, pluginId),
          ),
        )
        .run()
    },
    deleteInstalledPlugin(userId: string, pluginId: string) {
      if (!this.installedPlugin(userId, pluginId)) return false
      orm
        .delete(installedPlugins)
        .where(
          and(
            eq(installedPlugins.userId, userId),
            eq(installedPlugins.pluginId, pluginId),
          ),
        )
        .run()
      orm
        .delete(pluginSettings)
        .where(
          and(
            eq(pluginSettings.userId, userId),
            eq(pluginSettings.pluginId, pluginId),
          ),
        )
        .run()
      return true
    },
    pluginSettings(userId: string, pluginId: string): PluginSetting[] {
      return orm
        .select()
        .from(pluginSettings)
        .where(
          and(
            eq(pluginSettings.userId, userId),
            eq(pluginSettings.pluginId, pluginId),
          ),
        )
        .all()
        .map((row) => ({
          key: row.key,
          value: row.value,
          updatedAt: row.updatedAt,
        }))
    },
    setPluginSetting(
      userId: string,
      pluginId: string,
      key: string,
      value: string,
    ) {
      const updatedAt = Date.now()
      orm
        .insert(pluginSettings)
        .values({ userId, pluginId, key, value, updatedAt })
        .onConflictDoUpdate({
          target: [
            pluginSettings.userId,
            pluginSettings.pluginId,
            pluginSettings.key,
          ],
          set: { value, updatedAt },
        })
        .run()
    },
    getSetting(key: string): string | null {
      const row = orm
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get()
      return row?.value ?? null
    },
    setSetting(key: string, value: string) {
      const updatedAt = Date.now()
      orm
        .insert(appSettings)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt },
        })
        .run()
    },
    cronJobsByPlugin(userId: string, pluginId: string) {
      return this.cronJobs(userId).filter((job) =>
        job.name.startsWith(`plugin:${pluginId}:`),
      )
    },
    listUsers() {
      return orm
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
          mustChangePassword: users.mustChangePassword,
          disabled: users.disabled,
          lastActiveAt: desktops.lastActiveAt,
        })
        .from(users)
        .leftJoin(desktops, eq(desktops.userId, users.id))
        .orderBy(users.email)
        .all()
        .map(
          (row) =>
            ({
              id: row.id,
              email: row.email,
              role: row.role === "admin" ? "admin" : "user",
              createdAt: row.createdAt,
              mustChangePassword: row.mustChangePassword,
              disabled: row.disabled,
              lastActiveAt: row.lastActiveAt,
            }) satisfies PublicUserRow,
        )
    },
    enabledAdminCount() {
      const row = orm
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.disabled, false)))
        .get()
      return Number(row?.n ?? 0)
    },
    setDisabled(userId: string, disabled: boolean) {
      orm.update(users).set({ disabled }).where(eq(users.id, userId)).run()
    },
    setRole(userId: string, role: Role) {
      orm.update(users).set({ role }).where(eq(users.id, userId)).run()
    },
    forcePasswordReset(userId: string) {
      orm
        .update(users)
        .set({ mustChangePassword: true })
        .where(eq(users.id, userId))
        .run()
    },
    deleteUserSessions(userId: string) {
      orm.delete(sessions).where(eq(sessions.userId, userId)).run()
    },
    rotateDesktopTokens(
      userId: string,
      tokens: {
        llmToken: string
        opencodePassword: string
        vikingKey: string
      },
    ) {
      orm.update(desktops).set(tokens).where(eq(desktops.userId, userId)).run()
    },
    resetDesktopState(userId: string) {
      orm.transaction((tx) => {
        tx.delete(cronJobs).where(eq(cronJobs.userId, userId)).run()
        tx.delete(cronNotices).where(eq(cronNotices.userId, userId)).run()
        tx.delete(threadPersonas).where(eq(threadPersonas.userId, userId)).run()
        tx.delete(threadScreens).where(eq(threadScreens.userId, userId)).run()
        tx.delete(threadTitles).where(eq(threadTitles.userId, userId)).run()
        tx.delete(projects).where(eq(projects.userId, userId)).run()
      })
    },
    deleteUser(userId: string) {
      orm.transaction((tx) => {
        tx.delete(sessions).where(eq(sessions.userId, userId)).run()
        tx.delete(desktops).where(eq(desktops.userId, userId)).run()
        tx.delete(usageEvents).where(eq(usageEvents.userId, userId)).run()
        tx.delete(cronJobs).where(eq(cronJobs.userId, userId)).run()
        tx.delete(cronNotices).where(eq(cronNotices.userId, userId)).run()
        tx.delete(personas).where(eq(personas.userId, userId)).run()
        tx.delete(threadPersonas).where(eq(threadPersonas.userId, userId)).run()
        tx.delete(threadScreens).where(eq(threadScreens.userId, userId)).run()
        tx.delete(improvements).where(eq(improvements.userId, userId)).run()
        tx.delete(userKeys).where(eq(userKeys.userId, userId)).run()
        tx.delete(installedPlugins)
          .where(eq(installedPlugins.userId, userId))
          .run()
        tx.delete(pluginSettings).where(eq(pluginSettings.userId, userId)).run()
        tx.delete(users).where(eq(users.id, userId)).run()
      })
    },
    recordUsage(event: UsageEvent) {
      orm.insert(usageEvents).values(event).run()
    },
    usageGrouped(since: number, userId?: string) {
      const day = sql<number>`(${usageEvents.createdAt} / 86400000) * 86400000`
      const rows = orm
        .select({
          userId: usageEvents.userId,
          kind: usageEvents.kind,
          day,
          promptTokens: sum(usageEvents.promptTokens),
          completionTokens: sum(usageEvents.completionTokens),
          totalTokens: sum(usageEvents.totalTokens),
          calls: count(),
        })
        .from(usageEvents)
        .where(
          userId
            ? and(
                gte(usageEvents.createdAt, since),
                eq(usageEvents.userId, userId),
              )
            : gte(usageEvents.createdAt, since),
        )
        .groupBy(usageEvents.userId, usageEvents.kind, day)
        .all()
      return rows.map((row) => ({
        userId: String(row.userId),
        kind: String(row.kind),
        day: Number(row.day),
        promptTokens: Number(row.promptTokens),
        completionTokens: Number(row.completionTokens),
        totalTokens: Number(row.totalTokens),
        calls: Number(row.calls),
      })) satisfies UsageGroup[]
    },
    listInvites() {
      return orm
        .select({
          code: invites.code,
          email: invites.email,
          createdAt: invites.createdAt,
          usedAt: invites.usedAt,
        })
        .from(invites)
        .orderBy(desc(invites.createdAt))
        .all()
    },
    revokeInvite(code: string) {
      const row = orm
        .select({ code: invites.code })
        .from(invites)
        .where(and(eq(invites.code, code), isNull(invites.usedAt)))
        .get()
      if (!row) return false
      orm.delete(invites).where(eq(invites.code, code)).run()
      return true
    },
    improvementsSince(userId: string, since: number) {
      const row = orm
        .select({ n: count() })
        .from(improvements)
        .where(
          and(
            eq(improvements.userId, userId),
            gte(improvements.createdAt, since),
          ),
        )
        .get()
      return Number(row?.n ?? 0)
    },
    openImprovementByFingerprint(fingerprint: string) {
      return (
        orm
          .select()
          .from(improvements)
          .where(
            and(
              eq(improvements.fingerprint, fingerprint),
              eq(improvements.status, "open"),
            ),
          )
          .get() ?? null
      )
    },
    insertImprovement(row: Improvement) {
      orm.insert(improvements).values(row).run()
    },
    bumpImprovement(
      id: string,
      patch: {
        hits: number
        lastSeenAt: number
        detail: string
        sessionId: string | null
      },
    ) {
      orm.update(improvements).set(patch).where(eq(improvements.id, id)).run()
    },
    improvementById(id: string) {
      return (
        orm.select().from(improvements).where(eq(improvements.id, id)).get() ??
        null
      )
    },
    listImprovements(status?: ImprovementStatus) {
      return orm
        .select({
          id: improvements.id,
          userId: improvements.userId,
          sessionId: improvements.sessionId,
          kind: improvements.kind,
          surface: improvements.surface,
          title: improvements.title,
          detail: improvements.detail,
          fingerprint: improvements.fingerprint,
          hits: improvements.hits,
          status: improvements.status,
          note: improvements.note,
          createdAt: improvements.createdAt,
          lastSeenAt: improvements.lastSeenAt,
          resolvedAt: improvements.resolvedAt,
          email: users.email,
        })
        .from(improvements)
        .leftJoin(users, eq(improvements.userId, users.id))
        .where(status ? eq(improvements.status, status) : sql`1 = 1`)
        .orderBy(desc(improvements.lastSeenAt))
        .all()
    },
    setImprovementStatus(
      id: string,
      status: ImprovementStatus,
      note?: string | null,
    ) {
      const row = this.improvementById(id)
      if (!row) return null
      const resolvedAt =
        status === "open" ? null : (row.resolvedAt ?? Date.now())
      orm
        .update(improvements)
        .set({
          status,
          resolvedAt,
          ...(note !== undefined ? { note } : {}),
        })
        .where(eq(improvements.id, id))
        .run()
      return this.improvementById(id)
    },
    close() {
      sqlite.close()
    },
  }
}

export type Db = ReturnType<typeof openDatabase>
