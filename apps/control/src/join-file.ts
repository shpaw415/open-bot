import { HttpError } from "./http-error"

export const MAX_JOIN_BYTES = 4 * 1024 * 1024
export const MAX_JOIN_FILES = 5
const UPLOADS = "/home/agent/workspace/uploads/"
const MAX_DATA_CHARS = Math.ceil((MAX_JOIN_BYTES * 4) / 3) + 128

const MODEL_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
])

export const JOINED_REPLY =
  "The user joined files into this message. Each Joined file path is already on disk. Read that path. Do not ask them to upload again."

export type AgentUpload = {
  path: string
  bytes: Uint8Array
}

export function newJoinId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

export function safeJoinName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "file"
  const cleaned = base
    .replace(/[^\w.\- ()[\]]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80)
  return cleaned || "file"
}

export function joinedFilePath(id: string, name: string): string | null {
  if (!/^[a-z0-9]{8,32}$/.test(id)) return null
  const safe = safeJoinName(name)
  if (!safe || safe.includes("/") || safe.includes("\\")) return null
  return `${UPLOADS}${id}-${safe}`
}

export function isUploadPath(path: string): boolean {
  if (!path.startsWith(UPLOADS) || path.includes("\0") || path.includes("\\"))
    return false
  const rest = path.slice(UPLOADS.length)
  if (!rest || rest.includes("/") || rest === "." || rest === "..") return false
  return true
}

export function prepareJoinedPrompt(
  body: Record<string, unknown>,
  idFor: (index: number) => string = () => newJoinId(),
): { body: Record<string, unknown>; uploads: AgentUpload[] } {
  const parts = body.parts
  if (!Array.isArray(parts) || !parts.some(isFilePart))
    return { body, uploads: [] }
  const uploads: AgentUpload[] = []
  const next: unknown[] = []
  let files = 0
  for (const part of parts) {
    if (!isFilePart(part)) {
      next.push(part)
      continue
    }
    const url = part.url
    if (typeof url !== "string" || /^(file|https?):/i.test(url.trim())) continue
    files += 1
    if (files > MAX_JOIN_FILES)
      throw new HttpError(400, "You can join up to 5 files.", "too_many_files")
    const decoded = decodeDataFile(url, part.mime)
    const id = idFor(uploads.length)
    const path = joinedFilePath(
      id,
      typeof part.filename === "string" ? part.filename : "file",
    )
    if (!path || !isUploadPath(path))
      throw new HttpError(400, "joined file is invalid", "invalid_file")
    uploads.push({ path, bytes: decoded.bytes })
    if (MODEL_MIME.has(decoded.mime)) {
      next.push({
        type: "file",
        mime: decoded.mime,
        filename: safeJoinName(
          typeof part.filename === "string" ? part.filename : "file",
        ),
        url: `data:${decoded.mime};base64,${Buffer.from(decoded.bytes).toString("base64")}`,
      })
    }
  }
  if (uploads.length === 0)
    throw new HttpError(400, "joined file is invalid", "invalid_file")
  return {
    body: {
      ...body,
      parts: withJoinedText(
        next,
        uploads.map((item) => item.path),
      ),
    },
    uploads,
  }
}

function withJoinedText(parts: unknown[], paths: string[]): unknown[] {
  const note = paths.map((path) => `Joined file: ${path}`).join("\n")
  const index = parts.findIndex(
    (part) =>
      !!part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string",
  )
  if (index === -1) return [{ type: "text", text: note }, ...parts]
  const next = parts.slice()
  const part = next[index] as { text: string }
  const text = part.text.trim()
  next[index] = { ...part, text: text ? `${text}\n\n${note}` : note }
  return next
}

function isFilePart(part: unknown): part is {
  type: string
  url?: unknown
  mime?: unknown
  filename?: unknown
} {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "file"
  )
}

function decodeDataFile(
  url: string,
  declared: unknown,
): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(url.trim())
  if (!match) throw new HttpError(400, "joined file is invalid", "invalid_file")
  const mime =
    match[1]?.toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : (match[1]?.toLowerCase() ?? "")
  const payload = (match[2] ?? "").replace(/\s/g, "")
  if (
    !mime ||
    payload.length > MAX_DATA_CHARS ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    throw new HttpError(400, "joined file is invalid", "invalid_file")
  const claimed =
    typeof declared === "string"
      ? declared.split(";")[0]?.trim().toLowerCase()
      : ""
  const claimedMime = claimed === "image/jpg" ? "image/jpeg" : claimed
  if (claimedMime && claimedMime !== mime)
    throw new HttpError(400, "joined file is invalid", "invalid_file")
  const bytes = new Uint8Array(Buffer.from(payload, "base64"))
  if (bytes.length === 0)
    throw new HttpError(400, "That file is empty.", "empty_file")
  if (bytes.length > MAX_JOIN_BYTES)
    throw new HttpError(400, "That file is over 4 MB.", "file_too_large")
  return { mime, bytes }
}
