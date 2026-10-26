// Entrypoint helper: merge the CLI bridge provider entries into
// ~/.config/opencode/opencode.json. Runs as the agent user on every
// boot; idempotent, preserves every other key.
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { mergeCliProviderConfig } from "./providers"
import { syncCliSkills } from "./server"

const path =
  process.env.OPEN_BOT_OPENCODE_CONFIG ??
  join(homedir(), ".config", "opencode", "opencode.json")

let config: unknown = {}
try {
  config = JSON.parse(readFileSync(path, "utf8"))
} catch {
  config = {}
}
const merged = mergeCliProviderConfig(config)
writeFileSync(path, `${JSON.stringify(merged)}\n`)
// Seed both CLI skill roots so interactive claude/muse use inside the
// desktop sees the same skills before the first bridged turn.
try {
  syncCliSkills({ home: process.env.HOME || homedir(), config: merged })
} catch {
  // per-run sync retries before every chat request
}
