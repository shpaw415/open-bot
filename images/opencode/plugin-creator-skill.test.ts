import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const skillDir = join(import.meta.dir, "seed/skills/plugin-creator")
const index = readFileSync(join(skillDir, "SKILL.md"), "utf8")
const CARDS = [
  "shape.md",
  "manifest.md",
  "tools-cron.md",
  "pages-theme.md",
  "testing.md",
  "publish.md",
]

describe("plugin-creator seed skill", () => {
  test("the index is loadable and points at every card", () => {
    expect(index).toContain("name: plugin-creator")
    for (const card of CARDS) {
      expect(index).toContain(card)
      expect(existsSync(join(skillDir, card))).toBe(true)
    }
  })

  test("the persona instruction names this skill", () => {
    const personas = readFileSync(
      join(import.meta.dir, "../../apps/control/src/personas.ts"),
      "utf8",
    )
    expect(personas).toContain('"plugin-creator"')
    expect(personas).toContain("plugin-creator skill's guide")
  })

  test("the cards carry the load-bearing conventions", () => {
    const read = (card: string) => readFileSync(join(skillDir, card), "utf8")
    // smallest-shape ladder and runtime token rules
    expect(read("shape.md")).toContain("smallest plugin")
    expect(read("shape.md")).toContain("[cron-agent]")
    // loops and checks run inside scripts, never as repeated agent steps
    expect(read("shape.md")).toContain("Loops live in scripts")
    expect(read("tools-cron.md")).toContain("script over prompt")
    expect(read("tools-cron.md")).toContain("silent-guard pattern")
    expect(read("testing.md")).toContain("silence test")
    // test ladder follows the shipped smoke.test.ts convention
    expect(read("testing.md")).toContain("smoke.test.ts")
    expect(read("testing.md")).toContain("bun test")
    expect(read("testing.md")).toContain("fresh temp directory")
    // theme: variables + dark override + guarded frame APIs
    expect(read("pages-theme.md")).toContain("--surface")
    expect(read("pages-theme.md")).toContain("prefers-color-scheme: dark")
    expect(read("pages-theme.md")).toContain("x-open-bot-page-token")
    // narrow schema reads instead of whole-file dumps
    expect(index).toContain("jq '.properties.dashboard'")
  })
})
