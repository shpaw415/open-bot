import { existsSync } from "node:fs"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import { isRunning, startDesktop, stopDesktop } from "./docker"
import { dataDir, names } from "./env"

if (!existsSync("/.dockerenv") && process.env.OPEN_BOT_IN_DOCKER !== "1") {
  console.error("recycle runs inside the open-bot container")
  process.exit(1)
}

const db = openDatabase(join(dataDir, "open-bot.sqlite"))
const viking = db.getVikingProvider()

let restarted = 0
let failed = 0
for (const userId of db.desktopUserIds()) {
  const desktop = db.desktop(userId)
  if (!desktop) continue
  if (!(await isRunning(names(userId).opencode))) continue
  console.log(`restarting ${names(userId).opencode}`)
  db.touchDesktop(userId)
  try {
    await stopDesktop(userId)
    await startDesktop(userId, desktop, viking, db.getImageProvider(userId))
    db.touchDesktop(userId)
    restarted += 1
    console.log(`restarted ${names(userId).opencode}`)
  } catch (error) {
    failed += 1
    console.error(
      `failed ${names(userId).opencode}: ${error instanceof Error ? error.message : error}`,
    )
  }
}

if (restarted === 0 && failed === 0) console.log("no running desktops")
if (failed > 0) process.exit(1)
