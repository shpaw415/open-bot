import type { Db, User } from "@open-bot/db"
import {
  BACKUP_NEXT_RUN_KEY,
  type BackupRunState,
  backupInFlight,
  backupStatus,
  deleteBackup,
  listBackups,
  loadBackupConfig,
  parseBackupConfig,
  publicBackupConfig,
  readManifest,
  runState,
  saveBackupConfig,
  startBackup,
  testBucket,
} from "./backup"
import type { EventHub } from "./events"
import { HttpError } from "./http-error"
import { verifyPassword } from "./passwords"
import {
  opState,
  startControlDbRestore,
  startFactoryReset,
  startReset,
  startRestore,
} from "./reset"
import {
  type ApprovalAction,
  approvalSummary,
  type ResetApprovals,
} from "./reset-approvals"

export type BackupScope = "agent" | "user" | "admin"

export type BackupApiContext = {
  actor: User
  scope: BackupScope
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function readJson(req: Request) {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>
}

function summaryForUser(
  actorId: string,
  scope: BackupScope,
): ReturnType<typeof listBackups> {
  const all = listBackups()
  if (scope === "admin") return all
  return all.filter((item) => item.users.some((u) => u.userId === actorId))
}

function scopedRun(
  state: BackupRunState,
  actorId: string,
  scope: BackupScope,
): BackupRunState | null {
  if (scope === "admin") return state
  if (!state.userIds.includes(actorId)) return null
  return state
}

function parseAction(body: Record<string, unknown>): {
  error?: string
  action?: ApprovalAction
} {
  const action = String(body.action ?? "")
  if (action === "reset") return { action: { kind: "reset" } }
  if (action === "restore") {
    const backupId = String(body.backupId ?? "").trim()
    if (!backupId) return { error: "backupId is required" }
    return { action: { kind: "restore", backupId } }
  }
  return { error: "action must be reset or restore" }
}

/**
 * Routes for backups, reset approvals, and reset operations. Returns null
 * when the path is not one of these routes so the caller can fall through.
 */
export async function handleBackupApi(
  req: Request,
  url: URL,
  db: Db,
  hub: EventHub,
  ctx: BackupApiContext,
  approvals: ResetApprovals,
): Promise<Response | null> {
  const { actor, scope } = ctx
  const path = url.pathname
  const method = req.method

  // --- config (admin) ---
  if (path === "/api/backup/config" && method === "GET") {
    if (scope !== "admin") return json({ error: "admin only" }, 403)
    const config = loadBackupConfig(db)
    const nextRaw = db.getSetting(BACKUP_NEXT_RUN_KEY)
    return json({
      config: publicBackupConfig(config),
      nextRunAt:
        config.enabled && config.schedule ? Number(nextRaw) || null : null,
    })
  }
  if (path === "/api/backup/config" && method === "PUT") {
    if (scope !== "admin") return json({ error: "admin only" }, 403)
    return (async () => {
      const body = await readJson(req)
      const parsed = parseBackupConfig(body.config ?? body)
      if (parsed.error || !parsed.value)
        return json({ error: parsed.error }, 400)
      saveBackupConfig(db, parsed.value)
      return json({ config: publicBackupConfig(parsed.value) })
    })()
  }
  if (path === "/api/backup/config/test" && method === "POST") {
    if (scope !== "admin") return json({ error: "admin only" }, 403)
    return (async () => {
      const body = await readJson(req)
      const parsed = parseBackupConfig({ bucket: body.bucket ?? body })
      if (parsed.error || !parsed.value?.bucket)
        return json({ error: parsed.error ?? "bucket config missing" }, 400)
      const error = await testBucket(parsed.value.bucket)
      return json({ ok: error === null, error })
    })()
  }

  // --- list & detail ---
  if (path === "/api/backup" && method === "GET") {
    const config = loadBackupConfig(db)
    return json({
      status: backupStatus(db),
      backups: summaryForUser(actor.id, scope),
      config:
        scope === "admin"
          ? publicBackupConfig(config)
          : { enabled: config.enabled },
    })
  }
  const backupIdMatch = path.match(/^\/api\/backup\/([^/]+)$/)
  if (backupIdMatch && method === "GET") {
    const id = decodeURIComponent(backupIdMatch[1] ?? "")
    const run = runState(id)
    if (run) {
      const visible = scopedRun(run, actor.id, scope)
      if (!visible) return json({ error: "not found" }, 404)
      return json({ run: visible })
    }
    const manifest = readManifest(id)
    if (!manifest) return json({ error: "not found" }, 404)
    if (
      scope !== "admin" &&
      !manifest.users.some((user) => user.userId === actor.id)
    )
      return json({ error: "not found" }, 404)
    return json({ manifest })
  }

  // --- run a backup ---
  if (path === "/api/backup/run" && method === "POST") {
    if (backupInFlight())
      return json({ error: "a backup is already running" }, 409)
    return (async () => {
      const body = await readJson(req)
      const full = scope === "admin" && Boolean(body.full)
      const state = startBackup({
        db,
        trigger: "manual",
        label: body.label ? String(body.label).slice(0, 80) : null,
        userIds: full ? db.desktopUserIds() : [actor.id],
        includeControlDb: full,
      })
      return json({ id: state.id, state: state.state }, 202)
    })()
  }

  // --- delete (admin) ---
  if (backupIdMatch && method === "DELETE") {
    if (scope !== "admin") return json({ error: "admin only" }, 403)
    const id = decodeURIComponent(backupIdMatch[1] ?? "")
    if (!deleteBackup(id, db)) return json({ error: "not found" }, 404)
    return json({ ok: true })
  }

  // --- restore ---
  const restoreMatch = path.match(/^\/api\/backup\/([^/]+)\/restore$/)
  if (restoreMatch && method === "POST") {
    if (scope === "agent")
      return json(
        { error: "agents restore through the approval flow (reset-requests)" },
        403,
      )
    return (async () => {
      const body = await readJson(req)
      const backupId = decodeURIComponent(restoreMatch[1] ?? "")
      const manifest = readManifest(backupId)
      if (!manifest) return json({ error: "backup not found" }, 404)
      const options = { backup: body.backup !== false }
      const opIds: string[] = []
      if (scope === "admin") {
        if (body.controlDb) {
          if (!manifest.controlDb)
            return json({ error: "backup has no control database" }, 400)
          opIds.push(startControlDbRestore(hub, actor.id, backupId).id)
        }
        const requested = Array.isArray(body.userIds)
          ? (body.userIds as unknown[]).map(String)
          : manifest.users.map((user) => user.userId)
        for (const userId of requested) {
          if (!manifest.users.some((user) => user.userId === userId)) continue
          opIds.push(startRestore(db, hub, userId, backupId, options).id)
        }
      } else {
        if (!manifest.users.some((user) => user.userId === actor.id))
          return json({ error: "backup has no volumes for this user" }, 404)
        opIds.push(startRestore(db, hub, actor.id, backupId, options).id)
      }
      if (opIds.length === 0) return json({ error: "nothing to restore" }, 400)
      return json({ opIds }, 202)
    })()
  }

  // --- approval flow (agent creates) ---
  if (path === "/api/reset-requests" && method === "POST") {
    if (scope !== "agent")
      return json({ error: "approval requests are agent-only" }, 403)
    return (async () => {
      const body = await readJson(req)
      const parsed = parseAction(body)
      if (parsed.error || !parsed.action)
        return json({ error: parsed.error }, 400)
      if (parsed.action.kind === "restore") {
        const manifest = readManifest(parsed.action.backupId)
        if (!manifest || !manifest.users.some((u) => u.userId === actor.id))
          return json({ error: "backup not found for this desktop" }, 404)
      }
      const record = approvals.create(actor.id, parsed.action)
      hub.emit(actor.id, {
        type: "reset.request",
        properties: approvalSummary(record),
      })
      return json(approvalSummary(record), 201)
    })()
  }

  const requestMatch = path.match(/^\/api\/reset-requests\/([^/]+)$/)
  if (requestMatch && method === "GET") {
    const record = approvals.get(
      decodeURIComponent(requestMatch[1] ?? ""),
      actor.id,
    )
    if (!record) return json({ error: "not found" }, 404)
    return json(approvalSummary(record))
  }

  const approveMatch = path.match(/^\/api\/reset-requests\/([^/]+)\/approve$/)
  if (approveMatch && method === "POST") {
    if (scope === "agent")
      return json({ error: "agents cannot approve their own requests" }, 403)
    return (async () => {
      const body = await readJson(req)
      const id = decodeURIComponent(approveMatch[1] ?? "")
      const outcome = approvals.approve(
        id,
        actor.id,
        String(body.password ?? ""),
        verifyPassword,
        db.userById(actor.id)?.passwordHash ?? null,
      )
      if (outcome.error || !outcome.record)
        return json({ error: outcome.error }, 400)
      const action = outcome.record.action
      const options = { backup: body.backup !== false }
      const op =
        action.kind === "restore"
          ? startRestore(db, hub, actor.id, action.backupId, options)
          : startReset(db, hub, actor.id, options)
      const poll = setInterval(() => {
        const state = opState(op.id)
        if (!state || state.state === "running") return
        clearInterval(poll)
        approvals.setResult(id, {
          state: state.state,
          error: state.error,
          detail: state.detail,
        })
      }, 1000)
      poll.unref?.()
      return json({ ok: true, opId: op.id })
    })()
  }

  const denyMatch = path.match(/^\/api\/reset-requests\/([^/]+)\/deny$/)
  if (denyMatch && method === "POST") {
    if (scope === "agent")
      return json({ error: "agents cannot deny their own requests" }, 403)
    const outcome = approvals.deny(
      decodeURIComponent(denyMatch[1] ?? ""),
      actor.id,
    )
    if (outcome.error || !outcome.record)
      return json({ error: outcome.error }, 400)
    return json({ ok: true })
  }

  // --- operation status ---
  const opMatch = path.match(/^\/api\/reset-ops\/([^/]+)$/)
  if (opMatch && method === "GET") {
    const state = opState(decodeURIComponent(opMatch[1] ?? ""))
    if (!state) return json({ error: "not found" }, 404)
    if (scope !== "admin" && state.userId !== actor.id)
      return json({ error: "not found" }, 404)
    return json(state)
  }

  // --- user-initiated desktop reset ---
  if (path === "/api/desktop/reset" && method === "POST") {
    if (scope === "agent")
      return json({ error: "agents reset through the approval flow" }, 403)
    return (async () => {
      const body = await readJson(req)
      const op = startReset(db, hub, actor.id, {
        backup: body.backup !== false,
      })
      return json({ opId: op.id }, 202)
    })()
  }

  // --- control-plane factory reset (admin) ---
  if (path === "/api/factory-reset" && method === "POST") {
    if (scope !== "admin") return json({ error: "admin only" }, 403)
    return (async () => {
      const body = await readJson(req)
      if (String(body.confirm ?? "") !== "RESET")
        return json({ error: "type RESET to confirm" }, 400)
      const stored = db.userById(actor.id)?.passwordHash
      if (!stored || !verifyPassword(String(body.password ?? ""), stored))
        return json({ error: "wrong password" }, 400)
      const op = startFactoryReset(db, hub, actor.id, {
        backup: body.backup !== false,
      })
      return json({ opId: op.id }, 202)
    })()
  }

  if (path.startsWith("/api/backup") || path.startsWith("/api/reset-")) {
    throw new HttpError(405, "method not allowed", "method_not_allowed")
  }
  return null
}
