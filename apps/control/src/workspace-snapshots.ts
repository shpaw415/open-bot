import { mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Db, WorkspaceMedia } from "@open-bot/db"
import { endpoint } from "./docker"
import { dataDir } from "./env"
import { decodeWorkspaceImage, workspaceImagePath } from "./workspace-image"
import {
  decodeWorkspaceModel3d,
  workspaceModel3dPath,
} from "./workspace-model3d"
import { decodeWorkspaceVideo, workspaceVideoPath } from "./workspace-video"

export const MEDIA_DIR = join(dataDir, "workspace-media")
export const MEDIA_CAP_KEY = "media_snapshot_cap_mb"
export const DEFAULT_MEDIA_CAP_MB = 3072
export const MAX_MEDIA_CAP_MB = 102400

// Only messages whose turn finished recently are snapshotted: their bytes are
// still the ones the message showed. Older messages fall back to the live path.
const RECENT_WINDOW_MS = 10 * 60_000
const FILE_TIMEOUT_MS = 30_000

export function mediaCapMb(db: Db): number {
  const raw = db.getSetting(MEDIA_CAP_KEY)
  if (raw == null) return DEFAULT_MEDIA_CAP_MB
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MEDIA_CAP_MB
  return Math.min(value, MAX_MEDIA_CAP_MB)
}

export function snapshotUrlFor(row: Pick<WorkspaceMedia, "id" | "path">) {
  const name = row.path.slice(row.path.lastIndexOf("/") + 1)
  return `/api/workspace/snapshot/${row.id}/${encodeURIComponent(name)}`
}

function mediaFilePath(id: string) {
  return join(MEDIA_DIR, id)
}

function removeMediaFile(id: string) {
  try {
    unlinkSync(mediaFilePath(id))
  } catch {
    // already gone
  }
}

function basicAuth(password: string) {
  return {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  }
}

type MessageLike = {
  info?: { id?: unknown; role?: unknown; time?: { completed?: unknown } }
  parts?: { type?: unknown; text?: unknown; url?: unknown }[] | undefined
}[]

export function collectTargets(
  message: MessageLike[number],
  now: number,
): { messageId: string; path: string; kind: Kind }[] {
  const info = message?.info
  const messageId = typeof info?.id === "string" ? info.id : ""
  if (!messageId || info?.role !== "assistant") return []
  const completed =
    typeof info?.time?.completed === "number" ? info.time.completed : null
  if (completed == null || now - completed > RECENT_WINDOW_MS) return []
  const out = new Map<string, Kind>()
  const consider = (raw: string) => {
    const image = workspaceImagePath(raw)
    if (image) return out.set(image, "image")
    const video = workspaceVideoPath(raw)
    if (video) return out.set(video, "video")
    const model = workspaceModel3dPath(raw)
    if (model) out.set(model, "model3d")
  }
  for (const part of message.parts ?? []) {
    if (typeof part?.url === "string") consider(part.url)
    if (typeof part?.text !== "string") continue
    for (const match of part.text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g))
      consider(match[1] ?? "")
    for (const line of part.text.split("\n")) consider(line.trim())
  }
  return [...out].map(([path, kind]) => ({ messageId, path, kind }))
}

type Kind = "image" | "video" | "model3d"

function decodeKind(kind: Kind, payload: unknown) {
  if (kind === "image") return decodeWorkspaceImage(payload)
  if (kind === "video") return decodeWorkspaceVideo(payload)
  return decodeWorkspaceModel3d(payload)
}

export async function snapshotOne(
  db: Db,
  userId: string,
  sessionId: string,
  base: string,
  auth: HeadersInit,
  target: { messageId: string; path: string; kind: Kind },
) {
  const upstream = await fetch(
    `${base}/file/content?path=${encodeURIComponent(target.path)}`,
    { headers: auth, signal: AbortSignal.timeout(FILE_TIMEOUT_MS) },
  )
  if (!upstream.ok) return
  const decoded = decodeKind(
    target.kind,
    await upstream.json().catch(() => null),
  )
  if (!decoded) return
  const id = crypto.randomUUID()
  mkdirSync(MEDIA_DIR, { recursive: true })
  writeFileSync(mediaFilePath(id), decoded.bytes)
  const created = db.createWorkspaceMedia({
    id,
    userId,
    sessionId,
    messageId: target.messageId,
    path: target.path,
    mime: decoded.mime,
    bytes: decoded.bytes.byteLength,
    createdAt: Date.now(),
  })
  if (!created) removeMediaFile(id)
}

/** Prune oldest snapshots until total size fits under the configured cap. */
export function pruneWorkspaceMedia(db: Db) {
  let total = db.workspaceMediaUsedBytes()
  const capBytes = mediaCapMb(db) * 1024 * 1024
  while (total > capBytes) {
    const rows = db.workspaceMediaOldest(20)
    if (rows.length === 0) break
    for (const row of rows) {
      if (total <= capBytes) return
      db.deleteWorkspaceMedia([row.id])
      removeMediaFile(row.id)
      total -= row.bytes
    }
  }
}

export async function captureSessionMedia(
  db: Db,
  userId: string,
  sessionId: string,
) {
  try {
    const desktop = db.desktop(userId)
    if (!desktop) return
    const base = await endpoint(userId, "opencode", 4096)
    const auth = basicAuth(desktop.opencodePassword)
    const res = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}/message`,
      { headers: auth, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return
    const body = (await res.json().catch(() => null)) as MessageLike | null
    if (!Array.isArray(body)) return
    const now = Date.now()
    const pending = body.flatMap((message) => collectTargets(message, now))
    if (pending.length === 0) return
    const existing = new Set(
      db
        .workspaceMediaForSession(userId, sessionId)
        .map((row) => `${row.messageId}\n${row.path}`),
    )
    for (const target of pending) {
      if (existing.has(`${target.messageId}\n${target.path}`)) continue
      existing.add(`${target.messageId}\n${target.path}`)
      await snapshotOne(db, userId, sessionId, base, auth, target).catch(
        () => {},
      )
    }
  } catch {
    // capture is best-effort; the chat falls back to the live path
  } finally {
    pruneWorkspaceMedia(db)
  }
}

const queues = new Map<string, Promise<void>>()

/** Serializes capture per user so many idle events cannot stampede the desktop. */
export function queueCapture(db: Db, userId: string, sessionId: string) {
  const prev = queues.get(userId) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => captureSessionMedia(db, userId, sessionId))
    .finally(() => {
      if (queues.get(userId) === next) queues.delete(userId)
    })
  queues.set(userId, next)
}

/** EventHub observer entry: capture media when a turn goes idle. */
export function onUpstreamEvent(
  db: Db,
  userId: string,
  event: {
    type?: unknown
    properties?: unknown
  },
) {
  if (event.type !== "session.idle") return
  const props = event.properties as { sessionID?: unknown } | undefined
  const sessionId = props?.sessionID
  if (typeof sessionId === "string" && sessionId)
    queueCapture(db, userId, sessionId)
}

/** Deletes snapshots (rows + files) for one thread. */
export function deleteSessionMedia(db: Db, userId: string, sessionId: string) {
  const rows = db.workspaceMediaForSession(userId, sessionId)
  db.deleteWorkspaceMedia(rows.map((row) => row.id))
  for (const row of rows) removeMediaFile(row.id)
}

/** Deletes every snapshot (rows + files) a user owns. */
export function deleteUserMedia(db: Db, userId: string) {
  const rows = db.workspaceMediaForUser(userId)
  db.deleteWorkspaceMedia(rows.map((row) => row.id))
  for (const row of rows) removeMediaFile(row.id)
}
