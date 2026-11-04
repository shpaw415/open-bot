import { createContext, useContext } from "react"
import { agentFilePath } from "./chat-view"

/** Opens a served desktop file in the split previewer beside the thread.
 * Provided by the workspace; absent everywhere else (cron results), where
 * file links keep their plain new-tab behavior. */
export const FilePreviewContext = createContext<((src: string) => void) | null>(
  null,
)

export function useFilePreview(): ((src: string) => void) | null {
  return useContext(FilePreviewContext)
}

export type FilePreviewKind =
  | "markdown"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "model3d"
  | "download"

const TEXT_EXT = new Set([
  "txt",
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

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return base.startsWith(".") ? base.slice(1).toLowerCase() : ""
  return base.slice(dot + 1).toLowerCase()
}

/** How the split previewer shows one desktop file. */
export function filePreviewKind(path: string): FilePreviewKind {
  const ext = extOf(path)
  if (ext === "md" || ext === "markdown") return "markdown"
  if (ext === "pdf") return "pdf"
  if (ext === "glb") return "model3d"
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(
      ext,
    )
  )
    return "image"
  if (["mp4", "webm", "mov"].includes(ext)) return "video"
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio"
  if (!ext || TEXT_EXT.has(ext)) return "text"
  return "download"
}

/** The desktop path behind a served file URL (/api/workspace/file?…), or
 * null for snapshot/vault/web URLs that carry no live disk path. */
export function filePathFromSrc(src: string | undefined): string | null {
  if (!src || !src.startsWith("/api/workspace/")) return null
  const query = src.indexOf("?")
  if (query < 0) return null
  const raw = new URLSearchParams(src.slice(query + 1)).get("path")
  if (!raw) return null
  return agentFilePath(raw)
}

export const TEXT_PREVIEW_MAX_CHARS = 1_000_000

/** Caps a fetched text body so a multi-megabyte log cannot wedge the pane. */
export function truncateTextPreview(text: string): {
  text: string
  truncated: boolean
} {
  if (text.length <= TEXT_PREVIEW_MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(0, TEXT_PREVIEW_MAX_CHARS), truncated: true }
}
