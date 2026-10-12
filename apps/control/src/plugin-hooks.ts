import type { Db } from "@open-bot/db"
import type { PluginHookEvent, PluginManifest } from "@open-bot/plugin-kit"
import { createSession } from "./cron"
import { endpoint } from "./docker"
import { applyThinkingEffort } from "./effort"

// Plugin event hooks: manifest hooks[] entries run their message as a prompt
// in a hidden worker session whenever the mapped upstream event fires.
//
// Loop guards (a hook that writes messages must not feed itself):
// - sessions the dispatcher spawned (worker: titles) never re-trigger hooks
// - cron-run: sessions are ignored too
// - per-plugin daily cap + per-event concurrency cap

const DAILY_CAP = 20
const MAX_CONCURRENT_PER_EVENT = 2
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PROMPT_CHARS = 8000

const UPSTREAM_EVENT: Record<PluginHookEvent, string> = {
  "session.idle": "session.idle",
  "thread.created": "session.created",
}

const runsByPlugin = new Map<string, number[]>()
const spawnedSessions = new Set<string>()
const inFlight = new Map<string, number>()

function dailyAllowed(key: string): boolean {
  const now = Date.now()
  const recent = (runsByPlugin.get(key) ?? []).filter(
    (time) => now - time < DAY_MS,
  )
  runsByPlugin.set(key, recent)
  if (recent.length >= DAILY_CAP) return false
  recent.push(now)
  return true
}

export function dispatchPluginHooks(
  db: Db,
  userId: string,
  event: { type?: unknown; properties?: unknown },
) {
  const type = typeof event.type === "string" ? event.type : ""
  if (type !== "session.idle" && type !== "session.created") return
  const props = event.properties as
    | { sessionID?: unknown; info?: { id?: unknown; title?: unknown } }
    | undefined
  const sessionId =
    typeof props?.sessionID === "string" && props.sessionID
      ? props.sessionID
      : typeof props?.info?.id === "string" && props.info.id
        ? props.info.id
        : null
  if (sessionId && spawnedSessions.has(sessionId)) return
  const title = typeof props?.info?.title === "string" ? props.info.title : ""
  if (title.startsWith("worker:") || title.startsWith("cron-run:")) return

  const payload = JSON.stringify(event.properties ?? {})
  for (const row of db.installedPlugins(userId)) {
    if (!row.enabled) continue
    const manifest = row.manifest as PluginManifest
    for (const hook of manifest.hooks ?? []) {
      if (UPSTREAM_EVENT[hook.event] !== type) continue
      const flightKey = `${userId}:${row.pluginId}:${hook.event}`
      if ((inFlight.get(flightKey) ?? 0) >= MAX_CONCURRENT_PER_EVENT) continue
      if (!dailyAllowed(`${userId}:${row.pluginId}`)) {
        console.error(
          `plugin ${row.pluginId} hook daily cap (${DAILY_CAP}) reached — skipping ${hook.event}`,
        )
        continue
      }
      void runHook(
        db,
        userId,
        row.pluginId,
        hook.event,
        flightKey,
        `${hook.message}\n\nEvent: ${hook.event}\nPayload: ${payload}`.slice(
          0,
          MAX_PROMPT_CHARS,
        ),
      )
    }
  }
}

async function runHook(
  db: Db,
  userId: string,
  pluginId: string,
  hookEvent: PluginHookEvent,
  flightKey: string,
  prompt: string,
) {
  inFlight.set(flightKey, (inFlight.get(flightKey) ?? 0) + 1)
  try {
    const desktop = db.desktop(userId)
    if (!desktop) return
    const headers = {
      authorization: `Basic ${Buffer.from(
        `opencode:${desktop.opencodePassword}`,
      ).toString("base64")}`,
      "content-type": "application/json",
    }
    const base = await endpoint(userId, "opencode", 4096)
    const sessionId = await createSession(
      base,
      headers,
      `worker: plugin-${pluginId} ${hookEvent}`,
    )
    spawnedSessions.add(sessionId)
    if (spawnedSessions.size > 1000) spawnedSessions.clear()
    const hookBody: Record<string, unknown> = {
      parts: [{ type: "text", text: prompt }],
    }
    await applyThinkingEffort(db, userId, hookBody)
    const response = await fetch(`${base}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers,
      body: JSON.stringify(hookBody),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      console.error(
        `plugin ${pluginId} hook prompt failed (${response.status})`,
      )
    }
  } catch (error) {
    console.error(
      `plugin ${pluginId} hook failed: ${
        error instanceof Error ? error.message : error
      }`,
    )
  } finally {
    inFlight.set(flightKey, Math.max(0, (inFlight.get(flightKey) ?? 1) - 1))
  }
}
