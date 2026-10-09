import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Blender is no longer built into the image: it ships as the `blender`
// marketplace plugin (repo shpaw415/open-bot-blender). These assertions keep
// the image free of the old built-in wiring and pin the plugin-era contract.

const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
const entrypoint = readFileSync(join(import.meta.dir, "entrypoint.sh"), "utf8")
const seedConfig = readFileSync(
  join(import.meta.dir, "seed/opencode.json"),
  "utf8",
)
const seedAgents = readFileSync(join(import.meta.dir, "seed/AGENTS.md"), "utf8")

describe("blender is plugin-only", () => {
  test("the image no longer installs or wires blender", () => {
    expect(dockerfile).not.toContain("blender")
    expect(entrypoint).not.toContain("blender")
    expect(seedConfig).not.toContain("blender")
    expect(seedAgents).not.toContain("blender")
    expect(dockerfile.includes("xauth")).toBe(false)
  })

  test("no blender seed skill directory ships", () => {
    let found = false
    try {
      readFileSync(join(import.meta.dir, "seed/skills/blender/SKILL.md"))
      found = true
    } catch {
      // expected: the directory is gone
    }
    expect(found).toBe(false)
  })

  test("the stuck-tool budget still covers plugin-provided blender CLIs", () => {
    const stuck = readFileSync(
      join(import.meta.dir, "../../apps/control/src/stuck.ts"),
      "utf8",
    )
    expect(stuck).toContain("/^blender-team\\b/")
    expect(stuck).toContain("/^blender\\s/")
  })
})
