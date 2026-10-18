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
      "for skill_dir in /opt/open-bot/seed/skills/*/",
    )
  })

  test("the seed skill points the agent at the schema", () => {
    expect(seedSkill).toContain(
      "~/.config/opencode/skills/plugin/open-bot.plugin.schema.json",
    )
  })

  // The agent wrote a plugin with a broken proxy config when the skill only
  // named the proxy URL and never the mapping — keep the contract in the doc.
  test("the seed skill documents the page-proxy path contract", () => {
    // Prefix stripping: the server sees the bare path.
    expect(seedSkill).toContain("stripped before forwarding")
    // tab.path/dataUrl are server routes; the dashboard prepends its prefix.
    expect(seedSkill).toContain("routes on your server")
    expect(seedSkill).toContain("never repeat `/api/pages/...`")
    // The JS-vs-HTML rewrite asymmetry and the header contract.
    expect(seedSkill).toContain("JavaScript is never rewritten")
    expect(seedSkill).toContain("`cookie`, `authorization`")
    // All three tab kinds are documented.
    expect(seedSkill).toContain('kind: "iframe"')
  })

  test("the schema descriptions teach the prefix stripping", () => {
    expect(
      schema.properties.dashboard.properties.pages.properties.entry.description,
    ).toContain("stripped")
    const tabs = schema.properties.dashboard.properties.tabs.items.properties
    expect(tabs.path.description).toContain("stripped")
    expect(tabs.dataUrl.description).toContain("stripped")
  })

  test("the schema declares the agentsMd surface", () => {
    expect(schema.properties.opencode.properties.agentsMd.maxLength).toBe(4000)
  })
})
