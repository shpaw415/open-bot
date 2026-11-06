import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-persona.sh")

function personaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Researcher",
    instruction: "Dig deep.",
    builtin: false,
    skills: ["research", "media"],
    skillsExtra: null,
    skillsNone: false,
    skillsEffective: ["research", "media"],
    mcp: ["stock", "weather"],
    mcpExtra: null,
    mcpNone: false,
    mcpEffective: ["stock", "weather"],
    ...overrides,
  }
}

function fakeCurl(
  home: string,
  personas: Record<string, unknown>[],
  putResponse = '{"id":"p1","name":"Researcher"}',
) {
  const bin = join(home, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
method=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  if [ "$prev" = "-X" ]; then method="$arg"; fi
  prev="$arg"
done
case "$method" in
  GET)
    printf '%s\\n' '${JSON.stringify({ personas }).replace(/'/g, "'\\''")}'
    ;;
  PUT)
    printf '%s\\n' '${putResponse.replace(/'/g, "'\\''")}'
    ;;
esac
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

async function bodyOf(home: string) {
  return JSON.parse(await Bun.file(join(home, "curl.body")).text())
}

function withHome(fn: (home: string) => Promise<void>) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "ob-persona-"))
    try {
      await fn(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

test(
  "--skills-remove drops a name from a user persona's base list",
  withHome(async (home) => {
    fakeCurl(home, [personaRow()])
    const result = await run(home, ["update", "p1", "--skills-remove", "media"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Updated")
    expect(await bodyOf(home)).toEqual({ skills: ["research"] })
  }),
)

test(
  "--skills-remove subtracts extras on a plugin persona, never the base",
  withHome(async (home) => {
    fakeCurl(home, [
      personaRow({
        id: "p-plug",
        name: "Trader",
        plugin: { pluginId: "stock", name: "Stock Dashboard" },
        skills: ["trader"],
        skillsExtra: ["stock", "files"],
      }),
    ])
    const ok = await run(home, ["update", "p-plug", "--skills-remove", "stock"])
    expect(ok.code).toBe(0)
    expect(await bodyOf(home)).toEqual({ skillsExtra: ["files"] })

    const clash = await run(home, ["update", "p-plug", "--skills-remove", "trader"])
    expect(clash.code).toBe(1)
    expect(clash.stderr).toContain("'trader' is in the base skill list")
  }),
)

test(
  "--skills-remove refuses on an unrestricted persona and on the Assistant",
  withHome(async (home) => {
    fakeCurl(home, [
      personaRow({ id: "p-free", skills: null, skillsEffective: null }),
      personaRow({ id: "assistant", name: "Assistant", builtin: true }),
    ])
    const free = await run(home, ["update", "p-free", "--skills-remove", "media"])
    expect(free.code).toBe(1)
    expect(free.stderr).toContain("loads all skills")

    const assistant = await run(home, ["update", "assistant", "--skills-remove", "media"])
    expect(assistant.code).toBe(1)
    expect(assistant.stderr).toContain("the Assistant loads every skill")
  }),
)

test(
  "--skills-remove refuses when it would empty a user persona's base list",
  withHome(async (home) => {
    fakeCurl(home, [personaRow({ skills: ["research"], skillsEffective: ["research"] })])
    const result = await run(home, ["update", "p1", "--skills-remove", "research"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("--skills none")
    expect(result.stderr).toContain("--skills-clear")
  }),
)

test(
  "--mcp-remove drops a server from a user persona and from plugin extras",
  withHome(async (home) => {
    fakeCurl(home, [personaRow()])
    const user = await run(home, ["update", "p1", "--mcp-remove", "weather"])
    expect(user.code).toBe(0)
    expect(await bodyOf(home)).toEqual({ mcp: ["stock"] })

    fakeCurl(home, [
      personaRow({
        id: "p-plug",
        name: "Trader",
        plugin: { pluginId: "stock", name: "Stock Dashboard" },
        skills: null,
        skillsEffective: null,
        mcp: ["trader"],
        mcpExtra: ["weather", "files"],
        mcpEffective: ["trader", "weather", "files"],
      }),
    ])
    const extras = await run(home, ["update", "p-plug", "--mcp-remove", "weather"])
    expect(extras.code).toBe(0)
    expect(await bodyOf(home)).toEqual({ mcpExtra: ["files"] })
  }),
)

test(
  "--mcp-remove refuses on an unrestricted persona and on a base server",
  withHome(async (home) => {
    fakeCurl(home, [
      personaRow({ id: "p-free", mcp: null, mcpEffective: null }),
      personaRow({
        id: "p-plug",
        name: "Trader",
        plugin: { pluginId: "stock", name: "Stock Dashboard" },
        mcp: ["trader"],
        mcpExtra: null,
      }),
    ])
    const free = await run(home, ["update", "p-free", "--mcp-remove", "weather"])
    expect(free.code).toBe(1)
    expect(free.stderr).toContain("loads every MCP server")

    const clash = await run(home, ["update", "p-plug", "--mcp-remove", "trader"])
    expect(clash.code).toBe(1)
    expect(clash.stderr).toContain("'trader' is in the base server list")
  }),
)

test(
  "add and remove combine in one call on a user persona",
  withHome(async (home) => {
    fakeCurl(home, [personaRow()])
    const result = await run(home, [
      "update",
      "p1",
      "--skills-append",
      "preview",
      "--skills-remove",
      "media",
    ])
    expect(result.code).toBe(0)
    // unique sorts the stored list; order is not semantic. The append path
    // carries its explicit skillsNone: false unblock alongside the list.
    expect(await bodyOf(home)).toEqual({ skills: ["preview", "research"], skillsNone: false })
  }),
)

test(
  "--skills-remove works on a built-in persona's extras",
  withHome(async (home) => {
    fakeCurl(home, [
      personaRow({
        id: "plugin-creator",
        name: "Open-bot Plugin Creator",
        builtin: true,
        skills: null,
        skillsEffective: null,
        skillsExtra: ["framer", "pytest"],
      }),
    ])
    const result = await run(home, ["update", "plugin-creator", "--skills-remove", "pytest"])
    expect(result.code).toBe(0)
    expect(await bodyOf(home)).toEqual({ skillsExtra: ["framer"] })
  }),
)
