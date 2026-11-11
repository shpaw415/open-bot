import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-sandbox.sh")

function run(args: string[], cwd: string, dry = true) {
  const proc = Bun.spawnSync(["sh", script, ...args], {
    cwd,
    env: { ...process.env, OB_SANDBOX_DRYRUN: dry ? "1" : "0" },
  })
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  }
}

describe("ob-sandbox", () => {
  test("run builds the namespace command with network isolation (#12)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-sandbox-"))
    try {
      const result = run(["run", "--", "node", "check.mjs"], dir)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("unshare --net --ipc --mount --pid")
      expect(result.stdout).toContain("timeout 120")
      expect(result.stdout).toContain("node check.mjs")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("run validates bounds and requires a command", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-sandbox-"))
    try {
      expect(run(["run"], dir).code).toBe(2)
      expect(run(["run", "--timeout", "0", "--", "true"], dir).code).toBe(2)
      expect(run(["run", "--mem", "10", "--", "true"], dir).code).toBe(2)
      expect(run(["run", "--timeout", "x", "--", "true"], dir).code).toBe(2)
      expect(run(["nope"], dir).code).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("check probes egress, DNS, and both write directions", async () => {
    const source = await Bun.file(script).text()
    expect(source).toContain("1.1.1.1")
    expect(source).toContain("getaddrinfo")
    expect(source).toContain("sandbox-ok")
    expect(source).toContain("remount,ro,bind")
  })
})
