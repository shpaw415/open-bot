import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "gen-image.ts")

async function run(home: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    env: { ...process.env, HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stderr }
}

function seed(home: string, marker: object, auth?: object) {
  mkdirSync(join(home, ".config/open-bot"), { recursive: true })
  writeFileSync(
    join(home, ".config/open-bot/image.json"),
    JSON.stringify(marker),
  )
  if (auth) {
    writeFileSync(
      join(home, ".config/open-bot/image-auth.json"),
      JSON.stringify(auth),
    )
  }
}

test("prints usage without a prompt", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-image-"))
  const result = await run(home)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("usage")
})

test("fails with a clear message when nothing is configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-image-"))
  const result = await run(home, "a koi")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("no image provider configured")
})

test("rejects an unsupported provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-image-"))
  seed(home, { provider: "other", model: "m" }, { token: "t" })
  const result = await run(home, "a koi")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unsupported image provider")
})

test("fails without credentials on a key-only provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-image-"))
  seed(home, { provider: "xai", model: "grok-2-image-1212" })
  const result = await run(home, "a koi")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("missing image credentials")
})
