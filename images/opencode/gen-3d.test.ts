import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "gen-3d.ts")

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
    join(home, ".config/open-bot/model3d.json"),
    JSON.stringify(marker),
  )
  if (auth) {
    writeFileSync(
      join(home, ".config/open-bot/model3d-auth.json"),
      JSON.stringify(auth),
    )
  }
}

test("prints usage without a prompt", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const result = await run(home)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("usage")
})

test("points at the gpio-3d fallback when nothing is configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const result = await run(home, "a ceramic owl")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("no 3d model provider configured")
  expect(result.stderr).toContain("gpio-3d")
})

test("rejects an unsupported provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  seed(home, { provider: "other", model: "m" }, { token: "t" })
  const result = await run(home, "a ceramic owl")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unsupported 3d model provider")
})

test("fails without credentials on every provider", async () => {
  for (const provider of ["meshy", "tripo", "replicate", "fal"]) {
    const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
    seed(home, { provider, model: "m" })
    const result = await run(home, "a ceramic owl")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("missing 3d credentials")
  }
})

test("image wires the cli, auth script, and seed skill", () => {
  const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
  expect(dockerfile).toContain(
    "COPY images/opencode/apply-model3d-auth.sh /opt/open-bot/apply-model3d-auth.sh",
  )
  expect(dockerfile).toContain(
    "COPY images/opencode/gen-3d.ts /opt/open-bot/gen-3d.ts",
  )
  expect(dockerfile).toContain("/usr/local/bin/gen-3d")
  const entrypoint = readFileSync(
    join(import.meta.dir, "entrypoint.sh"),
    "utf8",
  )
  expect(entrypoint).toContain(
    "cp /opt/open-bot/seed/skills/gen-3d/SKILL.md /home/agent/.config/opencode/skills/gen-3d/SKILL.md",
  )
  const skill = readFileSync(
    join(import.meta.dir, "seed/skills/gen-3d/SKILL.md"),
    "utf8",
  )
  expect(skill).toContain("name: gen-3d")
  expect(skill).toContain("gpio-3d")
})
