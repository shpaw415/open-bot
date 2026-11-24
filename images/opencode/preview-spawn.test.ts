import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolvePluginId } from "./preview-spawn"

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "preview-spawn-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe("resolvePluginId (#120)", () => {
  test("a plugin served from its server/ entry gets the manifest id, not 'server'", () => {
    const root = fixture()
    const plugin = join(root, "web-blueprint")
    mkdirSync(join(plugin, "server"), { recursive: true })
    writeFileSync(
      join(plugin, "open-bot.plugin.json"),
      JSON.stringify({ id: "web-blueprint" }),
    )
    writeFileSync(join(plugin, "server", "server.ts"), "// entry\n")
    expect(resolvePluginId(join(plugin, "server"), "server.ts", {})).toBe(
      "web-blueprint",
    )
    expect(resolvePluginId(plugin, "server/server.ts", {})).toBe(
      "web-blueprint",
    )
  })

  test("an explicit env id is never overwritten", () => {
    const root = fixture()
    expect(
      resolvePluginId(join(root, "anything"), "", {
        OPEN_BOT_PLUGIN_ID: "kept-id",
      }),
    ).toBe("kept-id")
  })

  test("without a manifest, generic dirs defer to their parent name", () => {
    const root = fixture()
    mkdirSync(join(root, "my-plugin", "server"), { recursive: true })
    expect(resolvePluginId(join(root, "my-plugin", "server"), "", {})).toBe(
      "my-plugin",
    )
    expect(resolvePluginId(join(root, "plain-app"), "", {})).toBe("plain-app")
  })

  test("an unparseable or invalid manifest falls back to directory names", () => {
    const root = fixture()
    const plugin = join(root, "broken-plugin")
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, "open-bot.plugin.json"), "{nope")
    expect(resolvePluginId(plugin, "", {})).toBe("broken-plugin")
    writeFileSync(
      join(plugin, "open-bot.plugin.json"),
      JSON.stringify({ id: "Not A Slug!" }),
    )
    expect(resolvePluginId(plugin, "", {})).toBe("broken-plugin")
  })
})
