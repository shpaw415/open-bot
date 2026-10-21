import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AGENT_NAME_PATTERN,
  COMMAND_PATTERN,
  FILE_NAME_PATTERN,
  GITHUB_REPO_PATTERN,
  MCP_NAME_PATTERN,
  PLUGIN_CONFIG_TYPES,
  PLUGIN_HOOK_EVENTS,
  PLUGIN_ID_PATTERN,
  PLUGIN_PRICING_MODELS,
  PLUGIN_VERSION_PATTERN,
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
  REVIEW_PAYLOAD_FILE_CHARS,
  REVIEW_PAYLOAD_TOTAL_CHARS,
  REVIEW_TAR_PATH_MAX,
  SLUG_PATTERN,
  TAB_ICON_MAX_LENGTH,
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
    expect(top.personas.items.properties.skills.items.pattern).toBe(slug)
    expect(top.personas.items.properties.skills.maxItems).toBe(64)
    expect(top.personas.items.properties.mcp.items.pattern).toBe(
      MCP_NAME_PATTERN.source,
    )
    expect(top.personas.items.properties.mcp.maxItems).toBe(16)
    expect(top.tools.items.properties.name.pattern).toBe(slug)
    expect(top.configs.items.properties.key.pattern).toBe(slug)
    expect(top.dashboard.properties.tabs.items.properties.id.pattern).toBe(slug)
    expect(
      top.dashboard.properties.mentions.items.properties.section.pattern,
    ).toBe(slug)
    expect(top.textbox.properties.renderers.items.properties.type.pattern).toBe(
      slug,
    )
    expect(top.textbox.properties.buttons.items.properties.id.pattern).toBe(
      slug,
    )
    expect(top.files.items.properties.name.pattern).toBe(
      FILE_NAME_PATTERN.source,
    )
    expect(top.dashboard.properties.pages.properties.entry.pattern).toBe(
      FILE_NAME_PATTERN.source,
    )
    expect(top.dashboard.properties.pages.properties.public.type).toBe(
      "boolean",
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
    expect(top.pricing.properties.model.enum).toEqual(PLUGIN_PRICING_MODELS)
    expect(top.pricing.properties.amount.minimum).toBe(PRICE_MIN_CENTS)
    expect(top.pricing.properties.amount.maximum).toBe(PRICE_MAX_CENTS)
    expect(top.skills.items.properties.description.maxLength).toBe(1024)
    expect(top.skills.items.properties.body.maxLength).toBe(65536)
    expect(top.skills.items.properties.group.maxLength).toBe(48)
    expect(top.personas.items.properties.instruction.maxLength).toBe(2000)
    expect(top.personas.items.properties.skills.maxItems).toBe(64)
    expect(top.cron.items.properties.message.maxLength).toBe(8000)
    expect(top.cron.items.properties.run.enum).toEqual([
      "prompt",
      "script",
      "both",
      "auto",
    ])
    expect(top.cron.items.properties.script.maxLength).toBe(16000)
    expect(top.cron.items.required).toEqual(["name"])
    expect(top.cron.items.oneOf).toEqual([
      { required: ["everySeconds"] },
      { required: ["cronExpr"] },
    ])
    expect(top.cron.items.properties.everySeconds.minimum).toBe(60)
    expect(top.cron.items.properties.everySeconds.maximum).toBe(31536000)
    expect(top.tools.items.properties.content.maxLength).toBe(65536)
    expect(top.files.maxItems).toBe(32)
    expect(top.configs.maxItems).toBe(64)
    expect(top.configs.items.properties.type.enum).toEqual(PLUGIN_CONFIG_TYPES)
    expect(top.configs.items.properties.options.maxItems).toBe(16)
    expect(top.configs.items.properties.options.items.maxLength).toBe(100)
    expect(top.hooks.maxItems).toBe(8)
    expect(top.hooks.items.properties.event.enum).toEqual(PLUGIN_HOOK_EVENTS)
    expect(top.hooks.items.properties.message.maxLength).toBe(2000)
    expect(
      top.dashboard.properties.tabs.items.properties.dataUrl.maxLength,
    ).toBe(200)
    expect(top.dashboard.properties.tabs.items.properties.icon.maxLength).toBe(
      TAB_ICON_MAX_LENGTH,
    )
    expect(
      top.dashboard.properties.tabs.items.properties.pollSeconds.minimum,
    ).toBe(5)
    expect(
      top.dashboard.properties.tabs.items.properties.pollSeconds.maximum,
    ).toBe(3600)
    expect(top.dashboard.properties.mentions.maxItems).toBe(4)
    expect(
      top.dashboard.properties.mentions.items.properties.label.maxLength,
    ).toBe(32)
    expect(
      top.dashboard.properties.mentions.items.properties.path.maxLength,
    ).toBe(200)
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

  test("files[] docs tell the review-caps and exec truth", () => {
    // The schema is author-facing documentation: the exec flag must not claim
    // a default the installers don't implement, and the source description
    // must state the security-review window instead of a storage limit.
    const sourceDesc = (
      top.files.items.properties.source.description as string
    ).replace(/,/g, "")
    expect(sourceDesc).toContain(String(REVIEW_PAYLOAD_FILE_CHARS))
    expect(sourceDesc).toContain(String(REVIEW_PAYLOAD_TOTAL_CHARS))
    expect(sourceDesc).toContain(String(REVIEW_TAR_PATH_MAX))
    expect(sourceDesc).not.toContain("10 MB")
    expect(top.files.items.properties.exec.description).toContain("executable")
    expect(top.files.items.properties.exec.default).toBe(false)
    // Tools stay default-executable (they are installed as bin scripts).
    expect(top.tools.items.properties.exec.default).toBe(true)
  })
})
