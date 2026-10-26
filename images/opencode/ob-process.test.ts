import { expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scriptPath = join(import.meta.dir, "ob-process.sh")
const script = readFileSync(scriptPath, "utf8")

test("usage covers every subcommand", () => {
  expect(script).toContain(
    "ob-process start [--name NAME] [--session SESSION] -- CMD [ARG...]",
  )
  expect(script).toContain("ob-process list [--json]")
  expect(script).toContain("ob-process log ID [--tail N]")
  expect(script).toContain("ob-process kill ID")
})

test("screen and agent infrastructure is refused", () => {
  for (const name of [
    "opencode",
    "Xvfb",
    "x11vnc",
    "websockify",
    "ttyd",
    "vncdo",
    "screen-heal",
    "ob-tab-sweep",
  ]) {
    expect(script).toContain(name)
  }
})

test("names, sessions, and ids are validated", () => {
  expect(script).toContain("*[!A-Za-z0-9._-]*) return 1")
  expect(script).toContain("*[!A-Za-z0-9_-]*) return 1")
  expect(script).toContain('*[!0-9a-f]* | "") usage')
  expect(script).toMatch(/-le 64/)
  expect(script).toMatch(/-le 128/)
})

test("the registry lives under the agent home with per-process rows", () => {
  expect(script).toContain("{HOME:-/home/agent}/.open-bot/processes")
  expect(script).toContain('os.replace(tmp, os.path.join(reg, f"{row')
})

test("pid reuse is detected through the stored starttime and pgrp", () => {
  expect(script).toContain('"startTime"')
  expect(script).toContain("int(tail[19]) == int(want)")
  expect(script).toContain("int(tail[2]) == pgid")
})

test("kill takes the process group: TERM then KILL", () => {
  expect(script).toContain("os.killpg(pgid, signal.SIGTERM)")
  expect(script).toContain("os.killpg(pgid, signal.SIGKILL)")
})

test("list prunes dead rows; their logs survive", () => {
  expect(script).toContain("os.unlink(path)")
  expect(script).toContain("the captured log survives")
})

const python3 = Bun.which("python3")

type ProcessRow = {
  id: string
  name: string
  session: string
  pid: number
  cmd: string
  startedAt: number
  uptimeSeconds: number
  cpuPercent: number | null
  rssBytes: number | null
}

function run(args: string[], home: string) {
  const proc = Bun.spawnSync(["sh", scriptPath, ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  }
}

test.skipIf(!python3)(
  "start, list, and kill manage a real process end to end",
  () => {
    const home = mkdtempSync(join(tmpdir(), "ob-process-e2e-"))
    let trackedPid = 0
    try {
      const started = JSON.parse(
        run(
          ["start", "--name", "testsrv", "--", "sleep", "30"],
          home,
        ).stdout.trim(),
      ) as { ok: boolean; id: string; pid: number; log: string }
      expect(started.ok).toBe(true)
      expect(started.id).toMatch(/^p-[0-9a-f]{8}$/)
      trackedPid = started.pid
      expect(
        existsSync(join(home, ".open-bot/processes", `${started.id}.json`)),
      ).toBe(true)
      expect(existsSync(started.log)).toBe(true)

      const rows = JSON.parse(
        run(["list", "--json"], home).stdout.trim(),
      ) as ProcessRow[]
      const row = rows.find((item) => item.id === started.id)
      expect(row?.name).toBe("testsrv")
      expect(row?.cmd).toBe("sleep 30")
      expect(typeof row?.cpuPercent).toBe("number")
      expect(row?.rssBytes ?? 0).toBeGreaterThan(0)

      const killed = JSON.parse(
        run(["kill", started.id], home).stdout.trim(),
      ) as { ok: boolean; killed: boolean }
      expect(killed.killed).toBe(true)
      trackedPid = 0

      const after = JSON.parse(
        run(["list", "--json"], home).stdout.trim(),
      ) as ProcessRow[]
      expect(after.find((item) => item.id === started.id)).toBeUndefined()
      expect(
        existsSync(join(home, ".open-bot/processes/logs", `${started.id}.log`)),
      ).toBe(true)
    } finally {
      if (trackedPid > 0) {
        try {
          process.kill(trackedPid, "SIGKILL")
        } catch {
          // already gone
        }
      }
      rmSync(home, { recursive: true, force: true })
    }
  },
)

test.skipIf(!python3)(
  "a command that exits immediately is refused and cleaned up",
  () => {
    const home = mkdtempSync(join(tmpdir(), "ob-process-dead-"))
    try {
      const result = run(["start", "--name", "dead", "--", "/bin/false"], home)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("exited immediately")
      const regDir = join(home, ".open-bot/processes")
      const rows = existsSync(regDir)
        ? readdirSync(regDir).filter((name) => name.endsWith(".json"))
        : []
      expect(rows).toHaveLength(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)

test.skipIf(!python3)("infrastructure and bad input are refused", () => {
  const home = mkdtempSync(join(tmpdir(), "ob-process-refuse-"))
  try {
    expect(
      run(["start", "--name", "x", "--", "opencode", "serve"], home).code,
    ).toBe(1)
    expect(
      run(["start", "--name", "bad name", "--", "sleep", "1"], home).code,
    ).toBe(1)
    expect(
      run(["start", "--session", "has space", "--", "sleep", "1"], home).code,
    ).toBe(1)
    expect(run(["start", "--", "sleep"], home).code).toBe(1)
    expect(run(["kill", "p-zzzzzzzz"], home).code).toBe(1)
    expect(run(["kill", "1234"], home).code).toBe(1)
    expect(run(["log", "p-ZZZZZZZZ"], home).code).toBe(1)
    expect(run(["nonsense"], home).code).toBe(1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
