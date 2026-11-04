import { expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
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
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
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

test("--help prints usage and never starts a generation", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  // Fully configured provider: the old code submitted "--help" as the prompt
  // and billed a generation.
  seed(home, { provider: "tripo", model: "latest" }, { token: "t" })
  for (const argv of [
    ["--help"],
    ["-h"],
    ["help"],
    ["--help", "-o", "x.glb"],
  ]) {
    const result = await run(home, ...argv)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("usage: gen-3d")
  }
  expect(existsSync(join(home, ".open-bot/gen-3d-jobs.json"))).toBe(false)
})

test("unknown flags fail as usage errors, not prompts", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  seed(home, { provider: "tripo", model: "latest" }, { token: "t" })
  const result = await run(home, "--model", "fancy", "a ceramic owl")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unknown option: --model")
  expect(result.stderr).toContain("gen-3d --help")
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
  expect(entrypoint).toContain("for skill_dir in /opt/open-bot/seed/skills/*/")
  const skill = readFileSync(
    join(import.meta.dir, "seed/skills/gen-3d/SKILL.md"),
    "utf8",
  )
  expect(skill).toContain("name: gen-3d")
  expect(skill).toContain("gpio-3d")
})

test("status lists an empty journal and rejects unknown job ids", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  const empty = await run(home, "status")
  expect(empty.code).toBe(0)
  expect(empty.stdout).toContain("(no gen-3d jobs)")
  const missing = await run(home, "status", "task_nope")
  expect(missing.code).toBe(1)
  expect(missing.stderr).toContain("no gen-3d job task_nope")
  const download = await run(home, "download", "task_nope")
  expect(download.code).toBe(1)
  expect(download.stderr).toContain("no gen-3d job task_nope")
  const noId = await run(home, "resume")
  expect(noId.code).toBe(1)
  expect(noId.stderr).toContain("usage: gen-3d resume JOB_ID")
})

test("status shows a journaled job without touching the network", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  mkdirSync(join(home, ".open-bot"), { recursive: true })
  writeFileSync(
    join(home, ".open-bot/gen-3d-jobs.json"),
    JSON.stringify({
      jobs: [
        {
          id: "task_1",
          provider: "tripo",
          prompt: "a ceramic owl",
          model: "latest",
          out: "/home/agent/workspace/owl.glb",
          status: "success",
          resultUrl: "https://cdn.example/owl.glb",
          submittedAt: 1,
          updatedAt: 1,
        },
      ],
    }),
  )
  const result = await run(home, "status", "task_1")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("[task_1] tripo success")
  expect(result.stdout).toContain("a ceramic owl")
  expect(result.stdout).toContain("gen-3d download task_1")
})

test("the tripo bridge requires credentials and the tripo provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "gen-3d-"))
  seed(home, { provider: "tripo", model: "latest" })
  const noAuth = await run(home, "tripo", "rig", "--help")
  expect(noAuth.code).toBe(1)
  expect(noAuth.stderr).toContain("missing 3d credentials")
  seed(home, { provider: "meshy", model: "meshy-5" }, { token: "t" })
  const wrongProvider = await run(home, "tripo", "rig", "--help")
  expect(wrongProvider.code).toBe(1)
  expect(wrongProvider.stderr).toContain("needs the tripo 3d provider")
  const noArgs = await run(home, "tripo")
  expect(noArgs.code).toBe(1)
  expect(noArgs.stderr).toContain("usage: gen-3d tripo")
})
