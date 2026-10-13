import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "disk-cleanup.sh")
const OLD_MS = Date.now() - 5 * 86_400_000

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "disk-cleanup-"))
  const list = join(root, "screen-list.sh")
  writeFileSync(list, "#!/bin/sh\necho ses_running 2\n")
  chmodSync(list, 0o755)
  const home = join(root, "home")
  mkdirSync(join(home, ".config/chromium-threads"), { recursive: true })
  mkdirSync(join(home, ".cache/chromium-threads"), { recursive: true })
  mkdirSync(join(home, ".config/apps/chrome"), { recursive: true })
  mkdirSync(join(home, ".config/chromium/Default"), { recursive: true })
  mkdirSync(join(home, ".local/share/opencode/project/session"), {
    recursive: true,
  })
  mkdirSync(join(root, "roothome/.bun/install/cache"), { recursive: true })
  return { root, home, list }
}

function thread(home: string, name: string, ageMs = Date.now()) {
  const dir = join(home, ".config/chromium-threads", name)
  mkdirSync(join(dir, "Default"), { recursive: true })
  writeFileSync(join(dir, "Default/Preferences"), "{}")
  utimesSync(dir, new Date(ageMs), new Date(ageMs))
  return dir
}

function cacheThread(home: string, name: string, ageMs = Date.now()) {
  const dir = join(home, ".cache/chromium-threads", name)
  mkdirSync(join(dir, "Default/Cache"), { recursive: true })
  utimesSync(dir, new Date(ageMs), new Date(ageMs))
  return dir
}

function appProfile(home: string, name: string, ageMs = Date.now()) {
  const dir = join(home, ".config/apps/chrome", name)
  mkdirSync(dir, { recursive: true })
  utimesSync(dir, new Date(ageMs), new Date(ageMs))
  return dir
}

async function run(root: string, args: string[] = []) {
  const proc = Bun.spawn(["sh", script, ...args], {
    env: {
      ...process.env,
      OB_CHROME_HOME: join(root, "home"),
      OB_ROOT_HOME: join(root, "roothome"),
      OB_SCREEN_LIST: join(root, "screen-list.sh"),
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

function summary(stdout: string) {
  const lines = stdout.trim().split("\n")
  return JSON.parse(lines[lines.length - 1]) as {
    freedBytes: number
    pruned: number
    dryRun: number
    ageDays: number
  }
}

test("prunes stale thread profiles but keeps running, fresh, and canonical data", async () => {
  const { root, home } = fixture()
  const stale = thread(home, "ses_stale", OLD_MS)
  const staleCache = cacheThread(home, "ses_stale", OLD_MS)
  const fresh = thread(home, "ses_fresh")
  const running = thread(home, "ses_running", OLD_MS)
  const canonical = join(home, ".config/chromium/Default/Preferences")
  writeFileSync(canonical, "{}")
  const history = join(home, ".local/share/opencode/project/session/msg")
  writeFileSync(history, "chat")
  const result = await run(root)
  expect(result.code).toBe(0)
  expect(existsSync(stale)).toBe(false)
  expect(existsSync(staleCache)).toBe(false)
  expect(existsSync(fresh)).toBe(true)
  expect(existsSync(running)).toBe(true)
  expect(readFileSync(canonical, "utf8")).toBe("{}")
  expect(readFileSync(history, "utf8")).toBe("chat")
  expect(summary(result.stdout).pruned).toBe(2)
  expect(summary(result.stdout).ageDays).toBe(3)
  const log = readFileSync(join(home, ".open-bot/cleanup.log"), "utf8").trim()
  expect(log).toContain('"pruned":2')
})

test("prunes session-scoped app chrome profiles but not a live one", async () => {
  const { root, home } = fixture()
  const staleApp = appProfile(home, "ses_stale-work", OLD_MS)
  const runningApp = appProfile(home, "ses_running-personal", OLD_MS)
  const result = await run(root)
  expect(result.code).toBe(0)
  expect(existsSync(staleApp)).toBe(false)
  expect(existsSync(runningApp)).toBe(true)
})

test("spares a stale profile with a live user-data-dir process", async () => {
  const { root, home } = fixture()
  const dir = thread(home, "ses_stale", OLD_MS)
  const proc = Bun.spawn(
    ["sh", "-c", "sleep 5", "watcher", `--user-data-dir=${dir}`],
    { stdout: "ignore", stderr: "ignore" },
  )
  try {
    await Bun.sleep(300)
    const result = await run(root)
    expect(result.code).toBe(0)
    expect(existsSync(dir)).toBe(true)
  } finally {
    proc.kill()
    await proc.exited
  }
})

test("wipes package caches including the root-side bun cache", async () => {
  const { root, home } = fixture()
  const bunCache = join(home, ".bun/install/cache/pkg")
  mkdirSync(bunCache, { recursive: true })
  writeFileSync(join(bunCache, "f"), "x")
  const npmCache = join(home, ".npm/_cacache/content")
  mkdirSync(npmCache, { recursive: true })
  const pip = join(home, ".cache/pip/http")
  mkdirSync(pip, { recursive: true })
  const rootBun = join(root, "roothome/.bun/install/cache/pkg")
  mkdirSync(rootBun, { recursive: true })
  writeFileSync(join(rootBun, "f"), "x")
  const before = await run(root)
  expect(existsSync(join(home, ".bun/install/cache/pkg"))).toBe(false)
  expect(existsSync(join(home, ".npm/_cacache"))).toBe(false)
  expect(existsSync(join(home, ".cache/pip"))).toBe(false)
  expect(existsSync(rootBun)).toBe(false)
  expect(summary(before.stdout).freedBytes).toBeGreaterThan(0)
})

test("dry-run reports without deleting or logging", async () => {
  const { root, home } = fixture()
  const stale = thread(home, "ses_stale", OLD_MS)
  const bunCache = join(home, ".bun/install/cache/pkg")
  mkdirSync(bunCache, { recursive: true })
  writeFileSync(join(bunCache, "f"), "x")
  const result = await run(root, ["--dry-run"])
  expect(result.code).toBe(0)
  expect(summary(result.stdout).dryRun).toBe(1)
  expect(summary(result.stdout).pruned).toBeGreaterThan(0)
  expect(result.stderr).toContain("would remove")
  expect(existsSync(stale)).toBe(true)
  expect(existsSync(join(home, ".bun/install/cache/pkg"))).toBe(true)
  expect(existsSync(join(home, ".open-bot/cleanup.log"))).toBe(false)
})

test("honors --age-days", async () => {
  const { root, home } = fixture()
  const twoDaysAgo = thread(home, "ses_recent", Date.now() - 2 * 86_400_000)
  const result = await run(root, ["--age-days", "1"])
  expect(result.code).toBe(0)
  expect(existsSync(twoDaysAgo)).toBe(false)
  expect(summary(result.stdout).ageDays).toBe(1)
})

test("rejects a bad age", async () => {
  const { root } = fixture()
  const result = await run(root, ["--age-days", "soon"])
  expect(result.code).toBe(2)
})

test("removes runtime dirs for dead displays only", async () => {
  const { root, home } = fixture()
  const tmp = join(root, "tmp")
  mkdirSync(join(tmp, ".X11-unix"), { recursive: true })
  const dead = join(tmp, "open-bot-runtime-98")
  const live = join(tmp, "open-bot-runtime-99")
  mkdirSync(dead, { recursive: true })
  mkdirSync(live, { recursive: true })
  const holder = net.createServer()
  await new Promise<void>((resolve) =>
    holder.listen(join(tmp, ".X11-unix/X99"), resolve),
  )
  try {
    const proc = Bun.spawn(["sh", script], {
      env: {
        ...process.env,
        OB_CHROME_HOME: home,
        OB_ROOT_HOME: join(root, "roothome"),
        OB_SCREEN_LIST: join(root, "screen-list.sh"),
        OB_TMP_DIR: tmp,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
  } finally {
    holder.close()
  }
})
