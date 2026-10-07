import { clientId } from "./api"

export const MAX_JOIN_BYTES = 4 * 1024 * 1024
export const MAX_JOIN_FILES = 5

export type JoinedFile = {
  id: string
  name: string
  mime: string
  url: string
}

export function joinedImage(file: JoinedFile): boolean {
  return file.mime.startsWith("image/") && file.url.startsWith("data:image/")
}

export function joinFileError(file: File, count: number): string | null {
  if (count >= MAX_JOIN_FILES) return "You can join up to 5 files."
  if (file.size > MAX_JOIN_BYTES) return "That file is over 4 MB."
  if (file.size === 0) return "That file is empty."
  return null
}

export function promptParts(text: string, files: JoinedFile[]) {
  const parts: {
    type: string
    text?: string
    mime?: string
    filename?: string
    url?: string
  }[] = []
  for (const file of files) {
    parts.push({
      type: "file",
      mime: file.mime,
      filename: file.name,
      url: file.url,
    })
  }
  const trimmed = text.trim()
  if (trimmed) parts.push({ type: "text", text: trimmed })
  return parts
}

export async function readJoinedFile(file: File): Promise<JoinedFile> {
  const raw = await readAsDataUrl(file)
  const canonical = canonicalDataUrl(raw, file.type)
  if (!canonical) throw new Error("could not read that file")
  return {
    id: clientId(),
    name: file.name || "file",
    mime: canonical.mime,
    url: canonical.url,
  }
}

function canonicalDataUrl(
  url: string,
  fallbackMime: string,
): { mime: string; url: string } | null {
  const match = /^data:([^;,]*);base64,([a-z0-9+/=\s]+)$/i.exec(url.trim())
  if (!match) return null
  const mime = (match[1] || fallbackMime || "application/octet-stream")
    .split(";")[0]
    ?.trim()
    .toLowerCase()
  const payload = (match[2] ?? "").replace(/\s/g, "")
  if (!mime || !payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime
  return { mime: normalized, url: `data:${normalized};base64,${payload}` }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("could not read that file"))
    }
    reader.onerror = () => reject(new Error("could not read that file"))
    reader.readAsDataURL(file)
  })
}
