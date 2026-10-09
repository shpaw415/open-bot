import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "apply-image-auth.sh")

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

test("writes workers-ai auth and the model", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      token: "tok",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    }),
  )
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const auth = JSON.parse(
    readFileSync(join(home, ".config/cf-ai/auth.json"), "utf8"),
  )
  expect(auth).toEqual({
    backend: "workers-ai",
    accountId: "acct",
    token: "tok",
  })
  expect(statSync(join(home, ".config/cf-ai/auth.json")).mode & 0o777).toBe(
    0o600,
  )
  expect(readFileSync(join(home, ".config/cf-ai/image-model"), "utf8")).toBe(
    "@cf/black-forest-labs/flux-2-klein-9b\n",
  )
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/image.json"), "utf8")),
  ).toEqual({
    provider: "cloudflare-workers-ai",
    model: "@cf/black-forest-labs/flux-2-klein-9b",
  })
})

test("writes key-only auth for xai without an account", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "xai",
      accountId: "",
      token: "xai-key",
      model: "grok-imagine-image",
    }),
  )
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/image-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ accountId: null, token: "xai-key" })
  expect(
    statSync(join(home, ".config/open-bot/image-auth.json")).mode & 0o777,
  ).toBe(0o600)
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/image.json"), "utf8")),
  ).toEqual({ provider: "xai", model: "grok-imagine-image" })
})

test("writes account auth for xai-gateway and defaults its model", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "xai-gateway",
      accountId: "acct",
      token: "cf-token",
      model: "",
    }),
  )
  expect(result.code).toBe(0)
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/image-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ accountId: "acct", token: "cf-token" })
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/image.json"), "utf8")),
  ).toEqual({ provider: "xai-gateway", model: "grok-imagine-image" })
})

test("switching providers removes the cloudflare cf-ai files", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      token: "tok",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const switched = await run(
    home,
    JSON.stringify({
      provider: "openai",
      accountId: "",
      token: "sk",
      model: "gpt-image-1",
    }),
  )
  expect(switched.code).toBe(0)
  expect(() => readFileSync(join(home, ".config/cf-ai/auth.json"))).toThrow()
  expect(() => readFileSync(join(home, ".config/cf-ai/image-model"))).toThrow()
  expect(
    JSON.parse(readFileSync(join(home, ".config/open-bot/image.json"), "utf8")),
  ).toEqual({ provider: "openai", model: "gpt-image-1" })
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/image-auth.json"), "utf8"),
    ),
  ).toEqual({ accountId: null, token: "sk" })
})

test("clears auth when credentials are empty", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      token: "tok",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const cleared = await run(home, "{}")
  expect(cleared.code).toBe(0)
  expect(() => readFileSync(join(home, ".config/cf-ai/auth.json"))).toThrow()
  expect(() => readFileSync(join(home, ".config/cf-ai/image-model"))).toThrow()
  expect(() =>
    readFileSync(join(home, ".config/open-bot/image.json")),
  ).toThrow()
  expect(() =>
    readFileSync(join(home, ".config/open-bot/image-auth.json")),
  ).toThrow()
})

test("rejects an unknown provider without wiping saved auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ai-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-workers-ai",
      accountId: "acct",
      token: "tok",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const rejected = await run(
    home,
    JSON.stringify({
      provider: "other",
      accountId: "acct",
      token: "tok",
      model: "m",
    }),
  )
  expect(rejected.code).toBe(1)
  expect(rejected.stderr).toContain("unsupported image provider")
  expect(readFileSync(join(home, ".config/cf-ai/auth.json"), "utf8")).toContain(
    "acct",
  )
})
