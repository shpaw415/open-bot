import { describe, expect, test } from "bun:test"
import {
  isDevVersion,
  manifestIssuesText,
  parsePluginManifest,
  pluginPermissionSummary,
  renderTemplate,
  resolveCardData,
  validatePluginManifest,
} from "./manifest"

const valid = {
  id: "weather-pro",
  name: "Weather Pro",
  version: "1.0.0",
  description: "Weather lookups and daily forecasts.",
  author: "open-bot",
  repo: "shpaw415/open-bot-plugin-weather-pro",
  category: "utilities",
  tags: ["weather"],
  skills: [
    {
      name: "weather",
      description: "Look up weather with the weather CLI",
      body: "# Weather\n\nRun weather <city>.",
    },
  ],
  personas: [{ name: "Meteorologist", instruction: "Talk weather." }],
  cron: [
    {
      name: "daily-weather",
      message: "Summarize the weather",
      everySeconds: 86400,
    },
  ],
  configs: [{ key: "units", label: "Units", def: "metric" }],
  dashboard: {
    tabs: [
      {
        id: "weather",
        title: "Weather",
        kind: "page",
        cards: [{ kind: "markdown", text: "# Weather" }],
      },
    ],
  },
  textbox: {
    renderers: [
      {
        type: "weather-card",
        title: "Weather card",
        spec: [{ kind: "stat", label: "City", value: "$.city" }],
      },
    ],
    commands: [
      { command: "weather", title: "Weather", template: "Weather in {input}?" },
    ],
  },
}

describe("plugin manifest", () => {
  test("accepts a valid manifest", () => {
    const result = validatePluginManifest(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe("weather-pro")
      expect(result.manifest.permissions?.vaultRead).toEqual([])
      expect(pluginPermissionSummary(result.manifest)).toContain(
        "Installs agent skills",
      )
    }
  })

  test("rejects a bad id and version", () => {
    const result = validatePluginManifest({
      ...valid,
      id: "Bad Id",
      version: "1.0",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = manifestIssuesText(result.issues)
      expect(text).toContain("id")
      expect(text).toContain("version")
    }
  })

  test("accepts dev tags and prereleases as versions", () => {
    for (const version of ["beta-1", "staging.2", "1.2.3-beta.1"]) {
      const result = validatePluginManifest({ ...valid, version })
      expect(result.ok).toBe(true)
      if (result.ok) expect(isDevVersion(result.manifest.version)).toBe(true)
    }
    expect(isDevVersion("1.0.0")).toBe(false)
  })

  test("rejects cron with both schedules", () => {
    const result = validatePluginManifest({
      ...valid,
      cron: [
        { name: "x", message: "m", everySeconds: 60, cronExpr: "* * * * *" },
      ],
    })
    expect(result.ok).toBe(false)
  })

  test("rejects an iframe tab without a url", () => {
    const result = validatePluginManifest({
      ...valid,
      dashboard: { tabs: [{ id: "x", title: "X", kind: "iframe" }] },
    })
    expect(result.ok).toBe(false)
  })

  test("rejects a bad regex validator", () => {
    const result = validatePluginManifest({
      ...valid,
      textbox: {
        validators: [{ pattern: "([", message: "no" }],
      },
    })
    expect(result.ok).toBe(false)
  })

  test("accepts setup commands and reports them", () => {
    const result = validatePluginManifest({
      ...valid,
      setup: {
        commands: [
          "sudo apt-get install -y figlet",
          "pip install --user cowsay",
        ],
        uninstall: ["sudo apt-get remove -y figlet"],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.setup?.commands).toHaveLength(2)
      expect(result.manifest.setup?.uninstall).toEqual([
        "sudo apt-get remove -y figlet",
      ])
      const summary = pluginPermissionSummary(result.manifest)
      expect(summary).toContain(
        "Runs 2 shell commands as root in the desktop at install and on every desktop start",
      )
      expect(summary).toContain("Runs shell commands on uninstall")
    }
  })

  test("rejects bad setup commands", () => {
    const empty = validatePluginManifest({
      ...valid,
      setup: { commands: ["   "] },
    })
    expect(empty.ok).toBe(false)
    const tooLong = validatePluginManifest({
      ...valid,
      setup: { commands: ["x".repeat(501)] },
    })
    expect(tooLong.ok).toBe(false)
    const tooMany = validatePluginManifest({
      ...valid,
      setup: { commands: Array.from({ length: 17 }, () => "true") },
    })
    expect(tooMany.ok).toBe(false)
    const notStrings = validatePluginManifest({
      ...valid,
      setup: { uninstall: [42] },
    })
    expect(notStrings.ok).toBe(false)
  })

  test("parses raw JSON", () => {
    const result = parsePluginManifest(JSON.stringify(valid))
    expect(result.ok).toBe(true)
    expect(parsePluginManifest("{").ok).toBe(false)
  })

  test("fills vault permissions", () => {
    const result = validatePluginManifest({
      ...valid,
      permissions: {
        vaultRead: ["openai"],
        vaultCreate: ["weatherapi"],
        desktopTools: true,
      },
      tools: [{ name: "weather", content: "#!/bin/sh\n" }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.permissions?.vaultRead).toEqual(["openai"])
      expect(pluginPermissionSummary(result.manifest)).toContain(
        "Installs tools in the desktop container",
      )
    }
  })

  test("resolves card data paths and templates", () => {
    const card = resolveCardData(
      { kind: "table", columns: ["a"], rows: "$.rows" },
      { rows: [[1, 2]] },
    )
    expect(card.rows).toEqual([["1", "2"]])
    expect(renderTemplate("Weather in {input}?", { input: "Paris" })).toBe(
      "Weather in Paris?",
    )
    expect(renderTemplate("Keep {missing}", {})).toBe("Keep {missing}")
  })

  test("accepts payload files and reports them", () => {
    const result = validatePluginManifest({
      ...valid,
      files: [
        { name: "addon.py", source: "files/addon.py" },
        { name: "runner", source: "files/runner.sh", exec: true },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.files).toHaveLength(2)
      const summary = pluginPermissionSummary(result.manifest)
      expect(summary).toContain(
        "Installs 2 payload files from the reviewed release into the desktop",
      )
    }
  })

  test("rejects bad file names and sources", () => {
    const result = validatePluginManifest({
      ...valid,
      files: [
        { name: "Addon", source: "files/addon.py" },
        { name: "ok.py", source: "/etc/passwd" },
        { name: "ok2.py", source: "../secrets" },
        { name: "dup.py", source: "files/dup.py" },
        { name: "dup.py", source: "files/other.py" },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = manifestIssuesText(result.issues)
      expect(text).toContain("files[0]")
      expect(text).toContain("files[1]")
      expect(text).toContain("files[2]")
      expect(text).toContain("files[4]")
    }
  })

  test("accepts opencode agents and agentTools", () => {
    const result = validatePluginManifest({
      ...valid,
      opencode: {
        agents: {
          "worker-x": { mode: "all", hidden: true, prompt: "Work." },
        },
        agentTools: { build: { "workerx_*": false } },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const summary = pluginPermissionSummary(result.manifest)
      expect(summary).toContain("Adds agent workers: worker-x")
      expect(summary).toContain("Adjusts agent tools for: build")
    }
  })

  test("rejects reserved agent names and bad globs", () => {
    const result = validatePluginManifest({
      ...valid,
      opencode: {
        agents: { build: { prompt: "hijack" } },
        agentTools: { build: { "bad glob!!": true, ok_glob: "yes" } },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = manifestIssuesText(result.issues)
      expect(text).toContain("reserved")
      expect(text).toContain("opencode.agentTools.build")
      expect(text.match(/tool glob must be/g) ?? []).toHaveLength(1)
      expect(text.match(/must be a boolean/g) ?? []).toHaveLength(1)
    }
  })

  test("accepts agentsMd as the only opencode surface", () => {
    const result = validatePluginManifest({
      ...valid,
      opencode: {
        agentsMd:
          "Always check the weather CLI before answering weather questions.",
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.opencode?.agentsMd).toContain("weather CLI")
      const summary = pluginPermissionSummary(result.manifest)
      expect(summary).toContain(
        "Adds standing instructions to the agent (AGENTS.md)",
      )
    }
  })

  test("rejects bad agentsMd", () => {
    const empty = validatePluginManifest({
      ...valid,
      opencode: { agentsMd: "   " },
    })
    expect(empty.ok).toBe(false)
    const notString = validatePluginManifest({
      ...valid,
      opencode: { agentsMd: 42 },
    })
    expect(notString.ok).toBe(false)
    const tooLong = validatePluginManifest({
      ...valid,
      opencode: { agentsMd: "x".repeat(4001) },
    })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(manifestIssuesText(tooLong.issues)).toContain("opencode.agentsMd")
    }
  })
})
