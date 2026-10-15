import type { Db, User } from "@open-bot/db"
import type { EventHub } from "./events"

export const DIR_NAME_MAX = 48

export type ThreadDirView = {
  id: string
  name: string
  createdAt: number
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Trims and normalizes a folder label the way thread titles are sanitized:
// control characters become spaces, inner whitespace collapses.
export function sanitizeDirName(raw: unknown): string | null {
  if (raw == null) return ""
  if (typeof raw !== "string") return null
  const stripped = Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 32 || code === 127 ? " " : ch
    })
    .join("")
  return stripped.replace(/\s+/g, " ").trim().slice(0, DIR_NAME_MAX)
}

export function dirView(row: {
  id: string
  name: string
  createdAt: number
}): ThreadDirView {
  return { id: row.id, name: row.name, createdAt: row.createdAt }
}

function nameTaken(
  db: Db,
  userId: string,
  name: string,
  exceptId?: string,
): boolean {
  const wanted = name.toLowerCase()
  return db
    .threadDirs(userId)
    .some((row) => row.id !== exceptId && row.name.toLowerCase() === wanted)
}

// Case-insensitive find-or-create used by POST /api/threads (ob-thread --dir):
// agents name a folder at thread creation and should not need a create call.
export function findOrCreateThreadDir(
  db: Db,
  userId: string,
  name: string,
): ThreadDirView {
  const existing = db.threadDirByName(userId, name)
  if (existing) return dirView(existing)
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    createdAt: Date.now(),
  }
  db.createThreadDir(row)
  return dirView(row)
}

export function handleThreadDirs(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
): Response | Promise<Response> | null {
  if (url.pathname === "/api/thread-dirs" && req.method === "GET")
    return json({ dirs: db.threadDirs(user.id).map(dirView) })

  if (url.pathname === "/api/thread-dirs/assignments" && req.method === "GET")
    return json({
      threads: db
        .threadDirAssignments(user.id)
        .map((row) => ({ sessionId: row.sessionId, dirId: row.dirId })),
    })

  if (url.pathname === "/api/thread-dirs" && req.method === "POST")
    return createThreadDir(req, db, user, hub)

  if (url.pathname === "/api/thread-dirs/assign" && req.method === "PUT")
    return assignThreadDir(req, db, user, hub)

  const match = url.pathname.match(/^\/api\/thread-dirs\/([^/]+)$/)
  if (!match) return null
  const id = decodeURIComponent(match[1] ?? "")
  if (req.method === "PUT") return updateThreadDir(req, db, user, id, hub)
  if (req.method === "DELETE") return removeThreadDir(db, user, id, hub)
  return null
}

async function createThreadDir(
  req: Request,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    name?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const name = sanitizeDirName(body.name)
  if (name === null) return json({ error: "name must be a string" }, 400)
  if (!name) return json({ error: "name is required" }, 400)
  if (nameTaken(db, user.id, name))
    return json({ error: "a folder with that name already exists" }, 409)
  const row = {
    id: crypto.randomUUID(),
    userId: user.id,
    name,
    createdAt: Date.now(),
  }
  db.createThreadDir(row)
  hub.emit(user.id, { type: "threads.changed" })
  return json(dirView(row), 201)
}

async function updateThreadDir(
  req: Request,
  db: Db,
  user: User,
  id: string,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    name?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const current = db.threadDirById(id, user.id)
  if (!current) return json({ error: "not found" }, 404)
  const name = sanitizeDirName(body.name ?? current.name)
  if (name === null) return json({ error: "name must be a string" }, 400)
  if (!name) return json({ error: "name is required" }, 400)
  if (nameTaken(db, user.id, name, id))
    return json({ error: "a folder with that name already exists" }, 409)
  const saved = db.renameThreadDir(id, user.id, name)
  if (!saved) return json({ error: "not found" }, 404)
  hub.emit(user.id, { type: "threads.changed" })
  return json(dirView(saved))
}

function removeThreadDir(
  db: Db,
  user: User,
  id: string,
  hub: EventHub,
): Response {
  if (!db.deleteThreadDir(id, user.id)) return json({ error: "not found" }, 404)
  hub.emit(user.id, { type: "threads.changed" })
  return json({ ok: true })
}

async function assignThreadDir(
  req: Request,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown
    dirId?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  if (typeof body.sessionId !== "string" || !body.sessionId.trim())
    return json({ error: "sessionId is required" }, 400)
  let dirId: string | null = null
  if (body.dirId != null) {
    if (typeof body.dirId !== "string")
      return json({ error: "dirId must be a string or null" }, 400)
    if (!db.threadDirById(body.dirId, user.id))
      return json({ error: "unknown folder" }, 400)
    dirId = body.dirId
  }
  db.setThreadDir(user.id, body.sessionId.trim(), dirId)
  hub.emit(user.id, { type: "threads.changed" })
  return json({ ok: true, sessionId: body.sessionId.trim(), dirId })
}
