import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { basename } from "node:path"

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
    OPEN_BOT_PLUGIN_ID: basename(cwd),
  },
})
child.unref()
if (!child.pid) process.exit(1)
console.log(child.pid)
