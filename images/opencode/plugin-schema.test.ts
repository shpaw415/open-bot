import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const entrypoint = readFileSync(join(import.meta.dir, "entrypoint.sh"), "utf8")
const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
const seedSkill = readFileSync(
  join(import.meta.dir, "seed/skills/plugin/SKILL.md"),
  "utf8",
)
const schema = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "../../packages/plugin-kit/schema/open-bot.plugin.schema.json",
    ),
    "utf8",
  ),
)

describe("plugin manifest schema", () => {
  // The Dockerfile copies the canonical plugin-kit schema into the seed tree
  // and the entrypoint seeds it next to the plugin skill.
  test("ships into the image from the plugin-kit source of truth", () => {
    expect(dockerfile).toContain(
      "COPY packages/plugin-kit/schema/open-bot.plugin.schema.json /opt/open-bot/seed/skills/plugin/open-bot.plugin.schema.json",
    )
    expect(entrypoint).toContain(
      "cp /opt/open-bot/seed/skills/plugin/open-bot.plugin.schema.json /home/agent/.config/opencode/skills/plugin/open-bot.plugin.schema.json",
    )
  })

  test("the seed skill points the agent at the schema", () => {
    expect(seedSkill).toContain(
      "~/.config/opencode/skills/plugin/open-bot.plugin.schema.json",
    )
  })

  test("the schema declares the agentsMd surface", () => {
    expect(schema.properties.opencode.properties.agentsMd.maxLength).toBe(4000)
  })
})
