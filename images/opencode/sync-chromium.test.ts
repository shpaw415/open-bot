import { expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "sync-chromium.sh")

function profile(root: string, name: string) {
  const dir =
    name === "canonical"
      ? join(root, ".config/chromium")
      : join(root, ".config/chromium-threads", name)
  mkdirSync(join(dir, "Default/Network"), { recursive: true })
  return dir
}

async function run(root: string, args: string[]) {
  const proc = Bun.spawn(["sh", script, ...args], {
    env: { ...process.env, OB_CHROME_HOME: root },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stderr }
}

test("seeds an empty thread from the newer profile and skips locks", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrome-sync-"))
  const older = profile(root, "canonical")
  writeFileSync(join(older, "Default/Network/Cookies"), "old")
  utimesSync(join(older, "Default/Network/Cookies"), 1, 1)
  const newer = profile(root, "thread-a")
  writeFileSync(join(newer, "Default/Network/Cookies"), "facebook")
  utimesSync(join(newer, "Default/Network/Cookies"), 2, 2)
  symlinkSync("/tmp/missing-singleton", join(newer, "SingletonLock"))
  const seeded = await run(root, ["pull", "thread-b"])
  expect(seeded.code).toBe(0)
  const target = join(root, ".config/chromium-threads/thread-b")
  expect(readFileSync(join(target, "Default/Network/Cookies"), "utf8")).toBe(
    "facebook",
  )
  expect(() => readFileSync(join(target, "SingletonLock"))).toThrow()
  expect(readFileSync(join(older, "Default/Network/Cookies"), "utf8")).toBe(
    "facebook",
  )
})

test("leaves an existing thread profile alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrome-sync-"))
  const source = profile(root, "thread-a")
  writeFileSync(join(source, "Default/Preferences"), '{"account":"google"}')
  const target = profile(root, "thread-b")
  writeFileSync(join(target, "Default/Preferences"), '{"account":"kept"}')
  const seeded = await run(root, ["pull", "thread-b"])
  expect(seeded.code).toBe(0)
  expect(readFileSync(join(target, "Default/Preferences"), "utf8")).toBe(
    '{"account":"kept"}',
  )
})

test("writes a stopped thread back to the desktop profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrome-sync-"))
  const thread = profile(root, "thread-a")
  writeFileSync(join(thread, "Default/Login Data"), "saved")
  const pushed = await run(root, ["push", "thread-a"])
  expect(pushed.code).toBe(0)
  expect(
    readFileSync(join(root, ".config/chromium/Default/Login Data"), "utf8"),
  ).toBe("saved")
  expect(() =>
    readFileSync(join(root, ".config/chromium/SingletonLock")),
  ).toThrow()
})
