import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-plugin.sh")

async function run(home: string, args: string[]) {
  const proc = Bun.spawn(["sh", script, ...args], {
    env: { ...process.env, HOME: home, OPEN_BOT_LLM_TOKEN: "test" },
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

test("ob-plugin new writes a manifest and README", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-plugin-new-"))
  try {
    const result = await run(home, ["new", "price-scout"])
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
