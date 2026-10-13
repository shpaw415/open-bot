import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-plugin.sh")

function fakeCurl(home: string, response: string, fail = false) {
  const bin = join(home, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  prev="$arg"
done
${fail ? "exit 7" : `printf '%s\\n' '${response.replace(/'/g, `'\\''`)}'`}
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
  return bin
}

async function run(home: string, args: string[], bin?: string) {
  const proc = Bun.spawn(["sh", script, ...args], {
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_LLM_TOKEN: "test",
      ...(bin ? { PATH: `${bin}:${process.env.PATH ?? ""}` } : {}),
      CURL_ARGS: join(home, "curl.args"),
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

test("ob-plugin new writes a manifest and README and registers the project", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const bin = fakeCurl(
      home,
      '{"project":{"id":"p1","name":"price-scout","path":"/x","category":"plugins"}}',
    )
    const result = await run(home, ["new", "price-scout"], bin)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe("")
    const dir = join(home, "plugins-create/price-scout")
    const manifest = JSON.parse(
      readFileSync(join(dir, "open-bot.plugin.json"), "utf8"),
    )
    expect(manifest.id).toBe("price-scout")
    expect(manifest.skills[0].body).toBe(
      "# price-scout\n\nInstructions for the agent.\n",
    )
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(
      "# price-scout",
    )
    expect(result.stdout).toContain(`scaffolded ${dir}`)
    expect(result.stdout).toContain("added to the project list (plugins)")
    const curlArgs = readFileSync(join(home, "curl.args"), "utf8")
    expect(curlArgs).toContain("POST")
    expect(curlArgs).toContain("/api/projects")
    expect(readFileSync(join(home, "curl.body"), "utf8")).toBe(
      `{"path":"${dir}","name":"price-scout"}`,
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin new keeps the scaffold when the project entry already exists", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const bin = fakeCurl(
      home,
      '{"error":"a project with this name already exists"}',
    )
    const result = await run(home, ["new", "price-scout"], bin)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("project entry not added")
    expect(existsSync(join(home, "plugins-create/price-scout"))).toBe(true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin new keeps the scaffold when the control plane is unreachable", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const bin = fakeCurl(home, "", true)
    const result = await run(home, ["new", "price-scout"], bin)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("could not reach the control plane")
    expect(existsSync(join(home, "plugins-create/price-scout"))).toBe(true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin new does not leave a directory when the name is rejected", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const result = await run(home, ["new", "Bad_Name"])
    expect(result.code).toBe(2)
    expect(existsSync(join(home, "plugins-create"))).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
