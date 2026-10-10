import { spawn } from "node:child_process"
import { openSync } from "node:fs"

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
  env: process.env,
})
child.unref()
if (!child.pid) process.exit(1)
console.log(child.pid)
