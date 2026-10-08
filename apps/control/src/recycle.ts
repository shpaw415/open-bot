import { existsSync } from "node:fs"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import { endpoint, isRunning, startDesktop, stopDesktop } from "./docker"
import { dataDir, names } from "./env"
import { resolveDesktopProviders } from "./key-vault"

if (!existsSync("/.dockerenv") && process.env.OPEN_BOT_IN_DOCKER !== "1") {
  console.error("recycle runs inside the open-bot container")
  process.exit(1)
}

const db = openDatabase(join(dataDir, "open-bot.sqlite"))

function busyIds(status: unknown): string[] {
  if (!status || typeof status !== "object") return []
  return Object.entries(status as Record<string, { type?: string }>).flatMap(
    ([id, row]) => (row?.type && row.type !== "idle" ? [id] : []),
  )
}

let restarted = 0
let failed = 0
let skipped = 0
for (const userId of db.desktopUserIds()) {
  const desktop = db.desktop(userId)
  if (!desktop) continue
  if (!(await isRunning(names(userId).opencode))) continue
  try {
    const base = await endpoint(userId, "opencode", 4096)
    const status = (await (
      await fetch(`${base}/session/status`, {
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(10_000),
      })
    ).json()) as unknown
    if (busyIds(status).length > 0) {
      skipped += 1
      console.log(`busy ${names(userId).opencode}, skipped until idle`)
      continue
    }
  } catch {
    // status unreadable; treat as idle and continue the restart
  }
  console.log(`restarting ${names(userId).opencode}`)
  db.touchDesktop(userId)
  try {
    await stopDesktop(userId)
    const auth = resolveDesktopProviders(db, userId)
    await startDesktop(
      userId,
      desktop,
      auth.viking,
      auth.image,
      auth.system1,
      auth.video,
      auth.model3d,
      auth.chatKeys,
    )
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

if (restarted === 0 && failed === 0 && skipped === 0)
  console.log("no running desktops")
if (skipped > 0)
  console.log("busy desktops keep the old image until their next idle restart")
if (failed > 0) process.exit(1)
