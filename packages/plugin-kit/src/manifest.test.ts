import { describe, expect, test } from "bun:test"
import {
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
})
