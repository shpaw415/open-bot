import type { Db } from "@open-bot/db"
import { endpoint } from "./docker"
import type { EventHub, HubEvent } from "./events"

// Open-bot desktops are headless: the seed opencode config allows every tool
// except a small denylist, so a live `permission.asked` means config or
// version drift — and nobody can answer it. Unanswered, the tool call hangs
// until the stuck watchdog kills the turn (field 2026-11-08: the agent told
// the user "add the authorization" for a deny that no dialog could lift, and
// burned the turn). Fail fast instead: reject with corrective feedback the
// model sees immediately (opencode turns a rejected-with-message ask into a
// tool error carrying the text), and toast the dashboard so the user knows
// the ask happened and where. Never auto-allow — an ask is by definition
// something the configured policy did not already permit.

const REPLY_TIMEOUT_MS = 10_000
const REJECT_MESSAGE =
  "open-bot: this session is headless and cannot answer permission requests. " +
  "The desktop config allows all tools except a small denylist (raw CDP/VNC " +
  "browser access); a permission ask means the tool is outside that policy. " +
  "Do not retry the call. State what you were blocked on in your reply so the " +
  "user can adjust the config."

type AskedEvent = {
  id?: unknown
  sessionID?: unknown
  permission?: unknown
  patterns?: unknown
}

export function isPermissionAsked(event: HubEvent): AskedEvent | null {
  if (event.type !== "permission.asked") return null
  const props = (event.properties ?? {}) as AskedEvent
  if (typeof props.id !== "string" || !props.id.startsWith("per_")) return null
  return props
}

/**
 * Reply to one pending opencode permission request with a rejection whose
 * message the model receives as tool feedback. Best-effort: a lost reply just
 * leaves the original hang to the stuck watchdog.
 */
export async function rejectPermissionAsk(
  db: Db,
  hub: EventHub | undefined,
  userId: string,
  asked: AskedEvent,
  resolveBase: (userId: string) => Promise<string> = (id) =>
    endpoint(id, "opencode", 4096),
): Promise<boolean> {
  const desktop = db.desktop(userId)
  if (!desktop) return false
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
    "content-type": "application/json",
  }
  const base = await resolveBase(userId)
  const reply = await fetch(`${base}/permission/${asked.id}/reply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reply: "reject", message: REJECT_MESSAGE }),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  }).catch(() => null)
  const ok = reply?.ok ?? false
  const sessionId =
    typeof asked.sessionID === "string" ? asked.sessionID : undefined
  const permission =
    typeof asked.permission === "string" ? asked.permission : "tool"
  const patterns = Array.isArray(asked.patterns)
    ? asked.patterns.filter((item): item is string => typeof item === "string")
    : []
  hub?.emit(userId, {
    type: "permission.notice",
    properties: {
      title: ok
        ? "Agent permission request auto-rejected"
        : "Agent permission request went unanswered",
      body:
        `The agent asked to use "${permission}"` +
        (patterns.length ? ` (${patterns.slice(0, 2).join(", ")})` : "") +
        ". Headless sessions reject permission asks with feedback — check the " +
        "desktop's opencode config if this tool should be allowed." +
        (ok ? "" : " The automatic rejection failed; the turn may hang."),
      sessionId,
    },
  })
  return ok
}

/** EventHub observer: reject every permission ask as it fires. */
export function dispatchPermissionAsks(
  db: Db,
  hub: EventHub,
  userId: string,
  event: HubEvent,
  resolveBase?: (userId: string) => Promise<string>,
) {
  const asked = isPermissionAsked(event)
  if (!asked) return
  void rejectPermissionAsk(db, hub, userId, asked, resolveBase).catch(
    () => undefined,
  )
}
