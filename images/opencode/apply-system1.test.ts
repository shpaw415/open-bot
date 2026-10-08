import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "apply-system1.sh")

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

test("writes the endpoint without the key and locks the auth file", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-s1-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-jev",
      endpoint: "https://gateway.example/v1/systemone",
      model: "jev-latest",
      apiKey: "secret",
      gatewayToken: "gate",
    }),
  )
  expect(result.code).toBe(0)
  const marker = JSON.parse(
    readFileSync(join(home, ".config/open-bot/system1.json"), "utf8"),
  )
  expect(marker).toEqual({
    provider: "cloudflare-jev",
    endpoint: "https://gateway.example/v1/systemone",
    model: "jev-latest",
  })
  expect(JSON.stringify(marker)).not.toContain("secret")
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/system1-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ apiKey: "secret", gatewayToken: "gate" })
  expect(
    statSync(join(home, ".config/open-bot/system1-auth.json")).mode & 0o777,
  ).toBe(0o600)
})

test("an empty payload removes both files", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-s1-"))
  await run(
    home,
    JSON.stringify({
      provider: "laya",
      endpoint: "http://laya.example/v1/systemone",
      model: "",
      apiKey: "",
      gatewayToken: "",
    }),
  )
  const cleared = await run(home, "{}")
  expect(cleared.code).toBe(0)
  expect(() =>
    readFileSync(join(home, ".config/open-bot/system1.json")),
  ).toThrow()
})

test("cloudflare-clef writes the workers-ai endpoint and api key only", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-s1-"))
  const result = await run(
    home,
    JSON.stringify({
      provider: "cloudflare-clef",
      endpoint:
        "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
      model: "clef",
      apiKey: "cf-token",
      gatewayToken: "",
    }),
  )
  expect(result.code).toBe(0)
  const marker = JSON.parse(
    readFileSync(join(home, ".config/open-bot/system1.json"), "utf8"),
  )
  expect(marker).toEqual({
    provider: "cloudflare-clef",
    endpoint:
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
    model: "clef",
  })
  const auth = JSON.parse(
    readFileSync(join(home, ".config/open-bot/system1-auth.json"), "utf8"),
  )
  expect(auth).toEqual({ apiKey: "cf-token", gatewayToken: "" })
})
