import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "restore-apt.sh")

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "restore-apt-"))
  const bin = join(root, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, "apt-get"),
    [
      "#!/bin/sh",
      "mode=",
      'for a in "$@"; do',
      '  case "$a" in',
      "    update|install) mode=$a ;;",
      "  esac",
      "done",
      'printf \'%s\\n\' "$mode $*" >>"$APT_LOG"',
      'if [ "$mode" = update ] && [ "$APT_FAIL_UPDATE" = "1" ]; then',
      "  exit 1",
      "fi",
      "exit 0",
    ].join("\n"),
  )
  writeFileSync(
    join(bin, "dpkg"),
    [
      "#!/bin/sh",
      "pkg=$2",
      'if [ -f "$DPKG_INSTALLED" ] && grep -Fxq "$pkg" "$DPKG_INSTALLED"; then',
      "  exit 0",
      "fi",
      "exit 1",
    ].join("\n"),
  )
  chmodSync(join(bin, "apt-get"), 0o755)
  chmodSync(join(bin, "dpkg"), 0o755)
  const log = join(root, "apt.log")
  writeFileSync(log, "")
  const installed = join(root, "installed.txt")
  writeFileSync(installed, "")
  const baseline = join(root, "baseline")
  writeFileSync(baseline, "")
  return { root, log, installed, baseline }
}

async function run(
  f: ReturnType<typeof fixture>,
  opts: { extra?: string; snapshot?: string; failUpdate?: boolean } = {},
) {
  const env: Record<string, string> = {
    ...process.env,
    PATH: `${join(f.root, "bin")}:${process.env.PATH}`,
    OPEN_BOT_APT_BASELINE: f.baseline,
    OPEN_BOT_APT_EXTRA: join(f.root, "extra"),
    OPEN_BOT_APT_SNAPSHOT: join(f.root, "snapshot"),
    APT_LOG: f.log,
    DPKG_INSTALLED: f.installed,
  }
  if (opts.extra !== undefined) writeFileSync(join(f.root, "extra"), opts.extra)
  if (opts.snapshot !== undefined)
    writeFileSync(join(f.root, "snapshot"), opts.snapshot)
  if (opts.failUpdate) env.APT_FAIL_UPDATE = "1"
  const proc = Bun.spawn(["sh", script], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await proc.exited
  return { code }
}

function modes(log: string) {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[0])
}

test("refreshes the indexes even when nothing is missing", async () => {
  const f = fixture()
  const result = await run(f)
  expect(result.code).toBe(0)
  expect(modes(f.log)).toEqual(["update"])
})

test("installs missing extra packages after the update", async () => {
  const f = fixture()
  writeFileSync(f.installed, "htop\n")
  const result = await run(f, { extra: "htop\nfiglet\n" })
  expect(result.code).toBe(0)
  expect(modes(f.log)).toEqual(["update", "install"])
  const lines = readFileSync(f.log, "utf8").trim().split("\n")
  expect(lines[1]).toContain(" figlet")
  expect(lines[1]).not.toContain("htop")
})

test("skips installed snapshot-only packages and filters invalid names", async () => {
  const f = fixture()
  writeFileSync(f.baseline, "base-pkg\n")
  writeFileSync(f.installed, "base-pkg\nsnap-pkg\n")
  const result = await run(f, {
    extra: "snap-pkg\ngood.pkg+x\nbad;pkg\n",
    snapshot: "base-pkg\nsnap-pkg\n",
  })
  expect(result.code).toBe(0)
  expect(modes(f.log)).toEqual(["update", "install"])
  const lines = readFileSync(f.log, "utf8").trim().split("\n")
  expect(lines[1]).toContain("good.pkg+x")
  expect(lines[1]).not.toContain("snap-pkg")
  expect(lines[1]).not.toContain("bad;pkg")
  expect(lines[1]).not.toContain("base-pkg")
})

test("fails without installing when the update fails", async () => {
  const f = fixture()
  const result = await run(f, { extra: "figlet\n", failUpdate: true })
  expect(result.code).not.toBe(0)
  expect(modes(f.log)).toEqual(["update"])
})
