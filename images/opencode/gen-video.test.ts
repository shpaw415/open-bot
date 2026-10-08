import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "gen-video.ts")

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
    join(home, ".config/open-bot/video.json"),
    JSON.stringify(marker),
  )
  if (auth) {
    writeFileSync(
      join(home, ".config/open-bot/video-auth.json"),
      JSON.stringify(auth),
    )
  }
}

test("prints usage without a prompt", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const result = await run(home)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("usage")
})

test("fails with a clear message when nothing is configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const result = await run(home, "a koi swimming")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("no video provider configured")
})

test("rejects an unsupported provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  seed(home, { provider: "other", model: "m" }, { token: "t" })
  const result = await run(home, "a koi swimming")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unsupported video provider")
})

test("fails without credentials on every provider", async () => {
  for (const provider of ["xai", "openai", "google", "replicate", "fal"]) {
    const home = mkdtempSync(join(tmpdir(), "gen-video-"))
    seed(home, { provider, model: "m" })
    const result = await run(home, "a koi swimming")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("missing video credentials")
  }
})

test("rejects a configured image model with a clear message", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  seed(
    home,
    { provider: "xai-gateway", model: "grok-imagine-image-2.0" },
    { accountId: "acc", token: "t" },
  )
  const result = await run(home, "a koi swimming")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("grok-imagine-image-2.0")
  expect(result.stderr).toContain("image model, not a video model")
  expect(result.stderr).toContain("--model")
})

test("rejects an image model passed via --model", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  seed(
    home,
    { provider: "xai", model: "grok-imagine-video-1.5" },
    { token: "t" },
  )
  const result = await run(
    home,
    "a koi swimming",
    "--model",
    "grok-imagine-image",
  )
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("image model, not a video model")
})

test("models lists the provider catalog without a prompt", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  seed(
    home,
    { provider: "xai-gateway", model: "grok-imagine-image-2.0" },
    { accountId: "acc", token: "t" },
  )
  const proc = Bun.spawn(["bun", script, "models"], {
    env: { ...process.env, HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  expect(code).toBe(0)
  expect(stdout).toContain("provider xai-gateway")
  expect(stdout).toContain("grok-imagine-video-1.5")
  expect(stdout).toContain("is an image model")
  expect(stdout).toContain("--probe")
})

test("models --probe fails without credentials", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  seed(home, { provider: "xai", model: "grok-imagine-video-1.5" })
  const result = await run(home, "models", "--probe")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("missing video credentials")
})
