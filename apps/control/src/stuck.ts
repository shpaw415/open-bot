import type { Db } from "@open-bot/db"
import { desktopPhase, endpoint } from "./docker"
import type { EventHub } from "./events"

export const STUCK_TOOL_MS = 90_000
export const STUCK_MESSAGE = "stopped a stuck command, send again."
const SWEEP_MS = 15_000
const COOL_MS = 60_000

const cooled = new Map<string, number>()

type ToolState = { status?: unknown; time?: { start?: unknown } }

export function newestTool(
  messages: unknown,
): { status: string; start: number } | null {
  if (!Array.isArray(messages)) return null
  let best: { status: string; start: number } | null = null
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const parts = (message as { parts?: unknown }).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      const row = part as { type?: unknown; state?: ToolState }
      if (row.type !== "tool") continue
      const status = row.state?.status
      const start = row.state?.time?.start
      if (typeof status !== "string" || typeof start !== "number") continue
      if (!best || start >= best.start) best = { status, start }
    }
  }
  return best
}

export function toolStuck(
  messages: unknown,
  now: number,
  limit = STUCK_TOOL_MS,
): boolean {
  const tool = newestTool(messages)
  return Boolean(tool && tool.status === "running" && now - tool.start >= limit)
}

function busyIds(status: unknown): string[] {
  if (!status || typeof status !== "object") return []
  return Object.entries(status as Record<string, { type?: string }>).flatMap(
    ([id, row]) => (row?.type && row.type !== "idle" ? [id] : []),
  )
}

async function sweepUser(
  db: Db,
  hub: EventHub | undefined,
  userId: string,
  now: number,
) {
  if ((await desktopPhase(userId)) !== "running") return
  const desktop = db.desktop(userId)
  if (!desktop) return
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
  }
  const base = await endpoint(userId, "opencode", 4096)
  const statusRes = await fetch(`${base}/session/status`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!statusRes.ok) return
  for (const sessionId of busyIds(await statusRes.json())) {
    const key = `${userId}:${sessionId}`
    if (now - (cooled.get(key) ?? 0) < COOL_MS) continue
    const messageRes = await fetch(`${base}/session/${sessionId}/message`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (!messageRes.ok) continue
    if (!toolStuck(await messageRes.json(), now)) continue
    cooled.set(key, now)
    const aborted = await fetch(`${base}/session/${sessionId}/abort`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!aborted.ok) continue
    hub?.emit(userId, {
      type: "session.stuck",
      properties: { sessionID: sessionId, message: STUCK_MESSAGE },
    })
  }
}

export async function sweepStuck(db: Db, hub?: EventHub, now = Date.now()) {
  for (const user of db.listUsers()) {
    if (user.disabled) continue
    try {
      await sweepUser(db, hub, user.id, now)
    } catch {
      // desktop may be restarting
    }
  }
}

export function startStuckWatch(db: Db, hub?: EventHub) {
  return setInterval(() => {
    void sweepStuck(db, hub)
  }, SWEEP_MS)
}
