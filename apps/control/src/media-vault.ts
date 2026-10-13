import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Db, MediaAlbum, MediaItem, MediaKind, User } from "@open-bot/db"
import { desktopPhase, endpoint, opencodeExec } from "./docker"
import { dataDir } from "./env"
import { opencodeFileUrl } from "./projects"
import { isStockTitle } from "./thread-title"
import { decodeWorkspaceImage } from "./workspace-image"
import { decodeWorkspaceModel3d } from "./workspace-model3d"
import { decodeWorkspaceVideo } from "./workspace-video"

export const VAULT_DIR = join(dataDir, "media-vault")
export const VAULT_CAP_KEY = "media_vault_cap_mb"
export const DEFAULT_VAULT_CAP_MB = 3072
export const MAX_VAULT_CAP_MB = 102400
const MAX_OTHER_BYTES = 25 * 1024 * 1024
const HOME = "/home/agent"

const OTHER_EXT = new Set([
  "pdf",
  "mp3",
  "wav",
  "ogg",
  "stl",
  "zip",
  "txt",
  "md",
  "csv",
])

const OTHER_MIME: Record<string, string> = {
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  stl: "model/stl",
  zip: "application/zip",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
}

const MEDIA_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "mp4",
  "webm",
  "glb",
])

type Hub = { emit(userId: string, event: { type: string }): void }

export function vaultCapMb(db: Db): number {
  const raw = db.getSetting(VAULT_CAP_KEY)
  if (raw == null) return DEFAULT_VAULT_CAP_MB
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return DEFAULT_VAULT_CAP_MB
  return Math.min(value, MAX_VAULT_CAP_MB)
}

export function isHiddenSessionTitle(title: string) {
  return title.startsWith("cron-run:") || title.startsWith("worker:")
}

export function sanitizeAlbumName(raw: string) {
  let cleaned = ""
  for (const char of raw) {
    const code = char.charCodeAt(0)
    if (code >= 32) cleaned += char
  }
  const name = cleaned.replace(/\s+/g, " ").trim()
  if (!name) return ""
  return name.length > 80 ? name.slice(0, 80).trimEnd() : name
}

export function vaultCaptureFor(stored: string, sessionTitle: string) {
  if (isHiddenSessionTitle(stored) || isHiddenSessionTitle(sessionTitle))
    return null
  return { albumTitle: albumBaseName(stored, sessionTitle) }
}

export function albumBaseName(stored: string, sessionTitle: string) {
  for (const raw of [stored, sessionTitle]) {
    const name = sanitizeAlbumName(raw)
    if (!name || isStockTitle(name) || isHiddenSessionTitle(name)) continue
    return name
  }
  return "Chat"
}

export function vaultSourcePath(raw: string): string | null {
  let path = raw.trim()
  if (!path || path.includes("\0") || path.includes("\\")) return null
  if (path.includes("?") || path.includes("#")) return null
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!path.startsWith(`${HOME}/`)) return null
  const rest = path.slice(HOME.length + 1)
  if (!rest) return null
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (segments.includes(".ssh")) return null
  if (segments[0] === ".config" && segments[1] === "open-bot") return null
  const base = segments[segments.length - 1] ?? ""
  if (!base || base === "auth.json" || base.endsWith("-auth.json")) return null
  return path
}

export function vaultItemUrl(row: Pick<MediaItem, "id" | "name">) {
  return `/api/media/items/${row.id}/${encodeURIComponent(row.name)}`
}

export function isMediaRequest(pathname: string, method: string) {
  if (
    pathname === "/api/media/albums" &&
    (method === "GET" || method === "POST")
  )
    return true
  if (/^\/api\/media\/albums\/[^/]+$/.test(pathname) && method === "DELETE")
    return true
  if (/^\/api\/media\/albums\/[^/]+\/items$/.test(pathname) && method === "GET")
    return true
  if (pathname === "/api/media/items" && method === "POST") return true
  if (/^\/api\/media\/items\/[^/]+$/.test(pathname) && method === "DELETE")
    return true
  if (/^\/api\/media\/items\/[^/]+\/[^/]+$/.test(pathname) && method === "GET")
    return true
  return false
}

function extension(name: string) {
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return ""
  return name.slice(dot + 1).toLowerCase()
}

function binaryPayload(payload: unknown, maxBytes: number): Uint8Array | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as {
    type?: unknown
    content?: unknown
    encoding?: unknown
  }
  if (body.type !== "binary" || body.encoding !== "base64") return null
  if (typeof body.content !== "string" || !body.content) return null
  const content = body.content.replace(/\s/g, "")
  if (content.length > Math.ceil((maxBytes * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null
  const bytes = new Uint8Array(Buffer.from(content, "base64"))
  if (bytes.length === 0 || bytes.length > maxBytes) return null
  return bytes
}

function textPayload(payload: unknown): Uint8Array | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as { type?: unknown; content?: unknown }
  if (body.type !== "text" || typeof body.content !== "string") return null
  const bytes = new TextEncoder().encode(body.content)
  if (bytes.length === 0 || bytes.length > MAX_OTHER_BYTES) return null
  return bytes
}

export function classifyVaultPayload(
  path: string,
  payload: unknown,
): { bytes: Uint8Array; mime: string; kind: MediaKind; name: string } | null {
  const safe = vaultSourcePath(path)
  if (!safe) return null
  const name = safe.slice(safe.lastIndexOf("/") + 1)
  const ext = extension(name)
  const image = decodeWorkspaceImage(payload)
  if (image) return { ...image, kind: "image", name }
  const video = decodeWorkspaceVideo(payload)
  if (video) return { ...video, kind: "video", name }
  const model = decodeWorkspaceModel3d(payload)
  if (model) return { ...model, kind: "model3d", name }
  if (MEDIA_EXT.has(ext)) return null
  if (!OTHER_EXT.has(ext)) return null
  const bytes =
    ext === "txt" || ext === "md" || ext === "csv"
      ? (textPayload(payload) ?? binaryPayload(payload, MAX_OTHER_BYTES))
      : binaryPayload(payload, MAX_OTHER_BYTES)
  if (!bytes) return null
  const mime = OTHER_MIME[ext]
  if (!mime) return null
  return { bytes, mime, kind: "file", name }
}

function vaultFilePath(id: string) {
  return join(VAULT_DIR, id)
}

function deletableSourcePath(path: string): string | null {
  if (path.includes("\0") || path.includes("\\")) return null
  if (!path.startsWith(`${HOME}/`)) return null
  const rest = path.slice(HOME.length + 1)
  if (!rest) return null
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (segments.includes(".ssh")) return null
  if (segments[0] === ".config" && segments[1] === "open-bot") return null
  const base = segments[segments.length - 1] ?? ""
  if (!base || base === "auth.json" || base.endsWith("-auth.json")) return null
  return path
}

export async function deleteDesktopSource(
  userId: string,
  sourcePath: string,
): Promise<string | null> {
  const safe = deletableSourcePath(sourcePath)
  if (!safe) return "the desktop path is protected"
  try {
    const resolved = await opencodeExec(userId, ["realpath", "-e", "--", safe])
    if (resolved.code !== 0) return null
    const target = resolved.stdout.trim()
    if (!deletableSourcePath(target)) return "the desktop path is protected"
    const removed = await opencodeExec(userId, ["rm", "-f", "--", target])
    if (removed.code !== 0)
      return removed.stderr.trim() || "could not delete the desktop file"
    return null
  } catch {
    return "could not reach the desktop"
  }
}

async function deleteDesktopSources(
  userId: string,
  rows: Pick<MediaItem, "sourcePath">[],
): Promise<{ deleted: number; warnings: string[] }> {
  const seen = new Set<string>()
  const targets: string[] = []
  for (const row of rows) {
    if (!row.sourcePath || seen.has(row.sourcePath)) continue
    seen.add(row.sourcePath)
    targets.push(row.sourcePath)
  }
  const warnings: string[] = []
  let deleted = 0
  for (let i = 0; i < targets.length; i += 8) {
    const results = await Promise.all(
      targets.slice(i, i + 8).map((path) => deleteDesktopSource(userId, path)),
    )
    for (const result of results) {
      if (result) warnings.push(result)
      else deleted += 1
    }
  }
  return { deleted, warnings }
}

async function deleteSourcesIfRequested(
  url: URL,
  userId: string,
  rows: Pick<MediaItem, "sourcePath">[],
): Promise<{ deleted: number; warnings: string[] }> {
  if (url.searchParams.get("source") !== "1")
    return { deleted: 0, warnings: [] }
  if ((await desktopPhase(userId)) !== "running")
    return {
      deleted: 0,
      warnings: ["the desktop is not running — desktop files were kept"],
    }
  return deleteDesktopSources(userId, rows)
}

function removeVaultFile(id: string) {
  try {
    unlinkSync(vaultFilePath(id))
  } catch {
    // already gone
  }
}

export function uniqueAlbumName(db: Db, userId: string, base: string) {
  if (!db.mediaAlbumByName(userId, base)) return base
  for (let n = 2; n < 1000; n++) {
    const next = `${base} ${n}`.slice(0, 80).trimEnd()
    if (!db.mediaAlbumByName(userId, next)) return next
  }
  return `${base.slice(0, 70).trimEnd()} ${crypto.randomUUID().slice(0, 8)}`
}

export function ensureThreadAlbum(
  db: Db,
  userId: string,
  sessionId: string,
  title: string,
): MediaAlbum {
  const existing = db.mediaAlbumBySession(userId, sessionId)
  if (existing) return existing
  const row: MediaAlbum = {
    id: crypto.randomUUID(),
    userId,
    name: uniqueAlbumName(db, userId, title || "Chat"),
    sessionId,
    createdAt: Date.now(),
  }
  try {
    db.createMediaAlbum(row)
    return row
  } catch {
    return db.mediaAlbumBySession(userId, sessionId) ?? row
  }
}

export function createNamedAlbum(db: Db, userId: string, raw: string) {
  const name = sanitizeAlbumName(raw)
  if (!name) return { error: "an album name is required" as const }
  const existing = db.mediaAlbumByName(userId, name)
  if (existing) return { album: existing, created: false as const }
  const row: MediaAlbum = {
    id: crypto.randomUUID(),
    userId,
    name,
    sessionId: null,
    createdAt: Date.now(),
  }
  try {
    db.createMediaAlbum(row)
    return { album: row, created: true as const }
  } catch {
    const again = db.mediaAlbumByName(userId, name)
    if (again) return { album: again, created: false as const }
    return { error: "could not create the album" as const }
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function storeVaultBytes(
  db: Db,
  input: {
    userId: string
    albumId: string
    kind: MediaKind
    name: string
    title: string
    mime: string
    sourcePath: string
    sessionId: string | null
    messageId: string | null
    bytes: Uint8Array
  },
): { item: MediaItem; skipped: boolean } | { error: string } {
  if (vaultCapMb(db) === 0) return { error: "media vault is off" }
  const digest = sha256(input.bytes)
  const same = db.mediaItemBySha(input.albumId, digest)
  if (same) return { item: same, skipped: true }
  if (input.messageId) {
    const prior = db.mediaItemByMessagePath(input.messageId, input.sourcePath)
    if (prior) return { item: prior, skipped: true }
  }
  const id = crypto.randomUUID()
  const row: MediaItem = {
    id,
    userId: input.userId,
    albumId: input.albumId,
    kind: input.kind,
    name: input.name,
    title: sanitizeAlbumName(input.title) || input.name,
    mime: input.mime,
    bytes: input.bytes.byteLength,
    sha256: digest,
    sourcePath: input.sourcePath,
    sessionId: input.sessionId,
    messageId: input.messageId,
    createdAt: Date.now(),
  }
  mkdirSync(VAULT_DIR, { recursive: true })
  writeFileSync(vaultFilePath(id), input.bytes)
  if (!db.createMediaItem(row)) {
    removeVaultFile(id)
    const again = db.mediaItemBySha(input.albumId, digest)
    if (again) return { item: again, skipped: true }
    return { error: "could not store media" }
  }
  pruneMediaVault(db)
  return { item: db.mediaItem(id, input.userId) ?? row, skipped: false }
}

export function fileCapturedBytes(
  db: Db,
  input: {
    userId: string
    sessionId: string
    messageId: string
    path: string
    bytes: Uint8Array
    mime: string
    kind: Exclude<MediaKind, "file">
    albumTitle: string
  },
) {
  if (vaultCapMb(db) === 0) return false
  const name = input.path.slice(input.path.lastIndexOf("/") + 1) || "media"
  const album = ensureThreadAlbum(
    db,
    input.userId,
    input.sessionId,
    input.albumTitle,
  )
  const stored = storeVaultBytes(db, {
    userId: input.userId,
    albumId: album.id,
    kind: input.kind,
    name,
    title: name,
    mime: input.mime,
    sourcePath: input.path,
    sessionId: input.sessionId,
    messageId: input.messageId,
    bytes: input.bytes,
  })
  return "item" in stored && !stored.skipped
}

export function pruneMediaVault(db: Db) {
  let total = db.mediaVaultUsedBytes()
  const capBytes = vaultCapMb(db) * 1024 * 1024
  while (total > capBytes) {
    const rows = db.mediaVaultOldest(20)
    if (rows.length === 0) break
    for (const row of rows) {
      if (total <= capBytes) return
      db.deleteMediaItem(row.id, row.userId)
      removeVaultFile(row.id)
      total -= row.bytes
    }
  }
}

export function deleteUserVault(db: Db, userId: string) {
  const rows = db.mediaItemsForUser(userId)
  db.deleteMediaItems(rows.map((row) => row.id))
  for (const row of rows) removeVaultFile(row.id)
  for (const album of db.mediaAlbums(userId))
    db.deleteMediaAlbum(album.id, userId)
}

function publicAlbum(db: Db, album: MediaAlbum) {
  const items = db.mediaItemsForAlbum(album.userId, album.id)
  const latest = items[0] ?? null
  return {
    id: album.id,
    name: album.name,
    sessionId: album.sessionId,
    createdAt: album.createdAt,
    count: items.length,
    latest: latest
      ? {
          id: latest.id,
          kind: latest.kind,
          name: latest.name,
          url: vaultItemUrl(latest),
        }
      : null,
  }
}

function publicItem(row: MediaItem) {
  return {
    id: row.id,
    albumId: row.albumId,
    kind: row.kind,
    name: row.name,
    title: row.title,
    mime: row.mime,
    bytes: row.bytes,
    sourcePath: row.sourcePath,
    createdAt: row.createdAt,
    url: vaultItemUrl(row),
  }
}

function disposition(row: MediaItem) {
  const safe = row.name.replace(/[^\w.\- ]+/g, "_").slice(0, 180) || "download"
  const type = row.kind === "file" ? "attachment" : "inline"
  return `${type}; filename="${safe}"`
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function readJson(req: Request) {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>
}

function albumFrom(db: Db, userId: string, raw: string) {
  return db.mediaAlbum(raw, userId) ?? db.mediaAlbumByName(userId, raw)
}

export async function handleMedia(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: Hub,
): Promise<Response | null> {
  if (url.pathname === "/api/media/albums" && req.method === "GET") {
    return json({
      albums: db.mediaAlbums(user.id).map((album) => publicAlbum(db, album)),
    })
  }
  if (url.pathname === "/api/media/albums" && req.method === "POST") {
    const body = await readJson(req)
    const made = createNamedAlbum(db, user.id, String(body.name ?? ""))
    if ("error" in made) return json({ error: made.error }, 400)
    hub.emit(user.id, { type: "media.changed" })
    return json({ album: publicAlbum(db, made.album), created: made.created })
  }
  const albumMatch = url.pathname.match(/^\/api\/media\/albums\/([^/]+)$/)
  if (albumMatch && req.method === "DELETE") {
    const id = decodeURIComponent(albumMatch[1] ?? "")
    const album = db.mediaAlbum(id, user.id)
    if (!album) return json({ error: "not found" }, 404)
    const items = db.mediaItemsForAlbum(user.id, album.id)
    db.deleteMediaItems(items.map((item) => item.id))
    for (const item of items) removeVaultFile(item.id)
    db.deleteMediaAlbum(album.id, user.id)
    const sources = await deleteSourcesIfRequested(url, user.id, items)
    hub.emit(user.id, { type: "media.changed" })
    return json({
      ok: true,
      sourceDeleted: sources.deleted,
      warnings: sources.warnings,
    })
  }
  const itemsMatch = url.pathname.match(
    /^\/api\/media\/albums\/([^/]+)\/items$/,
  )
  if (itemsMatch && req.method === "GET") {
    const id = decodeURIComponent(itemsMatch[1] ?? "")
    const album = db.mediaAlbum(id, user.id)
    if (!album) return json({ error: "not found" }, 404)
    return json({
      album: publicAlbum(db, album),
      items: db.mediaItemsForAlbum(user.id, album.id).map(publicItem),
    })
  }
  if (url.pathname === "/api/media/items" && req.method === "POST") {
    const body = await readJson(req)
    const album = albumFrom(db, user.id, String(body.album ?? "").trim())
    if (!album) return json({ error: "album not found" }, 404)
    const path = vaultSourcePath(String(body.path ?? ""))
    if (!path) return json({ error: "the file must be under /home/agent" }, 400)
    if ((await desktopPhase(user.id)) !== "running")
      return json({ error: "desktop is not running" }, 409)
    const desktop = db.desktop(user.id)
    if (!desktop) return json({ error: "desktop is not running" }, 409)
    let payload: unknown
    try {
      const base = await endpoint(user.id, "opencode", 4096)
      const upstream = await fetch(
        opencodeFileUrl(
          base,
          "content",
          path.slice(0, path.lastIndexOf("/")) || "/",
          path,
        ),
        {
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
          },
          signal: AbortSignal.timeout(30_000),
        },
      )
      if (!upstream.ok) return json({ error: "file not found" }, 404)
      payload = await upstream.json().catch(() => null)
    } catch {
      return json({ error: "could not read the file" }, 502)
    }
    const decoded = classifyVaultPayload(path, payload)
    if (!decoded) return json({ error: "unsupported file" }, 400)
    const title = sanitizeAlbumName(String(body.title ?? "")) || decoded.name
    const stored = storeVaultBytes(db, {
      userId: user.id,
      albumId: album.id,
      kind: decoded.kind,
      name: decoded.name,
      title,
      mime: decoded.mime,
      sourcePath: path,
      sessionId: album.sessionId,
      messageId: null,
      bytes: decoded.bytes,
    })
    if ("error" in stored) return json({ error: stored.error }, 400)
    if (!stored.skipped) hub.emit(user.id, { type: "media.changed" })
    return json({ item: publicItem(stored.item), skipped: stored.skipped })
  }
  const itemMatch = url.pathname.match(/^\/api\/media\/items\/([^/]+)$/)
  if (itemMatch && req.method === "DELETE") {
    const id = decodeURIComponent(itemMatch[1] ?? "")
    const row = db.deleteMediaItem(id, user.id)
    if (!row) return json({ error: "not found" }, 404)
    removeVaultFile(row.id)
    const sources = await deleteSourcesIfRequested(url, user.id, [row])
    hub.emit(user.id, { type: "media.changed" })
    return json({
      ok: true,
      sourceDeleted: sources.deleted,
      warnings: sources.warnings,
    })
  }
  const fileMatch = url.pathname.match(/^\/api\/media\/items\/([^/]+)\/[^/]+$/)
  if (fileMatch && req.method === "GET") {
    const id = decodeURIComponent(fileMatch[1] ?? "")
    const row = db.mediaItem(id, user.id)
    if (!row) return json({ error: "not found" }, 404)
    let bytes: Buffer
    try {
      bytes = readFileSync(vaultFilePath(id))
    } catch {
      return json({ error: "not found" }, 404)
    }
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "content-type": row.mime,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-disposition": disposition(row),
      },
    })
  }
  return null
}
