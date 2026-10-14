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

const script = join(import.meta.dir, "ob-api-key.sh")

function fakeCurl(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
cat "$CURL_RESPONSE"
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
  return bin
}

async function run(home: string, args: string[]) {
  const proc = Bun.spawn(["sh", script, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_LLM_TOKEN: "test",
      PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}`,
      CURL_ARGS: join(home, "curl.args"),
      CURL_RESPONSE: join(home, "curl.response"),
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

test("prints the raw key on a hit", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"slug":"xai","apiKey":"xai-key-1","accountId":"","baseUrl":""}',
    )
    const result = await run(home, ["xai"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("xai-key-1\n")
    const args = await Bun.file(join(home, "curl.args")).text()
    expect(args).toContain("/api/keys/xai")
    expect(result.stderr).not.toContain("Bearer")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("--json prints the full record", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"slug":"cloudflare","apiKey":"cf-token","accountId":"acc1","gatewayId":"gw","gatewayToken":"gt","gatewaySlug":"jev","baseUrl":""}',
    )
    const result = await run(home, ["cloudflare", "--json"])
    expect(result.code).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.apiKey).toBe("cf-token")
    expect(parsed.accountId).toBe("acc1")
    expect(parsed.gatewaySlug).toBe("jev")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("no key set: empty stdout, exit 1", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    writeFileSync(join(home, "curl.response"), '{"error":"no xai key set"}')
    const result = await run(home, ["xai"])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("no xai key set")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("unknown slug shows the valid slugs", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"error":"unknown key slug: xaii","slugs":["cloudflare","xai"]}',
    )
    const result = await run(home, ["xaii"])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("unknown key slug")
    expect(result.stderr).toContain("cloudflare, xai")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("list renders set and unset without secrets", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"keys":[{"slug":"xai","label":"xAI","chatProvider":true,"hasKey":true},{"slug":"fal","label":"fal","chatProvider":false,"hasKey":false}]}',
    )
    const result = await run(home, ["list"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("- xAI [xai] set")
    expect(result.stdout).toContain("- fal [fal] not set")
    expect(result.stdout).not.toContain("secret")
    const args = await Bun.file(join(home, "curl.args")).text()
    expect(args).toContain("/api/keys")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("usage errors exit 2 without a request", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    const none = await run(home, [])
    expect(none.code).toBe(2)
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
    const flag = await run(home, ["xai", "--bogus"])
    expect(flag.code).toBe(2)
    const unknown = await run(home, ["--wat"])
    expect(unknown.code).toBe(2)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("--help exits 0 without a request", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-api-key-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["--help"])
    expect(result.code).toBe(0)
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
