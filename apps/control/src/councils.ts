import type { Db, User } from "@open-bot/db"
import { desktopPhase, endpoint } from "./docker"
import type { EventHub } from "./events"
import { cleanupDeletedThread } from "./threads"

export const COUNCIL_NAME_MAX = 48
export const ROLE_MAX = 80

export type CouncilView = {
  id: string
  name: string
  createdAt: number
}

export type CouncilMemberView = {
  sessionId: string
  role: string
  title: string
  createdAt: number
}

export type CouncilDetail = CouncilView & { members: CouncilMemberView[] }

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Council names become slugs in the agent's reply marker
// (open-bot://council/<name>) and markdown destinations break on spaces, so
// names normalize to lowercase kebab: spaces/underscores fold to dashes,
// anything else invalid is stripped.
export function sanitizeCouncilName(raw: unknown): string | null {
  if (raw == null) return ""
  if (typeof raw !== "string") return null
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COUNCIL_NAME_MAX)
    .replace(/-+$/g, "")
}

// The member's job in the council, shown in the viewer rail ("Reviewer").
export function sanitizeRole(raw: unknown): string | null {
  if (raw == null) return ""
  if (typeof raw !== "string") return null
  const stripped = Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 32 || code === 127 ? " " : ch
    })
    .join("")
  return stripped.replace(/\s+/g, " ").trim().slice(0, ROLE_MAX)
}

export function councilView(row: {
  id: string
  name: string
  createdAt: number
}): CouncilView {
  return { id: row.id, name: row.name, createdAt: row.createdAt }
}

// Case-insensitive find-or-create used by POST /api/threads (ob-thread
// --council): the agent names a council at member creation and should not
// need a create call first.
export function findOrCreateCouncil(
  db: Db,
  userId: string,
  name: string,
): CouncilView {
  const existing = db.councilByName(userId, name)
  if (existing) return councilView(existing)
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    createdAt: Date.now(),
  }
  db.createCouncil(row)
  return councilView(row)
}

export function isCouncilPath(pathname: string): boolean {
  return pathname === "/api/councils" || pathname.startsWith("/api/councils/")
}

export function handleCouncils(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
): Response | Promise<Response> | null {
  if (url.pathname === "/api/councils" && req.method === "GET") {
    const counts = new Map<string, number>()
    for (const row of db.allCouncilMembers(user.id))
      counts.set(row.councilId, (counts.get(row.councilId) ?? 0) + 1)
    return json({
      councils: db.councils(user.id).map((row) => ({
        ...councilView(row),
        members: counts.get(row.id) ?? 0,
      })),
    })
  }

  const match = url.pathname.match(/^\/api\/councils\/([^/]+)$/)
  if (!match) return null
  const name = decodeURIComponent(match[1] ?? "")
  if (req.method === "GET") return councilDetail(db, user, name)
  if (req.method === "DELETE") return closeCouncil(db, user, hub, name)
  return null
}

// One call for the viewer pane: membership from the control plane plus the
// live session titles from opencode. A down desktop degrades to empty titles
// — the pane still opens and the transcript fetch reports the real error.
async function councilDetail(
  db: Db,
  user: User,
  name: string,
): Promise<Response> {
  const council = db.councilByName(user.id, name)
  if (!council) return json({ error: "not found" }, 404)
  const rows = db.councilMembers(user.id, council.id)
  let titles = new Map<string, string>()
  try {
    if (rows.length > 0) {
      const phase = await desktopPhase(user.id)
      if (phase === "running") {
        const base = await endpoint(user.id, "opencode", 4096)
        const desktop = db.desktop(user.id)
        const res = await fetch(`${base}/session`, {
          headers: desktop
            ? {
                authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
              }
            : undefined,
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null)
        const body = (await res?.json().catch(() => null)) as unknown
        if (res?.ok && Array.isArray(body)) {
          titles = new Map(
            body
              .map((item) => item as { id?: unknown; title?: unknown })
              .filter((item) => typeof item.id === "string")
              .map((item) => [
                item.id as string,
                typeof item.title === "string"
                  ? item.title.replace(/^worker:/, "")
                  : "",
              ]),
          )
        }
      }
    }
  } catch {
    // keep the empty map; titles are cosmetic
  }
  const detail: CouncilDetail = {
    ...councilView(council),
    members: rows.map((row) => ({
      sessionId: row.sessionId,
      role: row.role,
      title: titles.get(row.sessionId) ?? "",
      createdAt: row.createdAt,
    })),
  }
  return json(detail)
}

// Closes a council: deletes every member's hidden worker: session through the
// same path as DELETE /api/threads, runs the shared thread cleanup, then drops
// the council row once the last member is gone. Sessions that fail to delete
// are reported skipped and stay tracked under the council for a retry.
async function closeCouncil(
  db: Db,
  user: User,
  hub: EventHub,
  name: string,
): Promise<Response> {
  const council = db.councilByName(user.id, name)
  if (!council) return json({ error: "not found" }, 404)
  const rows = db.councilMembers(user.id, council.id)

  const desktop = db.desktop(user.id)
  if (!desktop) return json({ error: "desktop not found" }, 409)
  const phase = await desktopPhase(user.id)
  if (phase !== "running") return json({ error: "desktop is not running" }, 409)
  let base: string
  try {
    base = await endpoint(user.id, "opencode", 4096)
  } catch {
    return json({ error: "desktop is not reachable" }, 502)
  }
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
  }

  const deleted: string[] = []
  const skipped: { sessionId: string; reason: string }[] = []
  for (const row of rows) {
    const del = await fetch(
      `${base}/session/${encodeURIComponent(row.sessionId)}`,
      { method: "DELETE", headers, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null)
    if (!del || !del.ok) {
      skipped.push({ sessionId: row.sessionId, reason: "delete failed" })
      continue
    }
    try {
      await cleanupDeletedThread(db, user.id, row.sessionId)
    } catch {
      // The session is gone; leftover control-plane rows are harmless.
    }
    deleted.push(row.sessionId)
  }
  if (skipped.length === 0) db.deleteCouncil(council.id, user.id)
  hub.emit(user.id, { type: "councils.changed" })
  hub.emit(user.id, { type: "threads.changed" })
  return json({ deleted, skipped })
}
