import type { Db } from "@open-bot/db"
import { startDesktop } from "./docker"
import { resolveDesktopProviders } from "./key-vault"

// One idempotent desktop wake for surfaces that may reach a sleeping desktop
// out of band: public webhook delivery and dashboard plugin-page visits.
// startDesktop dedupes concurrent callers and skips containers that are
// already up, so repeated hits while a boot is in flight share one job.
// Structured HttpErrors (images missing, capacity, viking models) propagate
// to the caller. Returns false when the user has no desktop row at all.
export async function wakeDesktop(db: Db, userId: string): Promise<boolean> {
  const desktop = db.desktop(userId)
  if (!desktop) return false
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
  return true
}
