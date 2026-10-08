export type TreeEntry = {
  name: string
  path: string
  isDir: boolean
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export function dirName(path: string): string {
  const cut = path.lastIndexOf("/")
  return cut <= 0 ? "/" : path.slice(0, cut)
}

export function joinName(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`
}

export function relPath(root: string, path: string): string {
  const clean = root.replace(/\/+$/g, "")
  if (path === clean) return ""
  const prefix = `${clean}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : baseName(path)
}

export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean)
}

/** Normalizes the opencode /file listing into display entries, folders first. */
export function parseEntries(body: unknown, dir: string): TreeEntry[] {
  if (!Array.isArray(body)) return []
  const out: TreeEntry[] = []
  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as {
      name?: unknown
      path?: unknown
      absolute?: unknown
      type?: unknown
      isDirectory?: unknown
    }
    const absolute =
      typeof item.absolute === "string" && item.absolute.startsWith("/")
        ? item.absolute.replace(/\/+$/g, "")
        : ""
    const listed =
      typeof item.path === "string" && item.path.startsWith("/")
        ? item.path.replace(/\/+$/g, "")
        : ""
    const path = absolute || listed
    let name = typeof item.name === "string" ? item.name : ""
    if (!name && path) name = baseName(path)
    if (!name || name === "." || name === "..") continue
    const isDir = item.type === "directory" || item.isDirectory === true
    out.push({ name, path: path || joinName(dir, name), isDir })
  }
  out.sort((a, b) =>
    a.isDir !== b.isDir
      ? a.isDir
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.name.localeCompare(b.name),
  )
  return out
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  html: "html",
  htm: "html",
  vue: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  swift: "swift",
  kt: "kotlin",
  pl: "perl",
  lua: "lua",
  txt: "plaintext",
}

export function languageFor(path: string): string {
  const base = baseName(path).toLowerCase()
  if (base === "dockerfile") return "dockerfile"
  if (base === "makefile") return "makefile"
  if (base === ".gitignore" || base === ".gitattributes") return "ini"
  const dot = base.lastIndexOf(".")
  if (dot < 0) return "plaintext"
  return LANGUAGES[base.slice(dot + 1)] ?? "plaintext"
}

export type FileIconToken =
  | "ts"
  | "js"
  | "react"
  | "json"
  | "python"
  | "html"
  | "css"
  | "markdown"
  | "image"
  | "shell"
  | "git"
  | "lock"
  | "config"
  | "doc"
  | "file"

export function iconForFile(name: string): FileIconToken {
  const base = baseName(name).toLowerCase()
  if (base === ".gitignore" || base === ".gitattributes") return "git"
  if (/\.(lock|lockb)$/.test(base)) return "lock"
  if (base === "dockerfile" || base === "makefile") return "config"
  const dot = base.lastIndexOf(".")
  const ext = dot < 0 ? "" : base.slice(dot + 1)
  if (ext === "ts" || ext === "mts" || ext === "cts") return "ts"
  if (ext === "tsx") return "react"
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "js"
  if (ext === "jsx") return "react"
  if (ext === "json" || ext === "jsonc") return "json"
  if (ext === "py") return "python"
  if (ext === "html" || ext === "htm" || ext === "vue") return "html"
  if (ext === "css" || ext === "scss" || ext === "less") return "css"
  if (ext === "md" || ext === "markdown") return "markdown"
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "shell"
  if (isImageFile(name)) return "image"
  if (ext === "yml" || ext === "yaml" || ext === "toml" || ext === "ini")
    return "config"
  if (ext === "txt" || ext === "pdf" || ext === "doc" || ext === "docx")
    return "doc"
  return "file"
}

export function isImageFile(name: string): boolean {
  const base = baseName(name).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot < 0 ? "" : base.slice(dot + 1)
  return [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "ico",
    "bmp",
    "avif",
  ].includes(ext)
}

export type FileContent =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: string; src: string }
  | { kind: "binary" }
  | null

/** Shapes the opencode /file/content payload for the viewer. */
export function decodeContent(name: string, body: unknown): FileContent {
  if (!body || typeof body !== "object") return null
  const payload = body as {
    type?: unknown
    encoding?: unknown
    content?: unknown
  }
  if (typeof payload.content !== "string") return null
  if (payload.type === "binary") {
    if (payload.encoding !== "base64") return { kind: "binary" }
    const base64 = payload.content.replace(/\s/g, "")
    const mime = imageMimeFromBase64(base64)
    if (!mime) return { kind: "binary" }
    return { kind: "image", mime, src: `data:${mime};base64,${base64}` }
  }
  if (baseName(name).toLowerCase().endsWith(".svg")) {
    return {
      kind: "image",
      mime: "image/svg+xml",
      src: `data:image/svg+xml;base64,${btoa(payload.content)}`,
    }
  }
  return { kind: "text", text: payload.content }
}

function imageMimeFromBase64(base64: string): string | null {
  const slice = base64.slice(0, 20)
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(slice), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
  if (
    bytes.length >= 4 &&
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
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
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

/** Quick-open ranking: basename hits beat path hits, best first. */
export function fuzzyFilterFiles(
  files: string[],
  root: string,
  query: string,
  limit = 12,
): string[] {
  const cleaned = query.replace(/\s+/g, "").toLowerCase()
  if (!cleaned) return files.slice(0, limit)
  const scored: { path: string; score: number }[] = []
  for (const file of files) {
    const rel = relPath(root, file)
    const base = baseName(rel).toLowerCase()
    const score =
      (rel.toLowerCase().startsWith(cleaned) ? 1500 : 0) +
      (base.startsWith(cleaned) ? 900 : 0) +
      fuzzyScore(cleaned, base) * 2 +
      fuzzyScore(cleaned, rel.toLowerCase())
    if (score > 0) scored.push({ path: file, score })
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return scored.slice(0, limit).map((entry) => entry.path)
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  if (text === query) return 1000
  if (text.startsWith(query)) return 800 - text.length
  if (text.includes(query)) return 600 - text.length
  let index = 0
  for (const char of query) {
    index = text.indexOf(char, index)
    if (index < 0) return -1
    index += 1
  }
  return 300 - text.length
}
