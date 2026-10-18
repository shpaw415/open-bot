import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
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
import { isDevVersion, type PluginFile } from "@open-bot/plugin-kit"
import { dataDir, marketplaceToken, marketplaceUrl } from "./env"
import { HttpError } from "./http-error"

const MARKET_KEY_SETTING = "marketplace_api_key"
// Lives on the DATA_DIR volume so cached tarballs survive control container
// recreates (every update) and boot re-syncs do not re-download from the
// marketplace.
const CACHE_DIR = join(dataDir, "plugin-artifacts")
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
const ARTIFACT_TIMEOUT_MS = 60_000

function marketToken(db: Db): string {
  return db.getSetting(MARKET_KEY_SETTING) || marketplaceToken
}

// The auth token for one artifact fetch: the installing user's marketplace
// API key when they set one (paid-plugin licenses belong to their account),
// falling back to the instance-wide key.
function artifactToken(db: Db, userId?: string): string {
  const userKey = userId
    ? (db.userById(userId)?.marketplaceApiKey ?? null)
    : null
  return userKey || marketToken(db)
}

// Downloads the security-reviewed release tarball for one plugin version from
// the marketplace (R2-backed), verifies it against the sha256 recorded at
// review time, and caches it in the control container so desktop boots do not
// re-download it. Paid plugins 402 unless the resolved token's user holds a
// purchase — `userId` selects whose marketplace key rides along.
export async function fetchPluginArtifact(
  db: Db,
  pluginId: string,
  version: string,
  userId?: string,
): Promise<{ tarballPath: string; sha256: string }> {
  const token = artifactToken(db, userId)
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
  // Dev tags are mutable (republish overwrites the marketplace tarball), so
  // they bypass the cache and always re-download; stable versions are cached.
  if (!isDevVersion(version) && existsSync(cached) && existsSync(cachedSha)) {
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
      const parsed = JSON.parse(text) as {
        error?: string
        code?: string
        priceCents?: number
      }
      if (parsed.error) message = parsed.error
    } catch {
      // keep raw text
    }
    // 402 = unlicensed paid plugin: surfaced to the dashboard so it can offer
    // the marketplace purchase flow.
    throw new HttpError(
      response.status === 404 ? 404 : response.status === 402 ? 402 : 502,
      message || `artifact request failed (${response.status})`,
      response.status === 402 ? "purchase_required" : "marketplace_error",
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
  if (!declared || declared !== sha256) {
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

// The installed name of the built dashboard UI (manifest dashboard.pages.ui):
// one self-contained HTML file the frozen page server serves via
// OPEN_BOT_PAGE_UI. Local installs never build it — the checkout imports the
// HTML live under bun --hot.
export const PLUGIN_UI_FILE_NAME = "ui.html"

const MAX_UI_BUNDLE_BYTES = 8 * 1024 * 1024
const UI_BUILD_TIMEOUT_MS = 60_000

// Extracts the manifest-declared files from the unpacked release tarball.
// The tarball has a single GitHub root directory; sources are repo-relative
// below it. Payload files must be text (scripts, configs, small assets).
// With `uiSource` (manifest dashboard.pages.ui), the same unpack also runs
// `bun build --compile --target=browser` on the frontend entry and appends
// the single-file HTML bundle as PLUGIN_UI_FILE_NAME — the frozen install
// then needs no relative file structure at all.
export function extractPluginFiles(
  tarballPath: string,
  files: PluginFile[],
  uiSource?: string | null,
): PluginArtifactFile[] {
  if (files.length === 0 && !uiSource) return []
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
    const resolved = files.map((file) => {
      const source = join(root, file.source)
      if (
        !source.startsWith(`${root}/`) ||
        !existsSync(source) ||
        lstatSync(source).isSymbolicLink() ||
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
    if (uiSource) resolved.push(buildPluginUi(root, uiSource))
    return resolved
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Bun's HTML bundler emits <script src>-derived code as deferred
// <script type="module"> blocks while inline classic scripts stay in place —
// and deferred modules always execute after every classic script, no matter
// where each tag sits. Page code that consumes vendor globals (the classic
// <script src> library pattern) would therefore run before its dependencies.
// When both kinds exist, rewrite the classic inline bodies into one module
// script placed after the last module script: deferred scripts execute in
// document order, restoring "vendors first, then page code". Classic
// top-level var/function declarations stay shared across the merged body;
// non-executable typed scripts (importmap, application/json, ...) and
// external URL scripts are left untouched.
export function fixUiScriptOrder(html: string): string {
  const scriptRe = /<script\b[^>]*\/>|<script\b[^>]*>([\s\S]*?)<\/script>/gi
  const openRe = /<script\b[^>]*>?/i
  type Block = {
    start: number
    end: number
    kind: "module" | "classic" | "skip"
    body: string
  }
  const blocks: Block[] = []
  for (const match of html.matchAll(scriptRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const open = openRe.exec(match[0])?.[0] ?? ""
    const src = /\ssrc\s*=/i.test(open)
    const type =
      /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
        .exec(open)
        ?.slice(1)
        .find((part) => part !== undefined)
        ?.toLowerCase() ?? ""
    const body = match[1] ?? ""
    let kind: Block["kind"] = "skip"
    if (!src && (type === "" || type === "text/javascript")) {
      kind = body.trim() === "" ? "skip" : "classic"
    } else if (!src && type === "module" && body.trim() !== "") {
      kind = "module"
    }
    blocks.push({ start, end, kind, body })
  }
  const classics = blocks.filter((block) => block.kind === "classic")
  const modules = blocks.filter((block) => block.kind === "module")
  if (classics.length === 0 || modules.length === 0) return html
  // Rebuild the document without the classic inline blocks, tracking where
  // the last module script ends — the insertion point for the merged body.
  let out = ""
  let insertAt = -1
  let cursor = 0
  for (const block of blocks) {
    if (block.kind === "classic") {
      out += html.slice(cursor, block.start)
      cursor = block.end
      continue
    }
    out += html.slice(cursor, block.end)
    cursor = block.end
    if (block.kind === "module") insertAt = out.length
  }
  out += html.slice(cursor)
  const merged =
    `<script type="module">` +
    classics.map((block) => block.body).join("\n;\n") +
    `</script>`
  return out.slice(0, insertAt) + merged + out.slice(insertAt)
}

// Bundles one frontend entry (inside the unpacked artifact root) into a
// single self-contained HTML file. Bun inlines every script/stylesheet/asset
// the entry references by relative path; external URLs stay untouched. The
// build is static (no code runs), so untrusted frontend sources are safe to
// bundle — the same property the security review relies on reading them.
function buildPluginUi(root: string, uiSource: string): PluginArtifactFile {
  const entry = join(root, uiSource)
  if (
    !entry.startsWith(`${root}/`) ||
    !existsSync(entry) ||
    !statSync(entry).isFile()
  ) {
    throw new HttpError(
      404,
      `file ${uiSource} is not in the plugin artifact`,
      "artifact_file",
    )
  }
  const out = mkdtempSync(join(tmpdir(), "ob-ui-build-"))
  try {
    // process.execPath is the control container's own bun — no PATH lookup.
    const build = Bun.spawnSync(
      [
        process.execPath,
        "build",
        "--compile",
        "--target=browser",
        entry,
        "--outdir",
        out,
      ],
      { timeout: UI_BUILD_TIMEOUT_MS },
    )
    if (build.exitCode !== 0) {
      const detail =
        build.stderr.toString().trim() || build.stdout.toString().trim()
      throw new HttpError(
        400,
        `could not build the dashboard UI (${uiSource}): ${detail.slice(0, 400)}`,
        "ui_build_failed",
      )
    }
    const produced = readdirSync(out).filter((name) => name.endsWith(".html"))
    if (produced.length !== 1) {
      throw new HttpError(
        502,
        `the dashboard UI build produced ${produced.length} HTML files`,
        "ui_build_failed",
      )
    }
    const built = readFileSync(join(out, produced[0]), "utf8")
    const content = fixUiScriptOrder(built)
    if (content.length === 0) {
      throw new HttpError(
        502,
        "the dashboard UI build produced an empty file",
        "ui_build_failed",
      )
    }
    if (Buffer.byteLength(content) > MAX_UI_BUNDLE_BYTES) {
      throw new HttpError(
        400,
        `the dashboard UI bundle is larger than ${MAX_UI_BUNDLE_BYTES} bytes — inline fewer or smaller assets`,
        "ui_build_size",
      )
    }
    return { name: PLUGIN_UI_FILE_NAME, content, exec: false }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
