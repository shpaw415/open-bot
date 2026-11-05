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

const script = join(import.meta.dir, "ob-improve.sh")

function fakeCurl(home: string, response: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  prev="$arg"
done
printf '%s\\n' '${response}'
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
      CURL_BODY: join(home, "curl.body"),
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

const ADD = [
  "add",
  "--kind",
  "bug",
  "--surface",
  "other",
  "--title",
  "weather widget stale",
  "--detail",
  "it never refreshes",
]

test("--plugin rides the request body and the routed issue is printed", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-improve-"))
  try {
    fakeCurl(
      home,
      '{"id":"r1","duplicate":false,"hits":1,"plugin":"weather-pro","issue":{"via":"github","repo":"shpaw415/open-bot-plugin-weather-pro","url":"https://github.com/shpaw415/open-bot-plugin-weather-pro/issues/7","number":7}}',
    )
    const result = await run(home, [...ADD, "--plugin", "weather-pro"])
    expect(result.code).toBe(0)
    const body = JSON.parse(await Bun.file(join(home, "curl.body")).text()) as {
      plugin?: string
    }
    expect(body.plugin).toBe("weather-pro")
    expect(result.stdout).toContain(
      "https://github.com/shpaw415/open-bot-plugin-weather-pro/issues/7",
    )
    expect(result.stdout).toContain("Filed.")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("without --plugin the body has no plugin and a local-only warning prints", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-improve-"))
  try {
    fakeCurl(
      home,
      '{"id":"r2","duplicate":false,"hits":1,"plugin":null,"warning":"filed locally only; external routing failed: GitHub is not configured"}',
    )
    const result = await run(home, ADD)
    expect(result.code).toBe(0)
    const body = JSON.parse(await Bun.file(join(home, "curl.body")).text()) as {
      plugin?: string
    }
    expect(body.plugin).toBeUndefined()
    expect(result.stdout).toContain("filed locally only")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("--plugin without a value is a usage error", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-improve-"))
  try {
    fakeCurl(home, "{}")
    const result = await run(home, [...ADD, "--plugin"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("Usage:")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
