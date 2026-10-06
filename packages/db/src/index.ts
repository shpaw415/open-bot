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
  cronJobs,
  cronNotices,
  desktops,
  invites,
  personas,
  sessions,
  threadPersonas,
  threadScreens,
  usageEvents,
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

export type VikingProvider = {
  baseURL: string
  apiKey: string
  embedModel: string
  embedDimension: number
  vlmModel: string
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

export type CronScheduleKind = "cron" | "every" | "at"

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
}

export type CronNotice = {
  id: string
  userId: string
  jobId: string
  jobName: string
  sessionId: string
  runSessionId: string | null
  summary: string | null
  createdAt: number
  viewedAt: number | null
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
  }
}

function mapCronNotice(row: typeof cronNotices.$inferSelect): CronNotice {
  return {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    jobName: row.jobName,
    sessionId: row.sessionId,
    runSessionId: row.runSessionId,
    summary: row.summary,
    createdAt: row.createdAt,
    viewedAt: row.viewedAt,
  }
}

export function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.exec("PRAGMA journal_mode = WAL")
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
    desktopUserIds() {
      return orm
        .select({ userId: desktops.userId })
        .from(desktops)
        .all()
        .map((row) => row.userId)
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
      return true
    },
    createCronNotice(notice: CronNotice) {
      orm.insert(cronNotices).values(notice).run()
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
    setCronNoticeSession(id: string, sessionId: string) {
      orm
        .update(cronNotices)
        .set({ sessionId })
        .where(eq(cronNotices.id, id))
        .run()
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
            eq(cronNotices.sessionId, notice.sessionId),
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
    viewCronNoticesBySession(userId: string, sessionId: string) {
      orm
        .update(cronNotices)
        .set({ viewedAt: Date.now() })
        .where(
          and(
            eq(cronNotices.userId, userId),
            eq(cronNotices.sessionId, sessionId),
            isNotNull(cronNotices.summary),
            isNull(cronNotices.viewedAt),
          ),
        )
        .run()
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
  }
}

export type Db = ReturnType<typeof openDatabase>
