import { decodeWorkspaceImage } from "./workspace-image"
import { decodeWorkspaceModel3d } from "./workspace-model3d"
import { decodeWorkspaceVideo } from "./workspace-video"

const HOME = "/home/agent/"
const MAX_FILE_BYTES = 25 * 1024 * 1024
const TEXT_MIME = "text/plain; charset=utf-8"

export const FILE_REPLY =
  "When you create or reference any other file on this desktop (a PDF, notes, data, code, an archive…), link it as [short name](/home/agent/path/to/file.ext) in the final message. The chat opens that link so the user can view or download the file. Never paste the file's contents or base64 when a link will do."

// Text the browser can read directly. Served as text/plain on purpose:
// html/xml/json under their own types would execute on the dashboard origin.
const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "log",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "xml",
  "html",
  "htm",
  "ts",
  "mts",
  "cts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "css",
  "scss",
  "less",
  "sql",
  "swift",
  "kt",
  "lua",
  "pl",
  "vue",
  "gitignore",
  "gitattributes",
  "editorconfig",
])

// Binary files that render inline in a browser tab, by extension.
const INLINE_MIME: Record<string, string> = {
  pdf: "application/pdf",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mov: "video/quicktime",
  stl: "model/stl",
}

// Binary files a browser cannot show: a click downloads them.
const ATTACHMENT_MIME: Record<string, string> = {
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
}

const MAGIC_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  glb: "model/gltf-binary",
}

function extension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return base.startsWith(".") ? base.slice(1).toLowerCase() : ""
  return base.slice(dot + 1).toLowerCase()
}

function sensitiveBase(base: string): boolean {
  const name = base.toLowerCase()
  if (name === ".env" || name.startsWith(".env.")) return true
  if (name === "auth.json" || name.endsWith("-auth.json")) return true
  if (name === ".npmrc" || name === ".netrc" || name === ".pypirc") return true
  if (/^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/.test(name)) return true
  if (/\.(pem|key|p12|pfx)$/.test(name)) return true
  return false
}

function declaredKind(
  path: string,
): { mime: string; inline: boolean; textOnly: boolean } | null {
  const ext = extension(path)
  if (!ext) return { mime: TEXT_MIME, inline: true, textOnly: true }
  if (TEXT_EXT.has(ext))
    return { mime: TEXT_MIME, inline: true, textOnly: false }
  if (ext === "svg")
    return { mime: "image/svg+xml", inline: true, textOnly: false }
  const inline = INLINE_MIME[ext] ?? MAGIC_MIME[ext]
  if (inline) return { mime: inline, inline: true, textOnly: false }
  const attachment = ATTACHMENT_MIME[ext]
  if (attachment) return { mime: attachment, inline: false, textOnly: false }
  return null
}

export function agentFilePath(raw: string): string | null {
  let path = raw.trim()
  if (!path || path.includes("\0") || path.includes("\\")) return null
  if (path.startsWith("file://")) {
    try {
      const url = new URL(path)
      if (url.protocol !== "file:") return null
      if (url.hostname && url.hostname !== "localhost") return null
      path = decodeURIComponent(url.pathname)
    } catch {
      return null
    }
  } else {
    if (path.includes("?") || path.includes("#")) return null
    try {
      path = decodeURIComponent(path)
    } catch {
      return null
    }
  }
  if (!path.startsWith(HOME)) return null
  const rest = path.slice(HOME.length)
  if (!rest) return null
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (segments.includes(".ssh") || segments.includes(".open-bot")) return null
  if (segments.includes(".openviking")) return null
  if (segments[0] === ".config" && segments[1] === "open-bot") return null
  const base = segments[segments.length - 1] ?? ""
  if (!base || sensitiveBase(base)) return null
  if (!declaredKind(path)) return null
  return path
}

function binaryPayload(payload: unknown): Uint8Array | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as {
    type?: unknown
    content?: unknown
    encoding?: unknown
  }
  if (body.type !== "binary" || body.encoding !== "base64") return null
  if (typeof body.content !== "string" || !body.content) return null
  const content = body.content.replace(/\s/g, "")
  if (content.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null
  const bytes = new Uint8Array(Buffer.from(content, "base64"))
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return null
  return bytes
}

function textPayload(payload: unknown): Uint8Array | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as { type?: unknown; content?: unknown }
  if (body.type !== "text" || typeof body.content !== "string") return null
  const bytes = new TextEncoder().encode(body.content)
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return null
  return bytes
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte)
}

export function decodeWorkspaceFile(
  path: string,
  payload: unknown,
): { bytes: Uint8Array; mime: string; inline: boolean; name: string } | null {
  const safe = agentFilePath(path)
  if (!safe) return null
  const kind = declaredKind(safe)
  if (!kind) return null
  const name = safe.slice(safe.lastIndexOf("/") + 1)
  const ext = extension(safe)
  // Media the specialized decoders already magic-check; reuse them so a
  // renamed secret can never pose as an image, video, or model.
  const media =
    decodeWorkspaceImage(payload) ??
    decodeWorkspaceVideo(payload) ??
    decodeWorkspaceModel3d(payload)
  if (media) return { ...media, inline: true, name }
  if (MAGIC_MIME[ext]) return null
  const text = textPayload(payload)
  if (ext === "svg") {
    if (!text) return null
    const head = new TextDecoder().decode(text.slice(0, 1024)).trimStart()
    if (!/^<\?xml[\s\S]*?<svg|^<svg[\s>]/.test(head)) return null
    return { bytes: text, mime: kind.mime, inline: true, name }
  }
  if (kind.textOnly) {
    return text ? { bytes: text, mime: kind.mime, inline: true, name } : null
  }
  if (TEXT_EXT.has(ext)) {
    const bytes = text ?? binaryPayload(payload)
    return bytes ? { bytes, mime: kind.mime, inline: true, name } : null
  }
  const bytes = binaryPayload(payload) ?? text
  if (!bytes) return null
  if (ext === "pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return null
  if (
    (ext === "zip" || ext === "docx" || ext === "xlsx" || ext === "pptx") &&
    !startsWith(bytes, [0x50, 0x4b])
  )
    return null
  return { bytes, mime: kind.mime, inline: kind.inline, name }
}

export function workspaceFileResponse(
  path: string,
  payload: unknown,
): Response | null {
  const decoded = decodeWorkspaceFile(path, payload)
  if (!decoded) return null
  const safe =
    decoded.name.replace(/[^\w.\- ]+/g, "_").slice(0, 180) || "download"
  // Types that can carry script (svg, anything text-shaped) or that only
  // ever download stay CSP-sandboxed so they can never run on the
  // dashboard origin. Magic-checked media and PDF must reach the
  // browser's own viewers inside the preview pane, which a sandbox
  // header blocks; their declared types cannot execute script.
  const sandbox =
    decoded.mime === "image/svg+xml" ||
    decoded.mime.startsWith("text/") ||
    !decoded.inline
  return new Response(decoded.bytes as unknown as BodyInit, {
    headers: {
      "content-type": decoded.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(sandbox
        ? { "content-security-policy": "default-src 'none'; sandbox" }
        : {}),
      "content-disposition": `${decoded.inline ? "inline" : "attachment"}; filename="${safe}"`,
    },
  })
}
