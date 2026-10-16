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

const doctorManifest = JSON.stringify({
  id: "price-scout",
  version: "0.1.0",
  repo: "shpaw415/price-scout",
  configs: [{ key: "region", type: "string" }],
})

// Succeeds only for the control-plane validate POST; raw.githubusercontent
// "404s" so doctor must fall back to gh/git for the repo and tag checks.
function flakyRawCurl(home: string, rawFails: boolean) {
  const bin = join(home, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *raw.githubusercontent.com*)
      ${rawFails ? "exit 7" : "exit 0"} ;;
  esac
done
printf '%s\\n' '{"ok":true}'
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
}

function doctorFixture(home: string) {
  const dir = join(home, "plugins-create/price-scout")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "open-bot.plugin.json"), doctorManifest)
  writeFileSync(join(dir, "CONFIG.md"), "# price-scout config guide\n")
  return dir
}

test("ob-plugin doctor falls back to gh/git when raw.githubusercontent 404s", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-doctor-"))
  try {
    flakyRawCurl(home, true)
    const bin = join(home, "bin")
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\n[ "$1" = api ] && echo shpaw415/price-scout\n',
    )
    chmodSync(join(bin, "gh"), 0o755)
    writeFileSync(
      join(bin, "git"),
      "#!/bin/sh\necho 'abc123\trefs/tags/v0.1.0'\n",
    )
    chmodSync(join(bin, "git"), 0o755)
    const dir = doctorFixture(home)
    const result = await run(home, ["doctor", dir], bin)
    expect(result.stderr).not.toContain("parameter not set")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("via gh api")
    expect(result.stdout).toContain("release tag: v0.1.0 exists")
    expect(result.stdout).toContain("config guide: CONFIG.md ok")
    expect(result.stdout).toContain("ready: ob-plugin publish")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin doctor reports unreachable repo and missing tag without fallbacks", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-doctor-"))
  try {
    flakyRawCurl(home, true)
    const bin = join(home, "bin")
    writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n")
    chmodSync(join(bin, "gh"), 0o755)
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(bin, "git"), 0o755)
    const dir = doctorFixture(home)
    const result = await run(home, ["doctor", dir], bin)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("repo: NOT reachable")
    expect(result.stdout).toContain("release tag: v0.1.0 missing")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const webhookState =
  '{"enabled":true,"secured":true,"path":"/hooks/uid/hook-pro/","secret":"s3cret","publicUrl":"https://open.test/hooks/uid/hook-pro/"}'

test("ob-plugin endpoint reports the url and raw secret", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-endpoint-"))
  try {
    const bin = fakeCurl(home, webhookState)
    const status = await run(home, ["endpoint", "hook-pro"], bin)
    expect(status.code).toBe(0)
    const parsed = JSON.parse(status.stdout)
    expect(parsed).toEqual({
      pluginId: "hook-pro",
      enabled: true,
      secured: true,
      secret: "s3cret",
      url: "https://open.test/hooks/uid/hook-pro/",
    })
    expect(readFileSync(join(home, "curl.args"), "utf8")).toContain(
      "/api/plugins/installed/hook-pro/webhook",
    )

    const url = await run(home, ["endpoint", "hook-pro", "url"], bin)
    expect(url.stdout).toBe("https://open.test/hooks/uid/hook-pro/\n")

    const secret = await run(home, ["endpoint", "hook-pro", "secret"], bin)
    expect(secret.code).toBe(0)
    expect(secret.stdout).toBe("s3cret\n")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin endpoint sets, generates, and clears the secret", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-endpoint-"))
  try {
    const bin = fakeCurl(home, '{"ok":true,"secured":true}')

    const set = await run(
      home,
      ["endpoint", "hook-pro", "secret", "hunter2"],
      bin,
    )
    expect(set.code).toBe(0)
    expect(set.stdout).toContain("secret set for hook-pro")
    expect(JSON.parse(readFileSync(join(home, "curl.body"), "utf8"))).toEqual({
      secret: "hunter2",
    })

    const generated = await run(
      home,
      ["endpoint", "hook-pro", "secret", "--generate"],
      bin,
    )
    expect(generated.code).toBe(0)
    expect(generated.stdout.trim()).toMatch(/^[0-9a-f]{48}$/)

    const clear = await run(home, ["endpoint", "hook-pro", "clear"], bin)
    expect(clear.code).toBe(0)
    expect(readFileSync(join(home, "curl.body"), "utf8")).toBe('{"secret": ""}')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin endpoint secret exits 1 when no secret is set", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-endpoint-"))
  try {
    const bin = fakeCurl(
      home,
      '{"enabled":true,"secured":false,"path":"/hooks/uid/hook-pro/","secret":null,"publicUrl":"https://open.test/hooks/uid/hook-pro/"}',
    )
    const result = await run(home, ["endpoint", "hook-pro", "secret"], bin)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("no secret set for hook-pro")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("an HTML error page fails with a digest instead of being echoed", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-html-"))
  try {
    const bin = fakeCurl(
      home,
      "<html><body><h1>error code: 524</h1></body></html>",
    )
    const result = await run(home, ["list"], bin)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("non-JSON error page")
    expect(result.stderr).toContain("error code: 524")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin new ships smoke.test.ts, the config-guide reviewer note, and the app tab kind", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const bin = fakeCurl(
      home,
      '{"project":{"id":"p1","name":"price-scout","path":"/x","category":"plugins"}}',
    )
    const result = await run(home, ["new", "price-scout"], bin)
    expect(result.code).toBe(0)
    const dir = join(home, "plugins-create/price-scout")
    // S4: a runnable smoke test ships with the scaffold.
    expect(existsSync(join(dir, "smoke.test.ts"))).toBe(true)
    const readme = readFileSync(join(dir, "README.md"), "utf8")
    // S1: the quick-reference documents the tab kind the scaffold itself uses.
    expect(readme).toContain("kind: app|page|iframe")
    expect(readme).toContain("run?: prompt|script|both|auto")
    expect(readme).toContain("type?: string|bool|number|enum")
    // DOC5: CONFIG.md is a review input — the template says so.
    const config = readFileSync(join(dir, "CONFIG.md"), "utf8")
    expect(config).toContain("marketplace security")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin doctor fails when a declared files[] source is missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-doctor-"))
  try {
    flakyRawCurl(home, true)
    const bin = join(home, "bin")
    writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n")
    chmodSync(join(bin, "gh"), 0o755)
    const dir = doctorFixture(home)
    writeFileSync(
      join(dir, "open-bot.plugin.json"),
      JSON.stringify({
        id: "price-scout",
        version: "0.1.0",
        repo: "shpaw415/price-scout",
        files: [{ name: "gone.ts", source: "server/gone.ts" }],
      }),
    )
    const result = await run(home, ["doctor", dir], bin)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("missing from the plugin directory")
    expect(result.stderr).toContain("server/gone.ts")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("ob-plugin publish stops with a clear message when no marketplace is configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-publish-"))
  try {
    const bin = fakeCurl(
      home,
      '{"error":"the plugin marketplace is not configured on this instance"}',
    )
    const dir = join(home, "plugins-create/price-scout")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "open-bot.plugin.json"),
      JSON.stringify({
        id: "price-scout",
        version: "0.1.0",
        repo: "shpaw415/price-scout",
      }),
    )
    const result = await run(home, ["publish", dir, "--yes"], bin)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("no marketplace configured")
    expect(result.stderr).toContain("install --path")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
