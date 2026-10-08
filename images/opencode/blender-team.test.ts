import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_ROLES,
  extractResult,
  isProcessAlive,
  parseRoles,
  rolePrompt,
} from "./blender-team"

const script = join(import.meta.dir, "blender-team.ts")

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    env: { ...process.env },
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

test("parseRoles accepts known roles and dedupes, rejects unknown", () => {
  expect(parseRoles("model,materials,lighting,qa")).toEqual([
    "model",
    "materials",
    "lighting",
    "qa",
  ])
  expect(parseRoles("qa,qa")).toEqual(["qa"])
  expect(parseRoles("sculpt")).toBeNull()
  expect(parseRoles("")).toBeNull()
  expect(DEFAULT_ROLES).toEqual(["model", "materials", "lighting", "qa"])
})

test("extractResult returns the last RESULT line", () => {
  expect(
    extractResult(
      "step one done\nRESULT: built the base mesh\nnoise\nRESULT: PASS mesh sound",
    ),
  ).toBe("PASS mesh sound")
  expect(extractResult("no result line")).toBe("")
})

test("isProcessAlive checks pid liveness", () => {
  expect(isProcessAlive(process.pid)).toBe(true)
  expect(isProcessAlive(2_000_000_000)).toBe(false)
  expect(isProcessAlive(0)).toBe(false)
  expect(isProcessAlive(Number.NaN)).toBe(false)
})

test("rolePrompt describes the scene state for fresh, resumed, and retried runs", () => {
  const args = [
    "model",
    "an owl",
    "/tmp/d",
    "/tmp/d/scene.blend",
    "/tmp/o.glb",
  ] as const
  expect(rolePrompt(...args, [])).toContain("factory startup file")
  expect(rolePrompt(...args, [], true)).toContain("previous attempt")
  expect(rolePrompt(...args, [], true)).not.toContain("factory startup file")
  expect(rolePrompt(...args, ["materials: PASS assigned ebony"])).toContain(
    "previous stages did",
  )
})

test("a stale lock from a dead run is cleared instead of blocking", async () => {
  const home = join(`/tmp/opencode/blender-team-test-${Date.now()}`)
  mkdirSync(join(home, ".open-bot"), { recursive: true })
  mkdirSync(join(home, "bin"), { recursive: true })
  const stub = join(home, "bin", "blender")
  writeFileSync(stub, "#!/bin/sh\nexit 0\n")
  chmodSync(stub, 0o755)
  // a live listener stands in for the blender MCP socket so the probe reaches the lock
  let listener: ReturnType<typeof Bun.listen> | null = null
  try {
    listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 9876,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
    })
  } catch {
    // port already served: the probe will see the real socket, which is fine
  }
  try {
    mkdirSync(`${home}/.open-bot/blender-team.lock`, { recursive: true })
    writeFileSync(`${home}/.open-bot/blender-team.lock/pid`, "2000000000\n")
    const probe = Bun.spawn(["bun", script, "an owl"], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${join(home, "bin")}:${process.env.PATH}`,
        OPENCODE_ATTACH_PORT: "59999",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, stdout] = await Promise.all([
      new Response(probe.stderr).text(),
      new Response(probe.stdout).text(),
      probe.exited,
    ])
    expect(stderr).not.toContain("another blender-team run holds")
    // getting to the goal line proves the stale lock was cleared and a fresh one acquired
    expect(stdout).toContain("[blender-team] goal:")
  } finally {
    listener?.stop(true)
    rmSync(home, { recursive: true, force: true })
  }
})

test("prints usage without a goal", async () => {
  const result = await run()
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("usage")
})

test("rejects an unknown role before touching blender", async () => {
  const result = await run("an owl", "--roles", "sculpt")
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unknown role")
})

test("fails cleanly when blender is not installed", async () => {
  const result = await run("an owl", "--roles", "qa")
  if (result.stderr.includes("not installed")) {
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("blender is not installed")
  } else {
    expect(
      [
        "another blender-team run holds",
        "blender MCP is disabled",
        "Blender is not reachable",
      ].some((message) => result.stderr.includes(message)),
    ).toBe(true)
  }
})

test("wires the cli, blender files, worker config, and seed skill", () => {
  const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
  expect(dockerfile).toContain(
    "COPY images/opencode/blender-mcp /opt/open-bot/blender-mcp",
  )
  expect(dockerfile).toContain(
    "COPY images/opencode/blender-team.ts /opt/open-bot/blender-team.ts",
  )
  expect(dockerfile).toContain("/usr/local/bin/blender-team")
  expect(dockerfile).toContain("--no-install-recommends blender")
  expect(dockerfile).toContain(
    "/opt/blender-mcp-venv/bin/pip install --no-cache-dir blender-mcp",
  )
  const entrypoint = readFileSync(
    join(import.meta.dir, "entrypoint.sh"),
    "utf8",
  )
  expect(entrypoint).toContain(
    "cp /opt/open-bot/seed/skills/blender/SKILL.md /home/agent/.config/opencode/skills/blender/SKILL.md",
  )
  expect(entrypoint).toContain("/opt/open-bot/blender-up.sh")
  const seed = readFileSync(join(import.meta.dir, "seed/AGENTS.md"), "utf8")
  expect(seed).toContain("blender-team")
  const globalSeed = JSON.parse(
    readFileSync(join(import.meta.dir, "seed/opencode.json"), "utf8"),
  )
  expect(globalSeed.mcp?.blender).toMatchObject({
    type: "local",
    command: ["/opt/blender-mcp-venv/bin/blender-mcp"],
    enabled: true,
  })
  expect(globalSeed.agent.build.tools).toEqual({ "blender_*": false })
  expect(globalSeed.agent["blender-worker"].mode).toBe("all")
  const team = readFileSync(join(import.meta.dir, "blender-team.ts"), "utf8")
  expect(team).toContain('"blender-worker"')
  expect(team).toContain("prompt_async")
  expect(team).toContain("createConnection")
  const skill = readFileSync(
    join(import.meta.dir, "seed/skills/blender/SKILL.md"),
    "utf8",
  )
  expect(skill).toContain("name: blender")
})
