import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Db } from "@open-bot/db"
import type { PluginFile } from "@open-bot/plugin-kit"
import { marketplaceToken, marketplaceUrl } from "./env"
import { HttpError } from "./http-error"

const MARKET_KEY_SETTING = "marketplace_api_key"
const CACHE_DIR = join(tmpdir(), "open-bot-plugin-artifacts")
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
const ARTIFACT_TIMEOUT_MS = 60_000

function marketToken(db: Db): string {
  return db.getSetting(MARKET_KEY_SETTING) || marketplaceToken
}

// Downloads the security-reviewed release tarball for one plugin version from
// the marketplace (R2-backed), verifies it against the sha256 recorded at
// review time, and caches it in the control container so desktop boots do not
// re-download it.
export async function fetchPluginArtifact(
  db: Db,
  pluginId: string,
  version: string,
): Promise<{ tarballPath: string; sha256: string }> {
  const token = marketToken(db)
  if (marketplaceUrl === "" || token === "") {
    throw new HttpError(
      503,
      "the plugin marketplace is not configured on this instance",
      "marketplace_unconfigured",
    )
  }
  const safeVersion = version.replace(/[^\w.-]/g, "")
  const cached = join(CACHE_DIR, `${pluginId}-${safeVersion}.tgz`)
  const cachedSha = `${cached}.sha256`
  if (existsSync(cached) && existsSync(cachedSha)) {
    return {
      tarballPath: cached,
      sha256: readFileSync(cachedSha, "utf8").trim(),
    }
  }
  let response: Response
  try {
    response = await fetch(
      `${marketplaceUrl}/api/plugins/${encodeURIComponent(pluginId)}/artifact?version=${encodeURIComponent(version)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
      },
    )
  } catch (error) {
    throw new HttpError(
      502,
      `marketplace unreachable: ${
        error instanceof Error ? error.message : "request failed"
      }`,
      "marketplace_unreachable",
    )
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    let message = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      // keep raw text
    }
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      message || `artifact request failed (${response.status})`,
      "marketplace_error",
    )
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ARTIFACT_BYTES) {
    throw new HttpError(502, "artifact size is out of bounds", "artifact_size")
  }
  const sha256 = createHash("sha256")
    .update(new Uint8Array(buffer))
    .digest("hex")
  const declared = response.headers.get("x-artifact-sha256") ?? ""
  if (declared && declared !== sha256) {
    throw new HttpError(
      502,
      "plugin artifact does not match its reviewed sha256",
      "artifact_hash",
    )
  }
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cached, Buffer.from(buffer))
  writeFileSync(cachedSha, `${sha256}\n`)
  return { tarballPath: cached, sha256 }
}

export type PluginArtifactFile = {
  name: string
  content: string
  exec: boolean
}

// Extracts the manifest-declared files from the unpacked release tarball.
// The tarball has a single GitHub root directory; sources are repo-relative
// below it. Payload files must be text (scripts, configs, small assets).
export function extractPluginFiles(
  tarballPath: string,
  files: PluginFile[],
): PluginArtifactFile[] {
  if (files.length === 0) return []
  const dir = mkdtempSync(join(tmpdir(), "ob-artifact-"))
  try {
    const tar = Bun.spawnSync(["tar", "-xzf", tarballPath, "-C", dir])
    if (tar.exitCode !== 0) {
      throw new HttpError(
        502,
        "could not unpack the plugin artifact",
        "artifact_unpack",
      )
    }
    const entries = readdirSync(dir)
    const rootName = entries[0]
    if (entries.length !== 1 || !rootName) {
      throw new HttpError(
        502,
        "plugin artifact has an unexpected layout",
        "artifact_layout",
      )
    }
    const root = join(dir, rootName)
    if (!statSync(root).isDirectory()) {
      throw new HttpError(
        502,
        "plugin artifact has an unexpected layout",
        "artifact_layout",
      )
    }
    return files.map((file) => {
      const source = join(root, file.source)
      if (
        !source.startsWith(`${root}/`) ||
        !existsSync(source) ||
        !statSync(source).isFile()
      ) {
        throw new HttpError(
          404,
          `file ${file.source} is not in the plugin artifact`,
          "artifact_file",
        )
      }
      return {
        name: file.name,
        content: readFileSync(source, "utf8"),
        exec: file.exec !== false,
      }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
