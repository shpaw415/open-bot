import { spawn } from "node:child_process"
import { existsSync, openSync, readFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"

const MANIFEST_FILE = "open-bot.plugin.json"
// Directory names that are plumbing, never a plugin id: a checkout served
// from its server/ entry used to run as plugin "server" (#120).
const GENERIC_DIRS = new Set(["server", "src", "app", "dist", "public"])

function manifestId(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = `${dir}/${MANIFEST_FILE}`
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
          id?: unknown
        }
        if (
          typeof parsed.id === "string" &&
          /^[a-z0-9][a-z0-9-]*$/.test(parsed.id)
        )
          return parsed.id
      } catch {
        // an unparseable manifest falls through to the directory rules
      }
      return null
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The OPEN_BOT_PLUGIN_ID a previewed page server must see so the preview
 * reproduces production (config `~/.config/open-bot/plugin-<id>.json`,
 * data `pages-data/<id>/`): an explicit env already set wins, then the
 * nearest plugin manifest above the entry or cwd, then the directory name
 * — skipping generic plumbing dirs in favor of their parent.
 */
export function resolvePluginId(
  cwd: string,
  entry: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.OPEN_BOT_PLUGIN_ID?.trim()
  if (explicit) return explicit
  const starts = entry ? [dirname(resolve(cwd, entry)), cwd] : [cwd]
  for (const start of starts) {
    const id = manifestId(start)
    if (id) return id
  }
  const name = basename(resolve(cwd))
  if (GENERIC_DIRS.has(name)) return basename(dirname(resolve(cwd)))
  return name
}

if (import.meta.main) {
  const log = process.argv[2] ?? ""
  const entry = process.argv[3] ?? ""
  const cwd = process.argv[4] ?? "/home/agent/workspace"
  if (!log) {
    console.error("usage: preview-spawn.ts LOG [ENTRY] [CWD]")
    process.exit(2)
  }
  const fd = openSync(log, "a")
  const args = entry
    ? ["--hot", entry]
    : ["--hot", "/opt/open-bot/preview-server.ts"]
  const child = spawn("bun", args, {
    cwd,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      // Plugin page servers read OPEN_BOT_PAGE_* instead of PORT/HOST —
      // mirroring them here runs the exact production server.ts on the preview
      // port, unchanged.
      OPEN_BOT_PAGE_PORT: process.env.PORT ?? "",
      OPEN_BOT_PAGE_TOKEN: "dev-preview",
      // Preview is the owner's own dev surface: owner routes stay reachable
      // with the same dev-preview convention as the page token.
      OPEN_BOT_PAGE_OWNER_TOKEN: "dev-preview",
      OPEN_BOT_PLUGIN_ID: resolvePluginId(cwd, entry),
    },
  })
  child.unref()
  if (!child.pid) process.exit(1)
  console.log(child.pid)
}
