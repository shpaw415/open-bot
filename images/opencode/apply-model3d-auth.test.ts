import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "apply-model3d-auth.sh")

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

test("writes key-only auth for meshy and keeps the model", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "meshy",
      accountId: "",
      token: "msy",
      model: "meshy-5",
    }),
  )
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/model3d-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ accountId: null, token: "msy" })
  expect(
    statSync(join(home, ".config/open-bot/model3d-auth.json")).mode & 0o777,
  ).toBe(0o600)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d.json"), "utf8"),
    ),
  ).toEqual({ provider: "meshy", model: "meshy-5" })
})

test("defaults the model per provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const tripo = await run(
    home,
    JSON.stringify({ provider: "tripo", accountId: "", token: "k", model: "" }),
  )
  expect(tripo.code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d.json"), "utf8"),
    ).model,
  ).toBe("latest")
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
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d.json"), "utf8"),
    ).model,
  ).toBe("firtoz/trellis")
  const fal = await run(
    home,
    JSON.stringify({ provider: "fal", accountId: "", token: "k", model: "" }),
  )
  expect(fal.code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d.json"), "utf8"),
    ).model,
  ).toBe("fal-ai/tripo/v2.5/text-to-3d")
})

test("switching providers replaces the previous auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "meshy",
      accountId: "",
      token: "mk",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const switched = await run(
    home,
    JSON.stringify({
      provider: "tripo",
      accountId: "",
      token: "tk",
      model: "m2",
    }),
  )
  expect(switched.code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d-auth.json"), "utf8"),
    ),
  ).toEqual({ accountId: null, token: "tk" })
  expect(
    JSON.parse(
      readFileSync(join(home, ".config/open-bot/model3d.json"), "utf8"),
    ),
  ).toEqual({ provider: "tripo", model: "m2" })
})

test("clears auth when credentials are empty", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "meshy",
      accountId: "",
      token: "mk",
      model: "m",
    }),
  )
  expect(written.code).toBe(0)
  const cleared = await run(home, "{}")
  expect(cleared.code).toBe(0)
  expect(() =>
    readFileSync(join(home, ".config/open-bot/model3d.json")),
  ).toThrow()
  expect(() =>
    readFileSync(join(home, ".config/open-bot/model3d-auth.json")),
  ).toThrow()
})

test("rejects an unknown provider without wiping saved auth", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const written = await run(
    home,
    JSON.stringify({
      provider: "meshy",
      accountId: "",
      token: "mk",
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
  expect(rejected.stderr).toContain("unsupported 3d model provider")
  expect(
    readFileSync(join(home, ".config/open-bot/model3d-auth.json"), "utf8"),
  ).toContain("mk")
})
