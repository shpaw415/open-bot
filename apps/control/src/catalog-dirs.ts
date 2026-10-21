import type { CatalogKind, Db, User } from "@open-bot/db"
import { MCP_NAME_PATTERN, SLUG_PATTERN } from "@open-bot/plugin-kit"
import type { EventHub } from "./events"
import { sanitizeDirName } from "./thread-dirs"

// Labeled directories for the skills/MCP catalog: user-scoped organization
// only. Membership never changes what a persona allowlist enforces — the
// picker expands a directory into plain names on save.
export const CATALOG_DIR_MAX = 32
export const CATALOG_ASSIGN_MAX = 256

export type CatalogDirView = {
  id: string
  kind: CatalogKind
  label: string
  position: number
}

export function catalogKind(input: unknown): CatalogKind | null {
  return input === "skill" || input === "mcp" ? input : null
}

// Skill names are slugs; MCP server names allow dots too. Both reject every
// glob metacharacter — the same validation the persona allowlists run, so a
// directory can always be expanded into an allowlist verbatim.
function nameError(kind: CatalogKind, name: string): string {
  const ok =
    kind === "skill" ? SLUG_PATTERN.test(name) : MCP_NAME_PATTERN.test(name)
  if (ok) return ""
  return kind === "skill"
    ? `"${name}" is not a skill name — use lowercase letters, digits, hyphens, or underscores`
    : `"${name}" is not an MCP server name — use letters, digits, dots, hyphens, or underscores`
}

// Validates a batch of names for assignment: strings matching the kind's
// pattern, capped, trimmed, deduped. Rejects instead of sanitizing.
export function parseNameBatch(
  input: unknown,
  kind: CatalogKind,
): { names: string[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "names must be a list" }
  if (input.length > CATALOG_ASSIGN_MAX)
    return { error: `names is limited to ${CATALOG_ASSIGN_MAX} entries` }
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== "string") return { error: "names must be a list" }
    const name = raw.trim()
    if (!name) return { error: "names must not be empty" }
    const invalid = nameError(kind, name)
    if (invalid) return { error: invalid }
    if (!out.includes(name)) out.push(name)
  }
  return { names: out }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function catalogDirView(row: {
  id: string
  kind: string
  label: string
  position: number
}): CatalogDirView {
  return {
    id: row.id,
    kind: row.kind as CatalogKind,
    label: row.label,
    position: row.position,
  }
}

export function handleCatalogDirs(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
): Response | Promise<Response> | null {
  if (url.pathname === "/api/catalog/dirs" && req.method === "GET") {
    const kind = catalogKind(url.searchParams.get("kind"))
    if (!kind) return json({ error: "kind must be skill or mcp" }, 400)
    return json({
      dirs: db.catalogDirs(user.id, kind).map(catalogDirView),
      items: db
        .catalogDirItems(user.id, kind)
        .map((row) => ({ name: row.name, dirId: row.dirId })),
    })
  }

  if (url.pathname === "/api/catalog/dirs" && req.method === "POST")
    return createCatalogDir(req, db, user, hub)

  if (url.pathname === "/api/catalog/dirs/reorder" && req.method === "PUT")
    return reorderCatalogDirs(req, db, user, hub)

  if (url.pathname === "/api/catalog/dirs/assign" && req.method === "PUT")
    return assignCatalogDir(req, db, user, hub)

  const match = url.pathname.match(/^\/api\/catalog\/dirs\/([^/]+)$/)
  if (!match) return null
  const id = decodeURIComponent(match[1] ?? "")
  if (req.method === "PUT") return renameCatalogDir(req, db, user, id, hub)
  if (req.method === "DELETE") return removeCatalogDir(db, user, id, hub)
  return null
}

async function createCatalogDir(
  req: Request,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    kind?: unknown
    label?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const kind = catalogKind(body.kind)
  if (!kind) return json({ error: "kind must be skill or mcp" }, 400)
  const label = sanitizeDirName(body.label)
  if (label === null) return json({ error: "label must be a string" }, 400)
  if (!label) return json({ error: "label is required" }, 400)
  const dirs = db.catalogDirs(user.id, kind)
  if (dirs.length >= CATALOG_DIR_MAX)
    return json(
      { error: `limited to ${CATALOG_DIR_MAX} directories per kind` },
      409,
    )
  if (dirs.some((row) => row.label.toLowerCase() === label.toLowerCase()))
    return json({ error: "a directory with that label already exists" }, 409)
  // New directories sort last: max position + 1.
  const position =
    dirs.reduce((max, row) => Math.max(max, row.position), -1) + 1
  const row = {
    id: crypto.randomUUID(),
    userId: user.id,
    kind,
    label,
    position,
    createdAt: Date.now(),
  }
  db.createCatalogDir(row)
  hub.emit(user.id, { type: "catalog.changed" })
  return json(catalogDirView(row), 201)
}

async function renameCatalogDir(
  req: Request,
  db: Db,
  user: User,
  id: string,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    label?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const current = db.catalogDirById(id, user.id)
  if (!current) return json({ error: "not found" }, 404)
  const label = sanitizeDirName(body.label ?? current.label)
  if (label === null) return json({ error: "label must be a string" }, 400)
  if (!label) return json({ error: "label is required" }, 400)
  const taken = db
    .catalogDirs(user.id, current.kind as CatalogKind)
    .some(
      (row) => row.id !== id && row.label.toLowerCase() === label.toLowerCase(),
    )
  if (taken)
    return json({ error: "a directory with that label already exists" }, 409)
  const saved = db.renameCatalogDir(id, user.id, label)
  if (!saved) return json({ error: "not found" }, 404)
  hub.emit(user.id, { type: "catalog.changed" })
  return json(catalogDirView(saved))
}

function removeCatalogDir(
  db: Db,
  user: User,
  id: string,
  hub: EventHub,
): Response {
  if (!db.deleteCatalogDir(id, user.id))
    return json({ error: "not found" }, 404)
  hub.emit(user.id, { type: "catalog.changed" })
  return json({ ok: true })
}

async function reorderCatalogDirs(
  req: Request,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    kind?: unknown
    ids?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const kind = catalogKind(body.kind)
  if (!kind) return json({ error: "kind must be skill or mcp" }, 400)
  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string"))
    return json({ error: "ids must be a list of directory ids" }, 400)
  db.reorderCatalogDirs(user.id, kind, body.ids as string[])
  hub.emit(user.id, { type: "catalog.changed" })
  return json({ ok: true })
}

async function assignCatalogDir(
  req: Request,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    kind?: unknown
    names?: unknown
    dirId?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const kind = catalogKind(body.kind)
  if (!kind) return json({ error: "kind must be skill or mcp" }, 400)
  const parsed = parseNameBatch(body.names, kind)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  if (parsed.names.length === 0)
    return json({ error: "names is required" }, 400)
  let dirId: string | null = null
  if (body.dirId != null) {
    if (typeof body.dirId !== "string")
      return json({ error: "dirId must be a string or null" }, 400)
    const dir = db.catalogDirById(body.dirId, user.id)
    if (!dir || dir.kind !== kind)
      return json({ error: "unknown directory" }, 400)
    dirId = body.dirId
  }
  for (const name of parsed.names)
    db.setCatalogDirItem(user.id, kind, name, dirId)
  hub.emit(user.id, { type: "catalog.changed" })
  return json({ ok: true, names: parsed.names, dirId })
}
