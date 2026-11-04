import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { type AiConfigInput, defineAi } from "@open-bot/ai"
import { openDatabase } from "@open-bot/db"
import { applyPendingRestore, startBackupScheduler } from "./backup"
import { startCronScheduler } from "./cron"
import { dispatchDelegationWakes } from "./delegations"
import {
  containerExists,
  currentStart,
  desktopBusy,
  desktopPhase,
  isRunning,
  onDesktopReady,
  onDesktopUp,
  reconnectDesktopNetworks,
  runningCount,
  sleptRecently,
  startDesktop,
  stopDesktop,
  syncAgentCap,
  syncWatchdogConfig,
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
import { hashPassword, randomToken } from "./passwords"
import { dispatchPluginHooks } from "./plugin-hooks"
import { convertGuardCrons } from "./plugins"
import { flushPendingPluginConfigs, reapplyPluginSetup } from "./plugins-apply"
import { createServer, eventTarget } from "./server"
import { startStatsSampler } from "./stats"
import { startStuckWatch } from "./stuck"
import { pushTeamOpencodeAuth } from "./team-apply"
import {
  dispatchThreadQueueFlush,
  flushThreadQueuesForUser,
} from "./thread-queue"
import { resolveWatchdogConfig, watchdogContainerPayload } from "./watchdog"
import { onUpstreamEvent } from "./workspace-snapshots"

applyPendingRestore()

const loaded = await import(pathToFileURL(aiConfigPath).href)
if (!loaded.default) {
  throw new Error(`${aiConfigPath} must export default`)
}
const ai = defineAi(loaded.default as AiConfigInput)
const db = openDatabase(join(dataDir, "open-bot.sqlite"))

const defaultEmail = "admin@localhost"
if (db.userCount() === 0) {
  const defaultPassword = randomToken()
  console.log(
    `open-bot bootstrap admin ${defaultEmail} password: ${defaultPassword}`,
  )
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
    thinkingEffort: null,
    lastActiveAt: Date.now(),
  })
}

const hub = new EventHub(
  (userId) => eventTarget(db, userId),
  (userId, event) => {
    onUpstreamEvent(db, userId, event)
    dispatchPluginHooks(db, userId, event)
    dispatchDelegationWakes(db, userId, event)
    dispatchThreadQueueFlush(db, hub, userId, event)
  },
)
onDesktopReady((userId) => {
  hub.ensurePump(userId)
  flushThreadQueuesForUser(db, hub, userId)
  // The boot re-apply rewrites setup state and the applied init log; a finished
  // run refreshes any Plugins page watching this desktop.
  return reapplyPluginSetup(db, userId).then(() => {
    hub.emit(userId, { type: "plugins.changed" })
  })
})
// Config syncs deferred while the desktop slept (vault keys, plugin settings)
// land the moment it is running again — create or wake. The watchdog config
// rides along: every wake recreates the container, and the daemon picks the
// refreshed file up on its next mtime poll.
onDesktopUp(async (userId) => {
  await syncAgentCap(userId, db.desktop(userId)?.agentStepCap ?? null, {
    db,
    hub,
  }).catch((error: unknown) => {
    console.error(
      `agent cap sync failed for ${userId}: ${
        error instanceof Error ? error.message : error
      }`,
    )
  })
  await flushPendingPluginConfigs(db, userId)
  const resolved = resolveWatchdogConfig(db, userId)
  await syncWatchdogConfig(
    userId,
    watchdogContainerPayload(resolved.value),
  ).catch((error: unknown) => {
    console.error(
      `watchdog config sync failed for ${userId}: ${
        error instanceof Error ? error.message : error
      }`,
    )
  })
  // Team mode: the shared OpenCode provider auth rides every (re)create, so
  // a merged provider is usable the moment the desktop is back.
  try {
    await pushTeamOpencodeAuth(db, userId, hub)
  } catch (error: unknown) {
    console.error(
      `opencode auth sync failed for ${userId}: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }
})
// Background pumps for already-running desktops so plugin hooks, media
// capture, and other event observers work with no dashboard attached.
for (const row of db.activeDesktops(0)) hub.ensurePump(row.userId)
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

convertGuardCrons(db, hub)
startCronScheduler(db, hub)
startStuckWatch(db, hub)
startBackupScheduler(db)
startStatsSampler(db, hub)
void reconnectDesktopNetworks()

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
        // The busy probe takes seconds: the user may have come back during
        // it, so re-read lastActive instead of trusting the query snapshot.
        // A stop racing returning requests wedged the desktop in "starting"
        // for minutes (2026-10-23).
        const fresh = db.desktop(row.userId)
        if (fresh && Date.now() - fresh.lastActiveAt < 60_000) continue
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
