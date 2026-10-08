const WORKSPACE = "/home/agent/workspace/"
const MODEL3D_EXT = /\.glb$/i
const MAX_MODEL3D_BYTES = 50 * 1024 * 1024

export const MODEL3D_REPLY =
  "When you generate a 3D model, save it under /home/agent/workspace and include ![short description](/home/agent/workspace/name.glb) in the final message. The chat embeds an interactive 3D viewer for it. Do not paste base64 or only name the path."

export function workspaceModel3dPath(raw: string): string | null {
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
  if (!MODEL3D_EXT.test(rest)) return null
  return `${WORKSPACE}${rest}`
}

export function decodeWorkspaceModel3d(payload: unknown): {
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
  if (content.length > Math.ceil((MAX_MODEL3D_BYTES * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null
  const bytes = new Uint8Array(Buffer.from(content, "base64"))
  if (bytes.length === 0 || bytes.length > MAX_MODEL3D_BYTES) return null
  if (!glbMagic(bytes)) return null
  return { bytes, mime: "model/gltf-binary" }
}

export function workspaceModel3dResponse(payload: unknown): Response | null {
  const decoded = decodeWorkspaceModel3d(payload)
  if (!decoded) return null
  return new Response(decoded.bytes as unknown as BodyInit, {
    headers: {
      "content-type": decoded.mime,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      "accept-ranges": "none",
    },
  })
}

function glbMagic(bytes: Uint8Array): boolean {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0x67 ||
    bytes[1] !== 0x6c ||
    bytes[2] !== 0x54 ||
    bytes[3] !== 0x46
  ) {
    return false
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) !== 2) return false
  return view.getUint32(8, true) <= bytes.length
}
