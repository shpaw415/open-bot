import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AGENT_NAME_PATTERN,
  COMMAND_PATTERN,
  FILE_NAME_PATTERN,
  GITHUB_REPO_PATTERN,
  PLUGIN_ID_PATTERN,
  PLUGIN_VERSION_PATTERN,
  SLUG_PATTERN,
  TOOL_GLOB_PATTERN,
} from "./manifest"

type Schema = Record<string, any>

// Regex literals keep an escaped "/" in .source (\/) while JSON stores it raw.
const source = (pattern: string) => pattern.replace(/\\\//g, "/")

const schema = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../schema/open-bot.plugin.schema.json"),
    "utf8",
  ),
) as Schema

// The schema is the authoring surface (editors + the desktop agent). It must
// not drift from the authoritative validator constants in manifest.ts.
describe("plugin schema", () => {
  const top = schema.properties

  test("mirrors the validator patterns", () => {
    expect(top.id.pattern).toBe(PLUGIN_ID_PATTERN.source)
    expect(top.version.pattern).toBe(PLUGIN_VERSION_PATTERN.source)
    expect(new RegExp(top.version.pattern).test("beta-1")).toBe(true)
    expect(new RegExp(top.version.pattern).test("1.2.3-beta.1")).toBe(true)
    expect(new RegExp(top.version.pattern).test("1.0")).toBe(false)
    expect(source(top.repo.pattern)).toBe(source(GITHUB_REPO_PATTERN.source))
    const slug = SLUG_PATTERN.source
    expect(top.permissions.properties.vaultRead.items.pattern).toBe(slug)
    expect(top.skills.items.properties.name.pattern).toBe(slug)
    expect(top.tools.items.properties.name.pattern).toBe(slug)
    expect(top.configs.items.properties.key.pattern).toBe(slug)
    expect(top.dashboard.properties.tabs.items.properties.id.pattern).toBe(slug)
    expect(top.textbox.properties.renderers.items.properties.type.pattern).toBe(
      slug,
    )
    expect(top.textbox.properties.buttons.items.properties.id.pattern).toBe(
      slug,
    )
    expect(top.files.items.properties.name.pattern).toBe(
      FILE_NAME_PATTERN.source,
    )
    expect(
      source(top.textbox.properties.commands.items.properties.command.pattern),
    ).toBe(source(COMMAND_PATTERN.source))
    const agentNames = top.opencode.properties.agents.propertyNames
    expect(agentNames.pattern).toBe(AGENT_NAME_PATTERN.source)
    expect(agentNames.not.enum).toEqual([
      "build",
      "plan",
      "general",
      "title",
      "namer",
    ])
    expect(
      top.opencode.properties.agentTools.additionalProperties.propertyNames
        .pattern,
    ).toBe(TOOL_GLOB_PATTERN.source)
  })

  test("mirrors the validator limits", () => {
    expect(top.name.maxLength).toBe(64)
    expect(top.description.maxLength).toBe(500)
    expect(top.author.maxLength).toBe(64)
    expect(top.category.maxLength).toBe(32)
    expect(top.tags.maxItems).toBe(8)
    expect(top.skills.items.properties.description.maxLength).toBe(1024)
    expect(top.skills.items.properties.body.maxLength).toBe(65536)
    expect(top.personas.items.properties.instruction.maxLength).toBe(2000)
    expect(top.cron.items.properties.message.maxLength).toBe(8000)
    expect(top.cron.items.properties.everySeconds.minimum).toBe(60)
    expect(top.cron.items.properties.everySeconds.maximum).toBe(31536000)
    expect(top.tools.items.properties.content.maxLength).toBe(65536)
    expect(top.files.maxItems).toBe(32)
    expect(top.configs.maxItems).toBe(64)
    expect(top.setup.properties.commands.maxItems).toBe(16)
    expect(top.setup.properties.commands.items.maxLength).toBe(500)
    expect(
      top.textbox.properties.commands.items.properties.template.maxLength,
    ).toBe(2000)
    expect(top.opencode.properties.agentsMd.maxLength).toBe(4000)
    expect(schema.required).toEqual([
      "id",
      "name",
      "version",
      "description",
      "author",
      "repo",
      "category",
    ])
  })

  test("rejects unknown top-level keys", () => {
    expect(schema.additionalProperties).toBe(false)
    expect(top.$schema).toBeDefined()
  })
})
