import { rmSync } from "node:fs"
import { join } from "node:path"
import type { Db } from "@open-bot/db"
import {
  backupInFlight,
  createBackup,
  restoreControlDbSnapshot,
  restoreUserVolumes,
} from "./backup"
import {
  desktopPhase,
  destroyDesktop,
  startDesktop,
  stopDesktop,
} from "./docker"
import { dataDir } from "./env"
import type { EventHub } from "./events"
import { resolveDesktopProviders } from "./key-vault"
import { randomToken } from "./passwords"

export type ControlOp = {
  id: string
  kind: "reset" | "restore" | "factory-reset"
  userId: string | null
  state: "running" | "done" | "failed"
  error: string | null
  detail: string | null
}

const ops = new Map<string, ControlOp>()

export function opState(id: string): ControlOp | null {
  return ops.get(id) ?? null
}

async function runOp(
  hub: EventHub,
  op: ControlOp,
  runner: () => Promise<string>,
) {
  try {
    op.detail = await runner()
    op.state = "done"
  } catch (error) {
    op.state = "failed"
    op.error = error instanceof Error ? error.message : "operation failed"
  }
  if (op.userId) {
    hub.emit(op.userId, { type: "reset.result", properties: { ...op } })
  }
  setTimeout(() => ops.delete(op.id), 60 * 60 * 1000).unref?.()
}

function newOp(kind: ControlOp["kind"], userId: string | null): ControlOp {
  const op: ControlOp = {
    id: randomToken().slice(0, 16),
    kind,
    userId,
    state: "running",
    error: null,
    detail: null,
  }
  ops.set(op.id, op)
  return op
}

/** Destroy one user's desktop and recreate its control-plane state fresh. */
export async function resetDesktop(
  db: Db,
  userId: string,
  options: { backup: boolean },
): Promise<string> {
  if (options.backup && backupInFlight() === false) {
    await createBackup({
      db,
      trigger: "pre-reset",
      userIds: [userId],
      includeControlDb: false,
    })
  }
  const wasRunning = (await desktopPhase(userId)) === "running"
  await destroyDesktop(userId)
  db.resetDesktopState(userId)
  db.rotateDesktopTokens(userId, {
    llmToken: randomToken(),
    opencodePassword: randomToken(),
    vikingKey: randomToken(),
  })
  if (wasRunning) {
    const desktop = db.desktop(userId)
    const auth = resolveDesktopProviders(db, userId)
    if (desktop) {
      await startDesktop(
        userId,
        desktop,
        auth.viking,
        auth.image,
        auth.system1,
        auth.video,
        auth.model3d,
        auth.chatKeys,
      ).catch(() => {})
    }
  }
  return "desktop reset"
}

export function startReset(
  db: Db,
  hub: EventHub,
  userId: string,
  options: { backup: boolean },
): ControlOp {
  const op = newOp("reset", userId)
  void runOp(hub, op, () => resetDesktop(db, userId, options))
  return op
}

/** Restore one user's desktop volumes from a backup, restarting if needed. */
export async function restoreDesktopVolumes(
  db: Db,
  userId: string,
  backupId: string,
  options: { backup: boolean },
) {
  if (options.backup && backupInFlight() === false) {
    await createBackup({
      db,
      trigger: "manual",
      label: `pre-restore ${backupId}`,
      userIds: [userId],
      includeControlDb: false,
    })
  }
  const wasRunning = (await desktopPhase(userId)) === "running"
  await stopDesktop(userId)
  const restored = await restoreUserVolumes(backupId, userId)
  if (restored.length === 0) throw new Error("nothing was restored")
  if (wasRunning) {
    const desktop = db.desktop(userId)
    const auth = resolveDesktopProviders(db, userId)
    if (desktop) {
      await startDesktop(
        userId,
        desktop,
        auth.viking,
        auth.image,
        auth.system1,
        auth.video,
        auth.model3d,
        auth.chatKeys,
      ).catch(() => {})
    }
  }
  return `restored ${restored.join(", ")}`
}

export function startRestore(
  db: Db,
  hub: EventHub,
  userId: string,
  backupId: string,
  options: { backup: boolean },
): ControlOp {
  const op = newOp("restore", userId)
  void runOp(hub, op, () =>
    restoreDesktopVolumes(db, userId, backupId, options),
  )
  return op
}

/**
 * Wipe the whole control plane: destroy every desktop, delete the sqlite
 * database, and exit. Compose restarts the container, which re-seeds the
 * default admin. Backups under /data/backups are kept.
 */
export async function factoryResetControl(db: Db): Promise<string> {
  const errors: string[] = []
  for (const userId of db.desktopUserIds()) {
    try {
      await destroyDesktop(userId)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "destroy failed")
    }
  }
  db.close()
  for (const name of [
    "open-bot.sqlite",
    "open-bot.sqlite-wal",
    "open-bot.sqlite-shm",
    "open-bot.sqlite.restore",
    "open-bot.sqlite.pre-restore",
    "open-bot.sqlite.pre-restore-wal",
    "open-bot.sqlite.pre-restore-shm",
  ]) {
    rmSync(join(dataDir, name), { force: true })
  }
  if (errors.length > 0) throw new Error(errors.join("; "))
  return "factory reset complete"
}

export function startFactoryReset(
  db: Db,
  hub: EventHub,
  adminUserId: string,
  options: { backup: boolean },
): ControlOp {
  const op = newOp("factory-reset", adminUserId)
  void runOp(hub, op, async () => {
    if (options.backup && backupInFlight() === false) {
      await createBackup({
        db,
        trigger: "manual",
        label: "pre-factory-reset",
        userIds: db.desktopUserIds(),
        includeControlDb: true,
      })
    }
    await factoryResetControl(db)
    return "factory reset complete"
  }).finally(() => {
    // Give the response time to reach the dashboard before the process dies.
    setTimeout(() => process.exit(op.state === "failed" ? 1 : 0), 1500)
  })
  return op
}

/** Restore the control database from a backup; takes effect on next boot. */
export function startControlDbRestore(
  hub: EventHub,
  adminUserId: string,
  backupId: string,
): ControlOp {
  const op = newOp("restore", adminUserId)
  void runOp(hub, op, async () => {
    restoreControlDbSnapshot(backupId)
    setTimeout(() => process.exit(0), 1500)
    return "control database staged; control plane restarts now"
  })
  return op
}
