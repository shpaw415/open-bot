import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { type AiConfigInput, defineAi } from "@open-bot/ai"
import { openDatabase } from "@open-bot/db"
import { startCronScheduler } from "./cron"
import { desktopPhase, stopDesktop } from "./docker"
import { aiConfigPath, bindHosts, dataDir, idleMinutes, port } from "./env"
import { EventHub } from "./events"
import { hashPassword, randomToken, verifyPassword } from "./passwords"
import { createServer, eventTarget } from "./server"
import { startStuckWatch } from "./stuck"

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

setInterval(() => {
  void (async () => {
    try {
      const before = Date.now() - idleMinutes * 60 * 1000
      for (const row of db.idleDesktops(before)) {
        if ((await desktopPhase(row.userId)) !== "running") continue
        await stopDesktop(row.userId)
      }
    } catch {
      return
    }
  })()
}, 60_000)
