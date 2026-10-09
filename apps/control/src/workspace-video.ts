const WORKSPACE = "/home/agent/workspace/"
const VIDEO_EXT = /\.(mp4|webm)$/i
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export const VIDEO_REPLY =
  "When you generate a video, save it under /home/agent/workspace and include ![short description](/home/agent/workspace/name.mp4) in the final message. The chat embeds that video. Never overwrite a file you already showed in chat — when regenerating, save the result under a NEW filename (e.g. name-v2.mp4) and embed that. Do not paste base64 or only name the path."

export function workspaceVideoPath(raw: string): string | null {
  let path = raw.trim()
  if (!path || path.includes("\0") || path.includes("\\")) return null
  if (path.startsWith("file://")) {
    try {
      const url = new URL(path)
      if (url.protocol !== "file:") return null
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
  if (!path.startsWith(WORKSPACE)) return null
  const rest = path.slice(WORKSPACE.length)
  if (!rest) return null
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (!VIDEO_EXT.test(rest)) return null
  return `${WORKSPACE}${rest}`
}

export function decodeWorkspaceVideo(payload: unknown): {
  bytes: Uint8Array
  mime: string
} | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as {
    type?: unknown
    content?: unknown
    encoding?: unknown
  }
  if (body.type !== "binary" || body.encoding !== "base64") return null
  if (typeof body.content !== "string" || !body.content) return null
  const content = body.content.replace(/\s/g, "")
  if (content.length > Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null
  const bytes = new Uint8Array(Buffer.from(content, "base64"))
  if (bytes.length === 0 || bytes.length > MAX_VIDEO_BYTES) return null
  const mime = videoMime(bytes)
  if (!mime) return null
  return { bytes, mime }
}

export function workspaceVideoResponse(payload: unknown): Response | null {
  const decoded = decodeWorkspaceVideo(payload)
  if (!decoded) return null
  return new Response(decoded.bytes as unknown as BodyInit, {
    headers: {
      "content-type": decoded.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "accept-ranges": "none",
    },
  })
}

function videoMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
    return "video/mp4"
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm"
  return null
}
