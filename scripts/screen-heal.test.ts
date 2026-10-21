import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Shell-fixture tests for the per-thread screen scripts: heal must recover a
// Chromium that died (e.g. ob-chrome closetab on the last tab exits the
// browser) instead of refusing because the session's own Xvfb row "holds"
// the display, and screen-up must reclaim a display claim whose owner has no
// live Xvfb while still refusing a genuinely live one.

const HEAL_SRC = join(import.meta.dir, "..", "images/opencode/screen-heal.sh")
const UP_SRC = join(import.meta.dir, "..", "images/opencode/screen-up.sh")

type Sandbox = {
  tmp: string
  bin: string
  run: string
  home: string
  profiles: string
  x11: string
  state: string
  listFile: string
  pgrepExtra: string
  sudoLog: string
  fakeLog: string
  logFile: string
  servers: ReturnType<typeof Bun.listen>[]
  helpers: Bun.Subprocess[]
}

function rewrite(source: string, s: Sandbox): string {
  return source
    .replaceAll("/run/open-bot/screens", s.run)
    .replaceAll("/home/agent/.open-bot", s.home)
    .replaceAll("/home/agent/.config/chromium-threads", s.profiles)
    .replaceAll("/tmp/.X11-unix", s.x11)
    .replaceAll("/tmp/open-bot-", `${s.state}/open-bot-`)
    .replaceAll("/opt/open-bot/screen-list.sh", join(s.bin, "screen-list.sh"))
    .replaceAll("/opt/open-bot/screen-up.sh", join(s.bin, "screen-up.sh"))
    .replaceAll(
      "/opt/open-bot/sync-chromium.sh",
      join(s.bin, "sync-chromium.sh"),
    )
    .replaceAll(
      "/opt/google/chrome/google-chrome",
      "/nonexistent-google-chrome",
    )
}

function shim(s: Sandbox, name: string, body: string) {
  const path = join(s.bin, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

async function makeSandbox(): Promise<Sandbox> {
  const tmp = mkdtempSync(join(tmpdir(), "screen-heal-test-"))
  const s: Sandbox = {
    tmp,
    bin: join(tmp, "bin"),
    run: join(tmp, "run"),
    home: join(tmp, "home", ".open-bot"),
    profiles: join(tmp, "profiles"),
    x11: join(tmp, "X11-unix"),
    state: join(tmp, "state"),
    listFile: join(tmp, "screen-list.txt"),
    pgrepExtra: join(tmp, "pgrep-extra.txt"),
    sudoLog: join(tmp, "sudo.log"),
    fakeLog: join(tmp, "fake.log"),
    logFile: join(tmp, "home", ".open-bot", "screens.log"),
    servers: [],
    helpers: [],
  }
  for (const dir of [s.bin, s.run, s.home, s.profiles, s.x11, s.state]) {
    mkdirSync(dir, { recursive: true })
  }
  // Command shims. pgrep/pkill restrict their /proc scan to processes whose
  // cmdline mentions the sandbox, so a host Xvfb on the same display number
  // can never flip a test.
  shim(
    s,
    "pgrep",
    `[ "$1" = "-f" ] || exit 1
pattern=$2
if [ -s "$PGREP_EXTRA" ] && grep -Eq -- "$pattern" "$PGREP_EXTRA"; then exit 0; fi
for d in /proc/[0-9]*; do
  [ -r "$d/cmdline" ] || continue
  # real pgrep never reports itself; the shim's own argv holds the pattern
  [ "$d" = "/proc/$$" ] && continue
  cmd=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
  case "$cmd" in *"$SANDBOX"*) ;; *) continue ;; esac
  printf '%s' "$cmd" | grep -Eq -- "$pattern" && exit 0
done
exit 1`,
  )
  shim(
    s,
    "pkill",
    `[ "$1" = "-f" ] || exit 0
pattern=$2
for d in /proc/[0-9]*; do
  [ -r "$d/cmdline" ] || continue
  [ "$d" = "/proc/$$" ] && continue
  cmd=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
  case "$cmd" in *"$SANDBOX"*) ;; *) continue ;; esac
  printf '%s' "$cmd" | grep -Eq -- "$pattern" && kill "\${d#/proc/}" 2>/dev/null || true
done
exit 0`,
  )
  shim(
    s,
    "sudo",
    `[ "$1" = "-n" ] && shift
printf '%s\\n' "$*" >> "$SUDO_LOG"
exec "$@"`,
  )
  shim(s, "curl", "exit 0")
  shim(
    s,
    "runuser",
    `while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$1" = "--" ] && shift
exec "$@"`,
  )
  shim(s, "chown", "exit 0")
  shim(
    s,
    "chromium",
    `printf 'chromium %s\\n' "$*" >> "$FAKE_LOG"
exec sleep 4`,
  )
  shim(
    s,
    "openbox",
    `printf 'openbox %s\\n' "$*" >> "$FAKE_LOG"
exec sleep 4`,
  )
  const xvfb = join(s.bin, "xvfb-fake.js")
  writeFileSync(
    xvfb,
    `const display = (process.argv[2] ?? ":0").replace(/^:/, "")
await Bun.listen({
  unix: \`\${process.env.FAKE_X11}/X\${display}\`,
  socket: { open() {}, data() {}, close() {}, error() {} },
})
setTimeout(() => process.exit(0), 6000)
`,
  )
  shim(s, "Xvfb", `exec bun "${xvfb}" "$@"`)
  shim(s, "screen-list.sh", 'cat "$SCREEN_LIST_FIXTURE" 2>/dev/null || true')
  shim(
    s,
    "sync-chromium.sh",
    'printf \'sync %s\\n\' "$*" >> "$FAKE_LOG"\nexit 0',
  )
  writeFileSync(
    join(s.bin, "screen-up.sh"),
    rewrite(await Bun.file(UP_SRC).text(), s),
  )
  chmodSync(join(s.bin, "screen-up.sh"), 0o755)
  writeFileSync(
    join(s.bin, "screen-heal.sh"),
    rewrite(await Bun.file(HEAL_SRC).text(), s),
  )
  chmodSync(join(s.bin, "screen-heal.sh"), 0o755)
  return s
}

function cleanup(s: Sandbox) {
  for (const helper of s.helpers) helper.kill()
  for (const server of s.servers) server.stop(true)
  rmSync(s.tmp, { recursive: true, force: true })
}

function socketAt(s: Sandbox, display: number) {
  const server = Bun.listen({
    unix: join(s.x11, `X${display}`),
    socket: { open() {}, data() {}, close() {}, error() {} },
  })
  s.servers.push(server)
  return server
}

// A live pid for xvfb.pid (the heal fast path and screen-up's relaunch
// branch both require one).
function livePid(s: Sandbox): number {
  const helper = Bun.spawn(["sleep", "30"])
  s.helpers.push(helper)
  return helper.pid
}

function writeRunDir(
  s: Sandbox,
  session: string,
  display: number,
  pid: number,
) {
  const dir = join(s.run, session)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "display"), String(display))
  writeFileSync(join(dir, "xvfb.pid"), String(pid))
  writeFileSync(join(dir, "last-active"), "")
}

async function run(
  s: Sandbox,
  script: "screen-heal.sh" | "screen-up.sh",
  ...args: string[]
) {
  const proc = Bun.spawn(["sh", join(s.bin, script), ...args], {
    cwd: s.tmp,
    env: {
      ...process.env,
      PATH: `${s.bin}:${process.env.PATH ?? ""}`,
      SANDBOX: s.tmp,
      PGREP_EXTRA: s.pgrepExtra,
      SUDO_LOG: s.sudoLog,
      FAKE_LOG: s.fakeLog,
      SCREEN_LIST_FIXTURE: s.listFile,
      FAKE_X11: s.x11,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

test("closing the last tab heals on the next CLI call instead of refusing", async () => {
  const s = await makeSandbox()
  try {
    const pid = livePid(s)
    writeRunDir(s, "ses_a", 3, pid)
    socketAt(s, 3)
    mkdirSync(join(s.home, "cdp"), { recursive: true })
    writeFileSync(join(s.home, "cdp", "ses_a"), "9225")
    writeFileSync(s.listFile, `ses_a 3 4711\n`)
    writeFileSync(s.pgrepExtra, "")
    const result = await run(s, "screen-heal.sh", "ses_a")
    expect(result.stderr).not.toContain("taken by another session")
    expect(result.code).toBe(0)
    // The heal drove screen-up (via sudo), which relaunched Chromium on the
    // still-live Xvfb, and the heal confirmed the CDP port came back.
    expect(await Bun.file(s.sudoLog).text()).toContain(`screen-up.sh ses_a 3`)
    expect(await Bun.file(s.fakeLog).text()).toContain("chromium")
    expect(await Bun.file(s.logFile).text()).toContain(" up ses_a relaunch")
    expect(await Bun.file(s.logFile).text()).toContain(
      "heal ses_a ok display:3",
    )
  } finally {
    cleanup(s)
  }
}, 20000)

test("another live session holding the display still blocks the heal", async () => {
  const s = await makeSandbox()
  try {
    const pid = livePid(s)
    writeRunDir(s, "ses_a", 3, pid)
    socketAt(s, 3)
    mkdirSync(join(s.home, "cdp"), { recursive: true })
    writeFileSync(join(s.home, "cdp", "ses_a"), "9225")
    writeFileSync(s.listFile, `ses_b 3 4711\n`)
    writeFileSync(s.pgrepExtra, "")
    const result = await run(s, "screen-heal.sh", "ses_a")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("display 3 is taken by another session")
    expect(await Bun.file(s.logFile).text()).toContain(
      "heal ses_a refused display:3",
    )
    expect(await Bun.file(s.sudoLog).exists()).toBe(false)
  } finally {
    cleanup(s)
  }
}, 20000)

test("a healthy screen exits the fast path without healing", async () => {
  const s = await makeSandbox()
  try {
    const pid = livePid(s)
    writeRunDir(s, "ses_a", 3, pid)
    socketAt(s, 3)
    mkdirSync(join(s.home, "cdp"), { recursive: true })
    writeFileSync(join(s.home, "cdp", "ses_a"), "9225")
    writeFileSync(s.listFile, "")
    writeFileSync(s.pgrepExtra, `user-data-dir=${s.profiles}/ses_a\n`)
    const result = await run(s, "screen-heal.sh", "ses_a")
    expect(result.code).toBe(0)
    expect(await Bun.file(s.sudoLog).exists()).toBe(false)
    expect(await Bun.file(s.fakeLog).exists()).toBe(false)
  } finally {
    cleanup(s)
  }
}, 20000)

test("screen-up refuses a display held by another live session", async () => {
  const s = await makeSandbox()
  try {
    writeRunDir(s, "ses_b", 3, livePid(s))
    socketAt(s, 3)
    writeFileSync(s.pgrepExtra, "Xvfb :3 -screen 0 1920x1200x24\n")
    const result = await run(s, "screen-up.sh", "ses_a", "3")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("display 3 is in use by another session")
    expect(await Bun.file(s.logFile).text()).toContain(
      "refused ses_a owner:ses_b",
    )
  } finally {
    cleanup(s)
  }
}, 20000)

test("screen-up reclaims a stale claim whose owner has no live Xvfb", async () => {
  const s = await makeSandbox()
  try {
    // ses_b's claim + socket survive (crashed container), but no Xvfb is
    // alive on the display: the takeover must proceed, not refuse.
    writeRunDir(s, "ses_b", 3, 99999999)
    socketAt(s, 3)
    writeFileSync(s.pgrepExtra, "")
    const result = await run(s, "screen-up.sh", "ses_a", "3")
    expect(result.stderr).not.toContain("in use by another session")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ok 3")
    expect(
      (await Bun.file(join(s.run, "ses_a", "display")).text()).trim(),
    ).toBe("3")
    const log = await Bun.file(s.fakeLog).text()
    expect(log).toContain("chromium")
    expect(await Bun.file(s.logFile).text()).toContain(" up ses_a start")
  } finally {
    cleanup(s)
  }
}, 30000)

test("a same-session display claim never blocks its own screen-up", async () => {
  const s = await makeSandbox()
  try {
    // Own run_dir claims display 3 with a stale pid and no socket: the
    // ownership loop skips it and the takeover restarts the screen.
    writeRunDir(s, "ses_a", 3, 99999999)
    writeFileSync(s.pgrepExtra, "")
    const result = await run(s, "screen-up.sh", "ses_a", "3")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ok 3")
    expect(await Bun.file(s.fakeLog).text()).toContain("chromium")
  } finally {
    cleanup(s)
  }
}, 30000)
