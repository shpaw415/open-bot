import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-skill.sh")

function fakeCurl(
  home: string,
  responses: Record<string, string> = {},
  dirsJson = '{"dirs":[{"id":"dir_1","kind":"skill","label":"Research","position":0}],"items":[]}',
) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  const cases = Object.entries(responses)
    .map(
      ([key, value]) =>
        `  ${JSON.stringify(key)}) printf '%s\\n' '${value.replace(/'/g, "'\\''")}'; exit 0 ;;`,
    )
    .join("\n")
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
if [ "$method" = "GET" ] && printf '%s' "$@" | grep -q "kind=skill"; then
  printf '%s\\n' '${dirsJson.replace(/'/g, "'\\''")}'
  exit 0
fi
key="$method $(printf '%s' "$@" | grep -o '/api/[a-z/?:=&A-Z-]*' | head -n 1)"
case "$key" in
${cases}
esac
printf '%s\\n' '{"ok":true}'
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

async function argsOf(home: string) {
  return (await Bun.file(join(home, "curl.args")).text()).split("\n")
}

async function bodyOf(home: string) {
  return JSON.parse(await Bun.file(join(home, "curl.body")).text())
}

function withHome(fn: (home: string) => Promise<void>) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "ob-skill-"))
    try {
      await fn(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

test(
  "save sends name, description, and body to PUT /api/skills",
  withHome(async (home) => {
    fakeCurl(home)
    const result = await run(home, [
      "save",
      "logo-cutout",
      "--description",
      "Cut a logo out",
      "--body",
      "# Logo cutout\n\nsteps",
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("saved logo-cutout")
    const args = await argsOf(home)
    expect(args).toContain("PUT")
    expect(args.join(" ")).toContain("/api/skills")
    expect(await bodyOf(home)).toEqual({
      name: "logo-cutout",
      description: "Cut a logo out",
      body: "# Logo cutout\n\nsteps",
    })
  }),
)

test(
  "save --file reads the body from a file and assigns the group by label",
  withHome(async (home) => {
    fakeCurl(home)
    const skillFile = join(home, "skill.md")
    writeFileSync(skillFile, "# Steps\n\nhere")
    const result = await run(home, [
      "save",
      "research",
      "--description",
      "Find sources",
      "--file",
      skillFile,
      "--group",
      "Research",
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("group: Research")
    // The last request is the group assignment (existing label "Research").
    expect(await bodyOf(home)).toEqual({
      kind: "skill",
      names: ["research"],
      dirId: "dir_1",
    })
  }),
)

test(
  "save --group creates the directory when the label is unknown, then assigns",
  withHome(async (home) => {
    // The dirs list answers empty, so the label "Writing" is unknown and the
    // CLI must POST-create it, then assign to the returned id.
    fakeCurl(
      home,
      {
        "POST /api/catalog/dirs":
          '{"id":"dir_new","kind":"skill","label":"Writing","position":0}',
      },
      '{"dirs":[],"items":[]}',
    )
    const result = await run(home, [
      "save",
      "draft-post",
      "--description",
      "d",
      "--body",
      "b",
      "--group",
      "Writing",
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("group: Writing")
    expect(await bodyOf(home)).toEqual({
      kind: "skill",
      names: ["draft-post"],
      dirId: "dir_new",
    })
  }),
)

test(
  "save without a body source is a usage error",
  withHome(async (home) => {
    fakeCurl(home)
    const result = await run(home, [
      "save",
      "x",
      "--description",
      "d",
    ])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--file")
  }),
)

test(
  "rename fetches the old skill and PUTs with previousName",
  withHome(async (home) => {
    fakeCurl(home, {
      "GET /api/skills?name=old-name":
        '{"name":"old-name","description":"d","body":"b"}',
    })
    const result = await run(home, ["rename", "old-name", "new-name"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("renamed old-name to new-name")
    expect(await bodyOf(home)).toEqual({
      name: "new-name",
      description: "d",
      body: "b",
      previousName: "old-name",
    })
  }),
)

test(
  "delete sends the name and group --none unassigns",
  withHome(async (home) => {
    fakeCurl(home)
    const removed = await run(home, ["delete", "old-thing"])
    expect(removed.code).toBe(0)
    expect(removed.stdout).toContain("deleted old-thing")
    expect(await bodyOf(home)).toEqual({ name: "old-thing" })
    expect((await argsOf(home)).join(" ")).toContain("DELETE")

    const ungrouped = await run(home, ["group", "old-thing", "--none"])
    expect(ungrouped.code).toBe(0)
    expect(await bodyOf(home)).toEqual({
      kind: "skill",
      names: ["old-thing"],
      dirId: null,
    })
  }),
)

test(
  "get prints the description and body",
  withHome(async (home) => {
    fakeCurl(home, {
      "GET /api/skills?name=logo":
        '{"name":"logo","description":"Cut logos","body":"# Logo\\n\\nsteps"}',
    })
    const result = await run(home, ["get", "logo"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("# logo — Cut logos")
    expect(result.stdout).toContain("# Logo")
  }),
)

test(
  "API errors surface on stderr with exit 1",
  withHome(async (home) => {
    fakeCurl(home, {
      "PUT /api/skills": '{"error":"name is a built-in skill"}',
    })
    const result = await run(home, [
      "save",
      "cron",
      "--description",
      "d",
      "--body",
      "b",
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("ob-skill: name is a built-in skill")
  }),
)

test(
  "every request carries a hard curl timeout so the CLI cannot hang",
  withHome(async (home) => {
    fakeCurl(home, {
      "GET /api/skills": '{"skills":[{"name":"a","description":"d"}]}',
    })
    const result = await run(home, ["list"])
    expect(result.code).toBe(0)
    const args = await argsOf(home)
    const at = args.indexOf("--max-time")
    expect(at).toBeGreaterThanOrEqual(0)
    // Server bounds a save to ~15 s + rollback grace; the CLI hard stop
    // tracks that instead of outliving callers by minutes (#88/#92).
    expect(args[at + 1]).toBe("35")
  }),
)

test(
  "save prints the indexing note when the write is durable but unconfirmed",
  withHome(async (home) => {
    fakeCurl(home, {
      "PUT /api/skills": '{"ok":true,"confirmed":false}',
    })
    const result = await run(home, [
      "save",
      "logo-cutout",
      "--description",
      "d",
      "--body",
      "b",
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("saved logo-cutout")
    expect(result.stdout).toContain("still indexing")
    expect(result.stdout).toContain("do not retry")
  }),
)

test(
  "get on a missing skill hints at indexing right after a save",
  withHome(async (home) => {
    fakeCurl(home, {
      "GET /api/skills?name=logo": '{"error":"skill not found"}',
    })
    const result = await run(home, ["get", "logo"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("skill not found")
    expect(result.stderr).toContain("may still be indexing")
  }),
)
