const WORKSPACE = "/home/agent/workspace/"
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export const IMAGE_REPLY =
  "When you generate or show an image, save a unique PNG under /home/agent/workspace and include ![short description](/home/agent/workspace/name.png) in the final message. The chat renders that image. Do not paste base64 or only name the path."

export function workspaceImagePath(raw: string): string | null {
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
  if (!IMAGE_EXT.test(rest)) return null
  return `${WORKSPACE}${rest}`
}

export function decodeWorkspaceImage(payload: unknown): {
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
  if (content.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null
  const bytes = new Uint8Array(Buffer.from(content, "base64"))
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
  const mime = imageMime(bytes)
  if (!mime) return null
  return { bytes, mime }
}

export function workspaceImageResponse(payload: unknown): Response | null {
  const decoded = decodeWorkspaceImage(payload)
  if (!decoded) return null
  return new Response(decoded.bytes as unknown as BodyInit, {
    headers: {
      "content-type": decoded.mime,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  })
}

function imageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png"
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp"
  return null
}
