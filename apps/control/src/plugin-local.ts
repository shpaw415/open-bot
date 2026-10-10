import {
  isValidFileSource,
  manifestIssuesText,
  type PluginManifest,
  parsePluginManifest,
} from "@open-bot/plugin-kit"
import { isRunning, opencodeExec, type PluginToolFile } from "./docker"
import { names } from "./env"
import { HttpError } from "./http-error"

const MAX_PATH = 512
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_README_BYTES = 512 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024

export function checkLocalPluginPath(
  input: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const path = input.trim().replace(/\/+$/, "")
  if (
    !path.startsWith("/") ||
    path.length > MAX_PATH ||
    /[\0\r\n]/.test(input)
  ) {
    return { ok: false, error: "path must be an absolute desktop path" }
  }
  const segments = path.split("/").slice(1)
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return { ok: false, error: "path must be an absolute desktop path" }
  }
  return { ok: true, path }
}

async function requireDesktop(userId: string) {
  if (!(await isRunning(names(userId).opencode))) {
    throw new HttpError(
      409,
      "start the desktop before installing a local plugin",
      "desktop_stopped",
    )
  }
}

async function agentRealpath(
  userId: string,
  path: string,
  missing = "plugin path was not found on the desktop",
): Promise<string> {
  const result = await opencodeExec(userId, ["realpath", "-e", "--", path])
  if (result.code !== 0) {
    throw new HttpError(404, missing, "local_path")
  }
  const resolved = result.stdout.trim()
  const checked = checkLocalPluginPath(resolved)
  if (!checked.ok) {
    throw new HttpError(400, checked.error, "invalid_path")
  }
  return checked.path
}

async function agentFileSize(
  userId: string,
  path: string,
): Promise<number | null> {
  const result = await opencodeExec(userId, ["stat", "-c", "%s", "--", path])
  if (result.code !== 0) return null
  const size = Number(result.stdout.trim())
  return Number.isFinite(size) ? size : null
}

async function agentCat(userId: string, path: string, maxBytes: number) {
  const size = await agentFileSize(userId, path)
  if (size === null) {
    throw new HttpError(
      404,
      "plugin file was not found on the desktop",
      "local_file",
    )
  }
  if (size > maxBytes) {
    throw new HttpError(400, "plugin file is too large", "local_file")
  }
  const result = await opencodeExec(userId, ["cat", "--", path])
  if (result.code !== 0) {
    throw new HttpError(
      404,
      result.stderr.trim() || "plugin file was not found on the desktop",
      "local_file",
    )
  }
  if (
    result.stdout.includes("\0") ||
    Buffer.byteLength(result.stdout) > maxBytes
  ) {
    throw new HttpError(
      400,
      "plugin file must be text under the size limit",
      "local_file",
    )
  }
  return result.stdout
}

export async function readLocalPluginManifest(userId: string, rawPath: string) {
  const checked = checkLocalPluginPath(rawPath)
  if (!checked.ok) {
    throw new HttpError(400, checked.error, "invalid_path")
  }
  await requireDesktop(userId)
  const path = await agentRealpath(userId, checked.path)
  const raw = await agentCat(
    userId,
    `${path}/open-bot.plugin.json`,
    MAX_MANIFEST_BYTES,
  )
  const parsed = parsePluginManifest(raw)
  if (!parsed.ok) {
    throw new HttpError(
      400,
      `invalid manifest:\n${manifestIssuesText(parsed.issues)}`,
      "manifest_invalid",
    )
  }
  let readme: string | null = null
  const readmePath = `${path}/README.md`
  const readmeSize = await agentFileSize(userId, readmePath)
  if (readmeSize !== null) {
    if (readmeSize > MAX_README_BYTES) {
      throw new HttpError(400, "README.md is too large", "local_file")
    }
    readme = await agentCat(userId, readmePath, MAX_README_BYTES)
  }
  return { path, manifest: parsed.manifest, readme }
}

export async function readLocalPluginFiles(
  userId: string,
  root: string,
  manifest: PluginManifest,
): Promise<PluginToolFile[]> {
  const declared = manifest.files ?? []
  if (declared.length === 0) return []
  await requireDesktop(userId)
  const base = await agentRealpath(userId, root)
  const files: PluginToolFile[] = []
  for (const file of declared) {
    if (!isValidFileSource(file.source)) {
      throw new HttpError(
        400,
        `file ${file.source} is not a safe plugin path`,
        "local_file",
      )
    }
    const source = `${base}/${file.source}`
    const resolved = await agentRealpath(
      userId,
      source,
      `file ${file.source} is not in the plugin directory`,
    )
    if (!resolved.startsWith(`${base}/`)) {
      throw new HttpError(
        404,
        `file ${file.source} is not in the plugin directory`,
        "local_file",
      )
    }
    const content = await agentCat(userId, resolved, MAX_FILE_BYTES)
    files.push({
      name: file.name,
      content,
      exec: file.exec !== false,
    })
  }
  return files
}
