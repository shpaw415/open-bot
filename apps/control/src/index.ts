import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { type AiConfigInput, defineAi } from "@open-bot/ai"
import { openDatabase } from "@open-bot/db"
import { applyPendingRestore, startBackupScheduler } from "./backup"
import { startCronScheduler } from "./cron"
import {
  containerExists,
  currentStart,
  desktopBusy,
  desktopPhase,
  isRunning,
  onDesktopReady,
  runningCount,
  sleptRecently,
  startDesktop,
  stopDesktop,
} from "./docker"
import {
  aiConfigPath,
  bindHosts,
  dataDir,
  idleMinutes,
  maxDesktops,
  names,
  port,
} from "./env"
import { EventHub } from "./events"
import { setFileWatchSink } from "./file-watch"
import { resolveDesktopProviders } from "./key-vault"
import { hashPassword, randomToken, verifyPassword } from "./passwords"
import { reapplyPluginSetup } from "./plugins-apply"
import { createServer, eventTarget } from "./server"
import { startStuckWatch } from "./stuck"

applyPendingRestore()

const loaded = await import(pathToFileURL(aiConfigPath).href)
if (!loaded.default) {
  throw new Error(`${aiConfigPath} must export default`)
}
const ai = defineAi(loaded.default as AiConfigInput)
const db = openDatabase(join(dataDir, "open-bot.sqlite"))

const defaultEmail = "admin@localhost"
const defaultPassword = "changeme"
if (db.userCount() === 0) {
  const id = crypto.randomUUID()
  db.createUser({
    id,
    email: defaultEmail,
    passwordHash: hashPassword(defaultPassword),
    role: "admin",
    createdAt: Date.now(),
    mustChangePassword: true,
    disabled: false,
  })
  db.ensureDesktop({
    userId: id,
    llmToken: randomToken(),
    opencodePassword: randomToken(),
    vikingKey: randomToken(),
    selectedProvider: null,
    selectedModel: null,
    lastActiveAt: Date.now(),
  })
} else {
  const admin = db.userByEmail(defaultEmail)
  if (
    admin?.mustChangePassword &&
    !verifyPassword(defaultPassword, admin.passwordHash)
  ) {
    db.setCredentials(admin.id, defaultEmail, hashPassword(defaultPassword))
    db.forcePasswordReset(admin.id)
  }
}

const hub = new EventHub((userId) => eventTarget(db, userId))
onDesktopReady((userId) => reapplyPluginSetup(db, userId))
setFileWatchSink((userId, files) => {
  hub.emit(userId, { type: "project.files", properties: { files } })
})
const servers = bindHosts.flatMap((host) => {
  try {
    const server = createServer(db, ai, host, hub)
    console.log(`open-bot listening on http://${host}:${server.port ?? port}`)
    return [server]
  } catch (error) {
    console.error(
      `bind ${host}:${port} failed: ${error instanceof Error ? error.message : error}`,
    )
    return []
  }
})
if (servers.length === 0) {
  throw new Error("open-bot failed to bind any address")
}

startCronScheduler(db, hub)
startStuckWatch(db, hub)
startBackupScheduler(db)

const RESTART_COOLDOWN_MS = 5 * 60_000
const restartAttempts = new Map<string, number>()

// Every minute: stop desktops idle past the cutoff (never mid-turn), and
// restart desktops whose containers crashed while the user was still active.
setInterval(() => {
  void (async () => {
    const cutoff = Date.now() - idleMinutes * 60 * 1000
    try {
      for (const row of db.idleDesktops(cutoff)) {
        if ((await desktopPhase(row.userId)) !== "running") continue
        if (await desktopBusy(row.userId, db.desktop(row.userId))) continue
        await stopDesktop(row.userId)
      }
    } catch {
      return
    }
    try {
      for (const row of db.activeDesktops(cutoff)) {
        if (currentStart(row.userId)) continue
        if (sleptRecently(row.userId)) continue
        const last = restartAttempts.get(row.userId) ?? 0
        if (Date.now() - last < RESTART_COOLDOWN_MS) continue
        const n = names(row.userId)
        // A stopped-but-existing container is a crash; a missing one was
        // never started and must stay on demand.
        if (
          (await isRunning(n.opencode)) ||
          !(await containerExists(n.opencode))
        )
          continue
        const desktop = db.desktop(row.userId)
        if (!desktop) continue
        restartAttempts.set(row.userId, Date.now())
        if ((await runningCount()) >= maxDesktops) continue
        const auth = resolveDesktopProviders(db, row.userId)
        console.log(`restarting crashed desktop for user ${row.userId}`)
        startDesktop(
          row.userId,
          desktop,
          auth.viking,
          auth.image,
          auth.system1,
          auth.video,
          auth.model3d,
          auth.chatKeys,
        ).catch((error: unknown) => {
          console.error(
            `desktop restart failed: ${
              error instanceof Error ? error.message : error
            }`,
          )
        })
      }
    } catch (error) {
      console.error(
        `desktop restart sweep failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  })()
}, 60_000)
