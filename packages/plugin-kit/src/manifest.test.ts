import { describe, expect, test } from "bun:test"
import {
  isDevVersion,
  manifestIssuesText,
  parsePluginManifest,
  pluginPermissionSummary,
  renderTemplate,
  resolveCardData,
  validateConfigValue,
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

  test("accepts script and auto cron runs", () => {
    const result = validatePluginManifest({
      ...valid,
      cron: [
        {
          name: "watcher",
          message: "Handle what changed",
          script: "echo '[cron-agent] inbox changed'",
          run: "auto",
          everySeconds: 900,
        },
        {
          name: "snapshot",
          script: "curl -s http://127.0.0.1:4740/api/summary",
          run: "script",
          cronExpr: "0 6 * * *",
        },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.cron?.[0]?.run).toBe("auto")
      expect(result.manifest.cron?.[0]?.script).toContain("cron-agent")
      expect(result.manifest.cron?.[1]?.message).toBeUndefined()
    }
  })

  test("rejects bad cron runs", () => {
    const noScript = validatePluginManifest({
      ...valid,
      cron: [{ name: "x", message: "m", run: "auto", everySeconds: 60 }],
    })
    expect(noScript.ok).toBe(false)
    if (!noScript.ok) {
      expect(manifestIssuesText(noScript.issues)).toContain("cron.script")
    }
    const noMessage = validatePluginManifest({
      ...valid,
      cron: [{ name: "x", run: "both", script: "true", everySeconds: 60 }],
    })
    expect(noMessage.ok).toBe(false)
    if (!noMessage.ok) {
      expect(manifestIssuesText(noMessage.issues)).toContain("cron.message")
    }
    const badRun = validatePluginManifest({
      ...valid,
      cron: [{ name: "x", message: "m", run: "sometimes", everySeconds: 60 }],
    })
    expect(badRun.ok).toBe(false)
    if (!badRun.ok) {
      expect(manifestIssuesText(badRun.issues)).toContain("cron.run")
    }
    const longScript = validatePluginManifest({
      ...valid,
      cron: [
        {
          name: "x",
          message: "m",
          run: "script",
          script: "x".repeat(16001),
          everySeconds: 60,
        },
      ],
    })
    expect(longScript.ok).toBe(false)
    if (!longScript.ok) {
      expect(manifestIssuesText(longScript.issues)).toContain("cron.script")
    }
  })

  test("rejects an iframe tab without a url", () => {
    const result = validatePluginManifest({
      ...valid,
      dashboard: { tabs: [{ id: "x", title: "X", kind: "iframe" }] },
    })
    expect(result.ok).toBe(false)
  })

  test("accepts a page server with app and live page tabs", () => {
    const result = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server/server.js", exec: true }],
      dashboard: {
        pages: { entry: "server.js" },
        tabs: [
          { id: "stock", title: "Stock", kind: "app" },
          { id: "stock", title: "Dup", kind: "app" },
          {
            id: "summary",
            title: "Summary",
            kind: "page",
            dataUrl: "/api/summary",
            pollSeconds: 15,
            cards: [
              { kind: "table", columns: ["Item", "Qty"], rows: "$.rows" },
            ],
          },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = manifestIssuesText(result.issues)
      expect(text).toContain("tab.id must be unique")
      expect(text).not.toContain("app tab needs")
    }
    const good = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server/server.js", exec: true }],
      dashboard: {
        pages: { entry: "server.js" },
        tabs: [
          { id: "stock", title: "Stock", kind: "app", path: "/manage" },
          {
            id: "summary",
            title: "Summary",
            kind: "page",
            dataUrl: "/api/summary",
            pollSeconds: 15,
            cards: [
              { kind: "table", columns: ["Item", "Qty"], rows: "$.rows" },
            ],
          },
        ],
      },
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.manifest.dashboard?.pages?.entry).toBe("server.js")
      expect(good.manifest.dashboard?.tabs?.[0]?.path).toBe("/manage")
      expect(pluginPermissionSummary(good.manifest)).toContain(
        "Serves a live dashboard page (API + UI) from the desktop to the dashboard",
      )
    }
  })

  test("rejects a page server without a matching files[] entry", () => {
    const missing = validatePluginManifest({
      ...valid,
      dashboard: { pages: { entry: "server.js" }, tabs: [] },
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(manifestIssuesText(missing.issues)).toContain(
        "dashboard.pages.entry",
      )
    }
    const badName = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: { pages: { entry: "Server JS" }, tabs: [] },
    })
    expect(badName.ok).toBe(false)
  })

  test("page server public flag must be a boolean", () => {
    const good = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: { pages: { entry: "server.js", public: true }, tabs: [] },
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.manifest.dashboard?.pages?.public).toBe(true)
    }
    const bad = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: {
        pages: { entry: "server.js", public: "yes" } as never,
        tabs: [],
      },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(manifestIssuesText(bad.issues)).toContain("dashboard.pages.public")
    }
  })

  test("app tabs require the page server and sane paths", () => {
    const noPages = validatePluginManifest({
      ...valid,
      dashboard: { tabs: [{ id: "x", title: "X", kind: "app" }] },
    })
    expect(noPages.ok).toBe(false)
    if (!noPages.ok) {
      expect(manifestIssuesText(noPages.issues)).toContain(
        "app tab needs dashboard.pages.entry",
      )
    }
    const badPath = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: {
        pages: { entry: "server.js" },
        tabs: [{ id: "x", title: "X", kind: "app", path: "/../etc" }],
      },
    })
    expect(badPath.ok).toBe(false)
  })

  test("tab icons accept emoji or icon names and reject URLs", () => {
    const withIcon = (icon: unknown) =>
      validatePluginManifest({
        ...valid,
        dashboard: {
          tabs: [
            {
              id: "x",
              title: "X",
              kind: "iframe",
              url: "https://a.b",
              icon,
            } as never,
          ],
        },
      })
    expect(withIcon("📈").ok).toBe(true)
    expect(withIcon("chart").ok).toBe(true)
    expect(withIcon("").ok).toBe(false)
    expect(withIcon("https://evil.example/x.png").ok).toBe(false)
    expect(withIcon("<script>").ok).toBe(false)
    expect(withIcon("x".repeat(33)).ok).toBe(false)
  })

  test("page tab dataUrl and pollSeconds validate", () => {
    const base = {
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: {
        pages: { entry: "server.js" },
        tabs: [
          {
            id: "s",
            title: "S",
            kind: "page",
            dataUrl: "api/relative",
            cards: [{ kind: "markdown", text: "hi" }],
          },
        ],
      },
    }
    expect(validatePluginManifest(base).ok).toBe(false)
    const badPoll = validatePluginManifest({
      ...valid,
      files: [{ name: "server.js", source: "server.js" }],
      dashboard: {
        pages: { entry: "server.js" },
        tabs: [
          {
            id: "s",
            title: "S",
            kind: "page",
            pollSeconds: 15,
            cards: [{ kind: "markdown", text: "hi" }],
          },
        ],
      },
    })
    expect(badPoll.ok).toBe(false)
    if (!badPoll.ok) {
      const text = manifestIssuesText(badPoll.issues)
      expect(text).toContain("pollSeconds needs a dataUrl")
    }
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

  test("accepts typed configs", () => {
    const result = validatePluginManifest({
      ...valid,
      configs: [
        {
          key: "units",
          label: "Units",
          def: "metric",
          type: "enum",
          options: ["metric", "imperial"],
        },
        { key: "alerts", label: "Alerts", def: "true", type: "bool" },
        { key: "days", label: "Days", def: "3", type: "number" },
        { key: "token", label: "Token", def: "", type: "secret" },
        { key: "note", label: "Note", def: "plain" },
        { key: "legacy", label: "Legacy", def: "", secret: true },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.configs).toHaveLength(6)
      const summary = pluginPermissionSummary(result.manifest)
      expect(summary).toContain("Adds settings")
    }
  })

  test("rejects bad config types and defs", () => {
    const badType = validatePluginManifest({
      ...valid,
      configs: [{ key: "a", label: "A", def: "", type: "float" }],
    })
    expect(badType.ok).toBe(false)
    const enumWithoutOptions = validatePluginManifest({
      ...valid,
      configs: [{ key: "a", label: "A", def: "x", type: "enum" }],
    })
    expect(enumWithoutOptions.ok).toBe(false)
    if (!enumWithoutOptions.ok) {
      expect(manifestIssuesText(enumWithoutOptions.issues)).toContain(
        "config.options",
      )
    }
    const enumDefMismatch = validatePluginManifest({
      ...valid,
      configs: [
        { key: "a", label: "A", def: "nope", type: "enum", options: ["yes"] },
      ],
    })
    expect(enumDefMismatch.ok).toBe(false)
    const badBool = validatePluginManifest({
      ...valid,
      configs: [{ key: "a", label: "A", def: "maybe", type: "bool" }],
    })
    expect(badBool.ok).toBe(false)
    const badNumber = validatePluginManifest({
      ...valid,
      configs: [{ key: "a", label: "A", def: "soon", type: "number" }],
    })
    expect(badNumber.ok).toBe(false)
  })

  test("number configs validate min/max bounds", () => {
    const config = {
      key: "a",
      label: "A",
      def: "50",
      type: "number" as const,
      min: 0,
      max: 100,
    }
    expect(validateConfigValue(config, "0")).toEqual({ ok: true, value: "0" })
    expect(validateConfigValue(config, "100")).toEqual({
      ok: true,
      value: "100",
    })
    expect(validateConfigValue(config, "200")).toMatchObject({ ok: false })
    expect(validateConfigValue(config, -5)).toMatchObject({ ok: false })

    const badManifest = validatePluginManifest({
      ...valid,
      configs: [
        {
          key: "a",
          label: "A",
          def: "x",
          type: "enum",
          options: ["x"],
          min: 1,
        },
      ],
    })
    expect(badManifest.ok).toBe(false)
    const crossed = validatePluginManifest({
      ...valid,
      configs: [
        { key: "a", label: "A", def: "5", type: "number", min: 10, max: 1 },
      ],
    })
    expect(crossed.ok).toBe(false)
    const badDef = validatePluginManifest({
      ...valid,
      configs: [{ key: "a", label: "A", def: "50", type: "number", max: 10 }],
    })
    expect(badDef.ok).toBe(false)
    const good = validatePluginManifest({
      ...valid,
      configs: [
        { key: "a", label: "A", def: "50", type: "number", min: 0, max: 100 },
      ],
    })
    expect(good.ok).toBe(true)
  })

  test("hooks validate event names and messages", () => {
    const good = validatePluginManifest({
      ...valid,
      hooks: [{ event: "session.idle", message: "Check the thread" }],
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.manifest.hooks).toHaveLength(1)
      const summary = pluginPermissionSummary(good.manifest)
      expect(
        summary.some((line) =>
          line.startsWith("Runs agent sessions on thread events"),
        ),
      ).toBe(true)
    }
    const badEvent = validatePluginManifest({
      ...valid,
      hooks: [{ event: "desktop.exploded", message: "boom" }],
    })
    expect(badEvent.ok).toBe(false)
    const badMessage = validatePluginManifest({
      ...valid,
      hooks: [{ event: "thread.created", message: "" }],
    })
    expect(badMessage.ok).toBe(false)
    const tooMany = validatePluginManifest({
      ...valid,
      hooks: Array.from({ length: 9 }, (_, index) => ({
        event: "session.idle",
        message: `hook ${index}`,
      })),
    })
    expect(tooMany.ok).toBe(false)
  })
})

describe("validateConfigValue", () => {
  test("strings pass through and cap length", () => {
    expect(
      validateConfigValue({ key: "a", label: "A", def: "" }, "hi"),
    ).toEqual({ ok: true, value: "hi" })
    expect(
      validateConfigValue({ key: "a", label: "A", def: "" }, "x".repeat(2001)),
    ).toMatchObject({ ok: false })
  })

  test("bools coerce accepted spellings and reject the rest", () => {
    const config = { key: "a", label: "A", def: "false", type: "bool" as const }
    expect(validateConfigValue(config, true)).toEqual({
      ok: true,
      value: "true",
    })
    expect(validateConfigValue(config, false)).toEqual({
      ok: true,
      value: "false",
    })
    expect(validateConfigValue(config, "1")).toEqual({
      ok: true,
      value: "true",
    })
    expect(validateConfigValue(config, "FALSE")).toEqual({
      ok: true,
      value: "false",
    })
    expect(validateConfigValue(config, "maybe")).toMatchObject({ ok: false })
  })

  test("numbers must parse", () => {
    const config = { key: "a", label: "A", def: "", type: "number" as const }
    expect(validateConfigValue(config, "3.5")).toEqual({
      ok: true,
      value: "3.5",
    })
    expect(validateConfigValue(config, 7)).toEqual({ ok: true, value: "7" })
    expect(validateConfigValue(config, "")).toEqual({ ok: true, value: "" })
    expect(validateConfigValue(config, "soon")).toMatchObject({ ok: false })
  })

  test("enums must be declared options", () => {
    const config = {
      key: "a",
      label: "A",
      def: "metric",
      type: "enum" as const,
      options: ["metric", "imperial"],
    }
    expect(validateConfigValue(config, "imperial")).toEqual({
      ok: true,
      value: "imperial",
    })
    expect(validateConfigValue(config, "kelvin")).toMatchObject({ ok: false })
  })

  test("secret configs behave like strings", () => {
    const config = { key: "a", label: "A", def: "", type: "secret" as const }
    expect(validateConfigValue(config, "hunter2")).toEqual({
      ok: true,
      value: "hunter2",
    })
  })
})
