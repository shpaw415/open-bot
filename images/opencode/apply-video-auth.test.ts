import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "apply-video-auth.sh")

async function run(home: string, payload: string) {
  const proc = Bun.spawn(["sh", script], {
    env: { ...process.env, HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin.write(payload)
  await proc.stdin.end()
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stderr }
}

test("writes key-only auth for openai and keeps the model", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "openai",
      accountId: "",
      token: "sk",
      model: "sora-2",
    }),
  )
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/video-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ accountId: null, token: "sk" })
  expect(
    statSync(join(home, ".config/open-bot/video-auth.json")).mode & 0o777,
  ).toBe(0o600)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8")),
  ).toEqual({ provider: "openai", model: "sora-2" })
})

test("defaults the model per provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const google = await run(
    home,
    JSON.stringify({
      provider: "google",
      accountId: "",
      token: "k",
      model: "",
    }),
  )
  expect(google.code).toBe(0)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8"))
      .model,
  ).toBe("veo-3.0-fast-generate-001")
  const xai = await run(
    home,
    JSON.stringify({ provider: "xai", accountId: "", token: "k", model: "" }),
  )
  expect(xai.code).toBe(0)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8"))
      .model,
  ).toBe("grok-imagine-video-1.5")
  const gateway = await run(
    home,
    JSON.stringify({
      provider: "xai-gateway",
      accountId: "acct",
      token: "cf-token",
      model: "",
    }),
  )
  expect(gateway.code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/video-auth.json"), "utf8"),
    ),
  ).toEqual({ accountId: "acct", token: "cf-token" })
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8"))
      .model,
  ).toBe("grok-imagine-video-1.5")
  const fal = await run(
    home,
    JSON.stringify({ provider: "fal", accountId: "", token: "k", model: "" }),
  )
  expect(fal.code).toBe(0)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8"))
      .model,
  ).toBe("fal-ai/veo3")
  const replicate = await run(
    home,
    JSON.stringify({
      provider: "replicate",
      accountId: "",
      token: "k",
      model: "",
    }),
  )
  expect(replicate.code).toBe(0)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8"))
      .model,
  ).toBe("google/veo-3-fast")
})

test("switching providers replaces the previous auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "openai",
      accountId: "",
      token: "sk",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const switched = await run(
    home,
    JSON.stringify({
      provider: "fal",
      accountId: "",
      token: "fk",
      model: "m2",
    }),
  )
  expect(switched.code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/video-auth.json"), "utf8"),
    ),
  ).toEqual({ accountId: null, token: "fk" })
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/video.json"), "utf8")),
  ).toEqual({ provider: "fal", model: "m2" })
})

test("clears auth when credentials are empty", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "openai",
      accountId: "",
      token: "sk",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const cleared = await run(home, "{}")
  expect(cleared.code).toBe(0)
  expect(() =>
    readFileSync(join(home, ".config/open-bot/video.json")),
  ).toThrow()
  expect(() =>
    readFileSync(join(home, ".config/open-bot/video-auth.json")),
  ).toThrow()
})

test("rejects an unknown provider without wiping saved auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-video-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "openai",
      accountId: "",
      token: "sk",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const rejected = await run(
    home,
    JSON.stringify({
      provider: "other",
      accountId: "",
      token: "tok",
      model: "m",
    }),
  )
  expect(rejected.code).toBe(1)
  expect(rejected.stderr).toContain("unsupported video provider")
  expect(
    readFileSync(join(home, ".config/open-bot/video-auth.json"), "utf8"),
  ).toContain("sk")
})
