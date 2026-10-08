import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "apply-chat-auth.sh")

function authPath(home: string) {
  return join(home, ".local/share/opencode/auth.json")
}

async function run(home: string, payload: string) {
  const proc = Bun.spawn(["sh", script], {
    env: { ...process.env, HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin.write(payload)
  await proc.stdin.end()
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

function readAuth(home: string) {
  return JSON.parse(readFileSync(authPath(home), "utf8"))
}

test("seeds api entries into a missing auth store", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-chat-"))
  const result = await run(
    home,
    JSON.stringify({ entries: [{ provider: "openai", key: "sk-1" }] }),
  )
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    changed: ["openai"],
    removed: [],
  })
  expect(readAuth(home)).toEqual({ openai: { type: "api", key: "sk-1" } })
  expect(statSync(authPath(home)).mode & 0o777).toBe(0o600)
})

test("an identical key is a no-op and oauth entries are never touched", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-chat-"))
  await run(
    home,
    JSON.stringify({
      entries: [
        { provider: "openai", key: "sk-1" },
        { provider: "anthropic", key: "ignored" },
      ],
    }),
  )
  const manual = {
    openai: { type: "api", key: "sk-1" },
    anthropic: { type: "oauth", access: "tok", refresh: "r" },
  }
  await Bun.write(authPath(home), JSON.stringify(manual))
  const result = await run(
    home,
    JSON.stringify({
      entries: [
        { provider: "openai", key: "sk-1" },
        { provider: "anthropic", key: "new-key" },
      ],
    }),
  )
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ changed: [], removed: [] })
  expect(readAuth(home)).toEqual(manual)
})

test("a changed api key updates in place", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-chat-"))
  await run(
    home,
    JSON.stringify({ entries: [{ provider: "openai", key: "sk-1" }] }),
  )
  const result = await run(
    home,
    JSON.stringify({ entries: [{ provider: "openai", key: "sk-2" }] }),
  )
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    changed: ["openai"],
    removed: [],
  })
  expect(readAuth(home).openai).toEqual({ type: "api", key: "sk-2" })
})

test("revoke only removes matching api entries", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-chat-"))
  await Bun.write(
    authPath(home),
    JSON.stringify({
      openai: { type: "api", key: "sk-1" },
      xai: { type: "api", key: "other" },
    }),
  )
  const result = await run(
    home,
    JSON.stringify({
      entries: [],
      revoke: [
        { provider: "openai", key: "sk-1" },
        { provider: "xai", key: "sk-1" },
      ],
    }),
  )
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    changed: [],
    removed: ["openai"],
  })
  const auth = readAuth(home)
  expect(auth.openai).toBeUndefined()
  expect(auth.xai).toEqual({ type: "api", key: "other" })
})

test("an invalid payload fails loudly", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-chat-"))
  const result = await run(home, "not json")
  expect(result.code).not.toBe(0)
})
