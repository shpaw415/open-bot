import type { Db, Role, User, UserKeyFields } from "@open-bot/db"
import { desktopPhase, destroyDesktop, stopDesktop } from "./docker"
import type { EventHub } from "./events"
import { handleAdminImprovements } from "./improvements"
import {
  keyVault,
  keyVaultFieldError,
  keyVaultPublic,
  keyVaultSpecById,
} from "./key-vault"
import {
  deleteUserVault,
  MAX_VAULT_CAP_MB,
  pruneMediaVault,
  VAULT_CAP_KEY,
  vaultCapMb,
} from "./media-vault"
import { randomToken } from "./passwords"
import { DISK_CAP_KEY, desktopDiskMaxGb, MAX_DISK_CAP_GB } from "./stats"
import {
  getTeamConfig,
  redactTeamConfig,
  resolveQuota,
  saveTeamConfig,
  type TeamConfig,
  type TeamProviderOverlay,
} from "./team"
import { applyTeamChange, teamKeysPublic } from "./team-apply"
import { dayLabel, fillDays, usageDays, utcDay } from "./usage"
import {
  deleteUserMedia,
  MAX_MEDIA_CAP_MB,
  MEDIA_CAP_KEY,
  mediaCapMb,
  pruneWorkspaceMedia,
} from "./workspace-snapshots"

const kinds = ["chat", "small", "embed", "vlm"] as const

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function readJson(req: Request) {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>
}

export function accountActionError(
  actorId: string,
  target: { id: string; role: Role; disabled: boolean },
  action: "delete" | "disable" | "demote",
  enabledAdmins: number,
) {
  if (action === "delete" && actorId === target.id)
    return "cannot delete yourself"
  if (action === "disable" && actorId === target.id)
    return "cannot disable yourself"
  const removesAdmin =
    target.role === "admin" &&
    !target.disabled &&
    (action === "delete" || action === "disable" || action === "demote")
  if (removesAdmin && enabledAdmins <= 1) return "cannot remove the last admin"
  return null
}

function emptyKind() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
}

// Import source: the admin's own provider setups become the shared overlay.
// ttsVoice/voiceLanguage and the watchdog toggles stay per-user and are
// never copied.
function providerOverlayFromUser(db: Db, userId: string): TeamProviderOverlay {
  const overlay: TeamProviderOverlay = {}
  const desktop = db.desktop(userId)
  if (desktop && (desktop.selectedProvider || desktop.selectedModel)) {
    overlay.chat = {
      provider: desktop.selectedProvider,
      model: desktop.selectedModel,
    }
  }
  const image = db.getRawImageProvider(userId)
  if (image) {
    overlay.image = {
      provider: image.provider,
      accountId: image.accountId,
      apiKey: image.apiKey,
      model: image.model,
    }
  }
  const video = db.getRawVideoProvider(userId)
  if (video) {
    overlay.video = {
      provider: video.provider,
      accountId: video.accountId,
      apiKey: video.apiKey,
      model: video.model,
    }
  }
  const model3d = db.getRawModel3dProvider(userId)
  if (model3d) {
    overlay.model3d = {
      provider: model3d.provider,
      accountId: model3d.accountId,
      apiKey: model3d.apiKey,
      model: model3d.model,
    }
  }
  const system1 = db.getSystem1(userId)
  if (system1) {
    overlay.system1 = {
      provider: system1.provider,
      endpoint: system1.endpoint,
      apiKey: system1.apiKey,
      gatewayToken: system1.gatewayToken,
      model: system1.model,
      accountId: system1.accountId,
      gatewayId: system1.gatewayId,
      slug: system1.slug,
    }
  }
  const voice = db.getVoiceConfig(userId)
  if (voice.sttProvider || voice.ttsProvider) {
    overlay.voice = {
      sttProvider: voice.sttProvider,
      sttAccountId: voice.sttAccountId,
      sttApiKey: voice.sttApiKey,
      sttModel: voice.sttModel,
      ttsProvider: voice.ttsProvider,
      ttsAccountId: voice.ttsAccountId,
      ttsApiKey: voice.ttsApiKey,
      ttsModel: voice.ttsModel,
    }
  }
  const watchdog = db.getWatchdogConfig(userId)
  if (watchdog.provider) {
    overlay.watchdog = {
      provider: watchdog.provider,
      accountId: watchdog.accountId,
      apiKey: watchdog.apiKey,
      model: watchdog.model,
      baseUrl: watchdog.baseUrl,
    }
  }
  return overlay
}

export async function handleAdmin(
  req: Request,
  url: URL,
  db: Db,
  actor: User,
  hub?: EventHub,
) {
  if (actor.role !== "admin") return json({ error: "admin only" }, 403)
  if (url.pathname === "/api/admin/settings" && req.method === "GET") {
    return json({
      mediaSnapshotCapMb: mediaCapMb(db),
      mediaSnapshotUsedBytes: db.workspaceMediaUsedBytes(),
      mediaVaultCapMb: vaultCapMb(db),
      mediaVaultUsedBytes: db.mediaVaultUsedBytes(),
      desktopDiskMaxGb: desktopDiskMaxGb(db),
    })
  }
  if (url.pathname === "/api/admin/settings" && req.method === "PUT") {
    const body = await readJson(req)
    if ("mediaSnapshotCapMb" in body) {
      const raw = body.mediaSnapshotCapMb
      const value =
        typeof raw === "number" && Number.isInteger(raw) ? raw : Number.NaN
      if (!Number.isFinite(value) || value < 0 || value > MAX_MEDIA_CAP_MB)
        return json(
          {
            error: `mediaSnapshotCapMb must be an integer between 0 and ${MAX_MEDIA_CAP_MB}`,
          },
          400,
        )
      db.setSetting(MEDIA_CAP_KEY, String(value))
      pruneWorkspaceMedia(db)
    }
    if ("mediaVaultCapMb" in body) {
      const raw = body.mediaVaultCapMb
      const value =
        typeof raw === "number" && Number.isInteger(raw) ? raw : Number.NaN
      if (!Number.isFinite(value) || value < 0 || value > MAX_VAULT_CAP_MB)
        return json(
          {
            error: `mediaVaultCapMb must be an integer between 0 and ${MAX_VAULT_CAP_MB}`,
          },
          400,
        )
      db.setSetting(VAULT_CAP_KEY, String(value))
      pruneMediaVault(db)
    }
    if ("desktopDiskMaxGb" in body) {
      const raw = body.desktopDiskMaxGb
      const value =
        typeof raw === "number" && Number.isInteger(raw) ? raw : Number.NaN
      if (!Number.isFinite(value) || value < 0 || value > MAX_DISK_CAP_GB)
        return json(
          {
            error: `desktopDiskMaxGb must be an integer between 0 and ${MAX_DISK_CAP_GB}`,
          },
          400,
        )
      db.setSetting(DISK_CAP_KEY, String(value))
    }
    if (
      !("mediaSnapshotCapMb" in body) &&
      !("mediaVaultCapMb" in body) &&
      !("desktopDiskMaxGb" in body)
    )
      return json({ error: "nothing to update" }, 400)
    return json({
      mediaSnapshotCapMb: mediaCapMb(db),
      mediaSnapshotUsedBytes: db.workspaceMediaUsedBytes(),
      mediaVaultCapMb: vaultCapMb(db),
      mediaVaultUsedBytes: db.mediaVaultUsedBytes(),
      desktopDiskMaxGb: desktopDiskMaxGb(db),
    })
  }
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const users = db.listUsers()
    const phases = await Promise.all(
      users.map(async (row) => ({
        ...row,
        desktop: await desktopPhase(row.id),
      })),
    )
    return json({ users: phases })
  }
  if (url.pathname === "/api/admin/usage" && req.method === "GET") {
    const days = usageDays(url.searchParams.get("days"))
    const userId = url.searchParams.get("userId") || undefined
    const since = utcDay(Date.now()) - (days - 1) * 86_400_000
    const rows = db.usageGrouped(since, userId)
    const emails = new Map(db.listUsers().map((row) => [row.id, row.email]))
    const totals = emptyKind()
    const byKind = new Map(kinds.map((kind) => [kind, emptyKind()]))
    const daily = new Map<
      number,
      Map<
        string,
        {
          email: string
          byKind: Record<string, ReturnType<typeof emptyKind>>
        }
      >
    >()
    for (const day of fillDays(Date.now(), days)) daily.set(day, new Map())
    for (const row of rows) {
      totals.promptTokens += row.promptTokens
      totals.completionTokens += row.completionTokens
      totals.totalTokens += row.totalTokens
      totals.calls += row.calls
      const kindBucket = byKind.get(row.kind as (typeof kinds)[number])
      if (kindBucket) {
        kindBucket.promptTokens += row.promptTokens
        kindBucket.completionTokens += row.completionTokens
        kindBucket.totalTokens += row.totalTokens
        kindBucket.calls += row.calls
      }
      const bucket = daily.get(row.day) ?? new Map()
      daily.set(row.day, bucket)
      const user = bucket.get(row.userId) ?? {
        email: emails.get(row.userId) ?? row.userId,
        byKind: Object.fromEntries(kinds.map((kind) => [kind, emptyKind()])),
      }
      const slot = user.byKind[row.kind] ?? emptyKind()
      slot.promptTokens += row.promptTokens
      slot.completionTokens += row.completionTokens
      slot.totalTokens += row.totalTokens
      slot.calls += row.calls
      user.byKind[row.kind] = slot
      bucket.set(row.userId, user)
    }
    return json({
      days,
      totals,
      byKind: kinds.map((kind) => ({ kind, ...byKind.get(kind) })),
      daily: [...daily.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, users]) => ({
          day: dayLabel(day),
          users: [...users.entries()].map(([id, user]) => ({
            userId: id,
            email: user.email,
            byKind: user.byKind,
          })),
        })),
    })
  }
  if (url.pathname === "/api/admin/invites" && req.method === "GET") {
    return json({ invites: db.listInvites() })
  }
  if (url.pathname === "/api/admin/invites" && req.method === "POST") {
    const code = randomToken().slice(0, 16)
    db.createInvite(code, null)
    return json({ code })
  }
  const inviteMatch = url.pathname.match(/^\/api\/admin\/invites\/([^/]+)$/)
  if (inviteMatch && req.method === "DELETE") {
    const code = decodeURIComponent(inviteMatch[1] ?? "")
    if (!db.revokeInvite(code)) return json({ error: "invite not found" }, 404)
    return json({ ok: true })
  }
  if (url.pathname === "/api/admin/team" && req.method === "GET") {
    const { config, secrets } = redactTeamConfig(getTeamConfig(db))
    return json({
      config,
      secrets,
      catalog: keyVaultPublic(),
      keys: teamKeysPublic(db),
    })
  }
  if (url.pathname === "/api/admin/team" && req.method === "PUT") {
    const body = (await readJson(req)) as Partial<TeamConfig>
    let saved: TeamConfig
    try {
      saved = saveTeamConfig(db, body)
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : "invalid team config",
        },
        400,
      )
    }
    const quotaOnly = Object.keys(body).every(
      (key) => key === "quotaDefaultTokens" || key === "quotaBehavior",
    )
    if (!quotaOnly) {
      const results = await applyTeamChange(db, hub, { configChanged: true })
      for (const result of results) {
        if (!result.ok) {
          console.error(`team fan-out ${result.userId}: ${result.error}`)
        }
      }
    }
    const { config, secrets } = redactTeamConfig(saved)
    return json({ config, secrets })
  }
  if (url.pathname === "/api/admin/team/keys" && req.method === "PUT") {
    const body = await readJson(req)
    const slug = String(body.slug ?? "").trim()
    if (!keyVaultSpecById(slug))
      return json({ error: "unknown key entry" }, 400)
    const current = db.getTeamKey(slug)
    const field = (name: keyof UserKeyFields) =>
      String(body[name] ?? "").trim() || current?.[name] || ""
    const fields: UserKeyFields = {
      apiKey: field("apiKey"),
      accountId: field("accountId"),
      gatewayId: field("gatewayId"),
      gatewayToken: field("gatewayToken"),
      gatewaySlug: field("gatewaySlug"),
      baseUrl: field("baseUrl"),
    }
    for (const name of ["gatewayId", "gatewaySlug"] as const) {
      const error = keyVaultFieldError(slug, name, fields[name])
      if (error) return json({ error }, 400)
    }
    if (Object.values(fields).every((value) => value === "")) {
      return json({ error: "at least one field is required" }, 400)
    }
    db.setTeamKey(slug, fields)
    await applyTeamChange(db, hub, { slugs: [slug] })
    return json({ keys: teamKeysPublic(db) })
  }
  if (url.pathname === "/api/admin/team/import" && req.method === "POST") {
    for (const spec of keyVault) {
      const key = db.getUserKey(actor.id, spec.id)
      if (!key) continue
      const { userId: _userId, ...fields } = key
      db.setTeamKey(spec.id, fields)
    }
    const saved = saveTeamConfig(db, {
      mode: "team",
      providers: providerOverlayFromUser(db, actor.id),
    })
    await applyTeamChange(db, hub, { configChanged: true })
    const { config, secrets } = redactTeamConfig(saved)
    return json({ config, secrets, keys: teamKeysPublic(db) })
  }
  if (url.pathname === "/api/admin/team/quotas" && req.method === "GET") {
    const config = getTeamConfig(db)
    const now = Date.now()
    return json({
      default: config.quotaDefaultTokens,
      behavior: config.quotaBehavior,
      users: db.listUsers().map((user) => {
        const quota = resolveQuota(db, user.id, now)
        return {
          userId: user.id,
          email: user.email,
          weeklyTokens: db.getUserQuota(user.id)?.weeklyTokens ?? null,
          used: quota.used,
          limitTokens: quota.limitTokens,
        }
      }),
    })
  }
  if (url.pathname === "/api/admin/team/quota" && req.method === "PUT") {
    const body = await readJson(req)
    const userId = String(body.userId ?? "").trim()
    if (!db.userById(userId)) return json({ error: "user not found" }, 404)
    const raw = body.weeklyTokens
    if (
      raw !== null &&
      (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0)
    ) {
      return json(
        { error: "weeklyTokens must be a non-negative integer or null" },
        400,
      )
    }
    db.setUserQuota(userId, raw as number | null)
    return json({
      ok: true,
      weeklyTokens: db.getUserQuota(userId)?.weeklyTokens ?? null,
    })
  }
  const improvement = await handleAdminImprovements(req, url, db)
  if (improvement) return improvement
  const userMatch = url.pathname.match(
    /^\/api\/admin\/users\/([^/]+)(?:\/(disable|enable|reset-password))?$/,
  )
  if (!userMatch) return json({ error: "not found" }, 404)
  const target = db.userById(decodeURIComponent(userMatch[1] ?? ""))
  if (!target) return json({ error: "user not found" }, 404)
  const action = userMatch[2]
  if (req.method === "POST" && action === "disable") {
    const error = accountActionError(
      actor.id,
      target,
      "disable",
      db.enabledAdminCount(),
    )
    if (error) return json({ error }, 400)
    db.setDisabled(target.id, true)
    db.deleteUserSessions(target.id)
    await stopDesktop(target.id)
    return json({ ok: true })
  }
  if (req.method === "POST" && action === "enable") {
    db.setDisabled(target.id, false)
    return json({ ok: true })
  }
  if (req.method === "POST" && action === "reset-password") {
    db.forcePasswordReset(target.id)
    db.deleteUserSessions(target.id)
    return json({ ok: true })
  }
  if (req.method === "PATCH" && !action) {
    const body = await readJson(req)
    const role =
      body.role === "admin" ? "admin" : body.role === "user" ? "user" : ""
    if (!role) return json({ error: "role must be admin or user" }, 400)
    if (role === "user") {
      const error = accountActionError(
        actor.id,
        target,
        "demote",
        db.enabledAdminCount(),
      )
      if (error) return json({ error }, 400)
    }
    db.setRole(target.id, role)
    return json({ ok: true })
  }
  if (req.method === "DELETE" && !action) {
    const error = accountActionError(
      actor.id,
      target,
      "delete",
      db.enabledAdminCount(),
    )
    if (error) return json({ error }, 400)
    await destroyDesktop(target.id)
    deleteUserMedia(db, target.id)
    deleteUserVault(db, target.id)
    db.deleteUser(target.id)
    return json({ ok: true })
  }
  return json({ error: "not found" }, 404)
}
