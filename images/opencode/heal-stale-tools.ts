#!/usr/bin/env bun
// Heals tool parts frozen in "running" by a killed turn (desktop recycle,
// opencode restart). Runs at container boot, before the opencode server
// starts: nothing can legitimately be mid-tool while the server is down, so
// every running tool part in the database is a corpse. Flips them to "error"
// so the dashboard stops showing an endless spinner and the stuck-command
// watchdog can never mistake them for a live hang. Prints one JSON summary
// line on success.
import { Database } from "bun:sqlite"

export const HEAL_REASON = "interrupted by a desktop restart"

// Returns the healed JSON string, or null when the part is not a running
// tool (the caller parses before calling, so a malformed part stays null).
export function healToolPart(
  data: unknown,
  at: number,
  reason: string = HEAL_REASON,
): string | null {
  if (!data || typeof data !== "object") return null
  const part = data as {
    type?: unknown
    state?: {
      status?: unknown
      error?: unknown
      time?: Record<string, unknown>
    }
  }
  if (part.type !== "tool") return null
  const state = part.state
  if (!state || state.status !== "running") return null
  state.status = "error"
  if (state.error === undefined || state.error === null || state.error === "")
    state.error = reason
  if (
    state.time &&
    typeof state.time === "object" &&
    state.time.end === undefined
  )
    state.time.end = at
  return JSON.stringify(data)
}

export function healDatabase(path: string, at = Date.now()): number {
  const db = new Database(path)
  try {
    const rows = db
      .query(
        'SELECT id, data FROM part WHERE data LIKE \'%"type":"tool"%\' AND data LIKE \'%"status":"running"%\'',
      )
      .all() as { id: string; data: string }[]
    let healed = 0
    const update = db.query(
      "UPDATE part SET data = ?, time_updated = ? WHERE id = ?",
    )
    db.transaction(() => {
      for (const row of rows) {
        let parsed: unknown
        try {
          parsed = JSON.parse(row.data)
        } catch {
          continue
        }
        const next = healToolPart(parsed, at)
        if (next === null) continue
        update.run(next, at, row.id)
        healed += 1
      }
    })()
    return healed
  } finally {
    db.close()
  }
}

if (import.meta.main) {
  const dbPath =
    process.argv[2] ??
    `${process.env.HOME ?? "/home/agent"}/.local/share/opencode/opencode.db`
  if (await Bun.file(dbPath).exists()) {
    try {
      const healed = healDatabase(dbPath)
      console.log(`{"at":${Date.now()},"healed":${healed}}`)
    } catch (error) {
      console.error(
        `heal-stale-tools failed: ${error instanceof Error ? error.message : error}`,
      )
      process.exit(1)
    }
  }
}
