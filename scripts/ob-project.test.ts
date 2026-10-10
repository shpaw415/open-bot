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

const script = join(import.meta.dir, "ob-project.sh")

function fakeCurl(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  prev="$arg"
done
printf '%s\\n' '{"project":{"id":"p1","name":"user-project","path":"/x"}}'
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
  return bin
}

async function run(
  home: string,
  args: string[],
  extra: Record<string, string> = {},
) {
  const proc = Bun.spawn(["sh", script, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_LLM_TOKEN: "test",
      OPEN_BOT_PROJECT_ROOT: home,
      PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}`,
      CURL_ARGS: join(home, "curl.args"),
      CURL_BODY: join(home, "curl.body"),
      ...extra,
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

test("missing folder fails before the control plane", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-project-"))
  try {
    fakeCurl(home)
    const missing = join(home, "nope")
    const result = await run(home, ["add", "--path", missing])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`folder does not exist: ${missing}`)
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("tilde expands before the request and a missing home path does not call curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-project-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["add", "--path", "~/project/user-project"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `folder does not exist: ${home}/project/user-project`,
    )
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("add posts the canonical path of an existing directory", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-project-"))
  try {
    fakeCurl(home)
    const dir = join(home, "project", "user-project")
    mkdirSync(dir, { recursive: true })
    const result = await run(home, [
      "add",
      "--path",
      "~/project/user-project",
      "--name",
      "User project",
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('"id": "p1"')
    const body = JSON.parse(await Bun.file(join(home, "curl.body")).text())
    expect(body).toEqual({ path: dir, name: "User project" })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a symlink outside the desktop home is rejected before curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-project-"))
  const outside = mkdtempSync(join(tmpdir(), "ob-project-out-"))
  try {
    fakeCurl(home)
    const link = join(home, "escape")
    const proc = Bun.spawnSync(["ln", "-s", outside, link])
    expect(proc.exitCode).toBe(0)
    const result = await run(home, ["add", "--path", link])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("must be under /home/agent")
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
