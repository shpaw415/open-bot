import { createHash } from "node:crypto"
import type {
  Db,
  Improvement,
  ImprovementKind,
  ImprovementStatus,
  ImprovementSurface,
  User,
} from "@open-bot/db"

export const NEW_ROW_LIMIT = 8
export const HOUR_MS = 60 * 60 * 1000
export const TITLE_MAX = 120
export const DETAIL_MAX = 4000
export const NOTE_MAX = 2000

export const kinds = ["bug", "friction", "feature"] as const
export const surfaces = [
  "chat",
  "desktop",
  "nav",
  "cron",
  "persona",
  "config",
  "other",
] as const
export const statuses = ["open", "done", "wontfix"] as const

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function stripSecrets(value: string) {
  return value
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk)-[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]\s*(?!bearer\b)\S+/gi,
      "$1=[redacted]",
    )
}

export function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
}

export function improvementFingerprint(
  kind: ImprovementKind,
  surface: ImprovementSurface,
  title: string,
) {
  return createHash("sha256")
    .update(`${kind}\0${surface}\0${normalizeTitle(title)}`)
    .digest("hex")
}

function isKind(value: string): value is ImprovementKind {
  return (kinds as readonly string[]).includes(value)
}

function isSurface(value: string): value is ImprovementSurface {
  return (surfaces as readonly string[]).includes(value)
}

export function isStatus(value: string): value is ImprovementStatus {
  return (statuses as readonly string[]).includes(value)
}

export function parseImprovementInput(body: {
  kind?: unknown
  surface?: unknown
  title?: unknown
  detail?: unknown
  sessionId?: unknown
}):
  | {
      kind: ImprovementKind
      surface: ImprovementSurface
      title: string
      detail: string
      sessionId: string | null
    }
  | { error: string } {
  const kind = typeof body.kind === "string" ? body.kind : ""
  const surface = typeof body.surface === "string" ? body.surface : ""
  if (!isKind(kind)) return { error: "kind must be bug, friction, or feature" }
  if (!isSurface(surface))
    return {
      error:
        "surface must be chat, desktop, nav, cron, persona, config, or other",
    }
  if (typeof body.title !== "string" || typeof body.detail !== "string")
    return { error: "title and detail are required" }
  const title = stripSecrets(body.title).trim().replace(/\s+/g, " ")
  const detail = stripSecrets(body.detail).trim()
  if (!title || title.length > TITLE_MAX)
    return { error: `title must be 1–${TITLE_MAX} characters` }
  if (!detail || detail.length > DETAIL_MAX)
    return { error: `detail must be 1–${DETAIL_MAX} characters` }
  let sessionId: string | null = null
  if (body.sessionId != null && body.sessionId !== "") {
    if (typeof body.sessionId !== "string")
      return { error: "sessionId must be a string" }
    const session = body.sessionId.trim()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session))
      return { error: "sessionId must be 1–128 letters, numbers, _ or -" }
    sessionId = session
  }
  return { kind, surface, title, detail, sessionId }
}

export function fileImprovement(
  db: Db,
  user: User,
  input: {
    kind: ImprovementKind
    surface: ImprovementSurface
    title: string
    detail: string
    sessionId: string | null
  },
  now = Date.now(),
):
  | { error: string; status: number }
  | { id: string; duplicate: boolean; hits: number } {
  const fingerprint = improvementFingerprint(
    input.kind,
    input.surface,
    input.title,
  )
  const open = db.openImprovementByFingerprint(fingerprint)
  if (open) {
    const detail =
      input.detail.length > open.detail.length ? input.detail : open.detail
    const sessionId = input.sessionId ?? open.sessionId
    db.bumpImprovement(open.id, {
      hits: open.hits + 1,
      lastSeenAt: now,
      detail,
      sessionId,
    })
    return { id: open.id, duplicate: true, hits: open.hits + 1 }
  }
  if (db.improvementsSince(user.id, now - HOUR_MS) >= NEW_ROW_LIMIT)
    return { error: "too many new reports this hour", status: 429 }
  const row: Improvement = {
    id: crypto.randomUUID(),
    userId: user.id,
    sessionId: input.sessionId,
    kind: input.kind,
    surface: input.surface,
    title: input.title,
    detail: input.detail,
    fingerprint,
    hits: 1,
    status: "open",
    note: null,
    createdAt: now,
    lastSeenAt: now,
    resolvedAt: null,
  }
  db.insertImprovement(row)
  return { id: row.id, duplicate: false, hits: 1 }
}

export async function handleImprovementPost(req: Request, db: Db, user: User) {
  if (req.method !== "POST") return json({ error: "not found" }, 404)
  const body = (await req.json().catch(() => null)) as {
    kind?: unknown
    surface?: unknown
    title?: unknown
    detail?: unknown
    sessionId?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const parsed = parseImprovementInput(body)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  const filed = fileImprovement(db, user, parsed)
  if ("error" in filed) return json({ error: filed.error }, filed.status)
  return json(filed)
}

export async function handleAdminImprovements(req: Request, url: URL, db: Db) {
  if (url.pathname === "/api/admin/improvements" && req.method === "GET") {
    const status = url.searchParams.get("status") ?? "open"
    if (status !== "all" && !isStatus(status))
      return json({ error: "status must be open, done, wontfix, or all" }, 400)
    return json({
      improvements: db.listImprovements(status === "all" ? undefined : status),
    })
  }
  const match = url.pathname.match(/^\/api\/admin\/improvements\/([^/]+)$/)
  if (!match || req.method !== "PATCH") return null
  const id = decodeURIComponent(match[1] ?? "")
  const body = (await req.json().catch(() => null)) as {
    status?: unknown
    note?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const status = typeof body.status === "string" ? body.status : ""
  if (!isStatus(status))
    return json({ error: "status must be open, done, or wontfix" }, 400)
  let note: string | null | undefined
  if (body.note !== undefined) {
    if (typeof body.note !== "string")
      return json({ error: "note must be a string" }, 400)
    const trimmed = body.note.trim()
    if (trimmed.length > NOTE_MAX)
      return json({ error: `note must be at most ${NOTE_MAX} characters` }, 400)
    note = trimmed || null
  }
  const row = db.setImprovementStatus(id, status, note)
  if (!row) return json({ error: "report not found" }, 404)
  return json(row)
}
