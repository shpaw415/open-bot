import { describe, expect, mock, test } from "bun:test"
import * as shellModule from "./shell"

// Spread the real module: mock.module leaks into later files of the same
// run, so every export must stay present.
let configJson = "{}"
let writtenConfig: string | null = null

mock.module("./shell", () => ({
  ...shellModule,
  sh: async (args: string[], input?: string) => {
    if (args.includes("inspect"))
      return { code: 0, stdout: "true\n", stderr: "" }
    if (args.includes("cat") && args.some((a) => a.endsWith("opencode.json"))) {
      return { code: 0, stdout: configJson, stderr: "" }
    }
    if (args.some((a) => a.includes("oc-provider"))) {
      writtenConfig = input ?? null
      return { code: 0, stdout: "", stderr: "" }
    }
    return { code: 0, stdout: "", stderr: "" }
  },
}))

const {
  applyProviderDisconnect,
  applyProviderEnable,
  disconnectOpencodeProvider,
  disabledProvidersOf,
  enableOpencodeProvider,
} = await import("./docker")

describe("applyProviderDisconnect", () => {
  test("removes an opencode.json config provider entry", () => {
    const config: {
      provider: Record<string, unknown>
      model: string
    } = {
      provider: { meta: { npm: "@ai-sdk/openai" }, "claude-code": {} },
      model: "meta/muse-spark-1.1",
    }
    expect(applyProviderDisconnect(config, "meta")).toBe(true)
    expect(config.provider).toEqual({ "claude-code": {} })
    expect(config.model).toBe("meta/muse-spark-1.1")
  })

  test("disables an env/plugin provider with no config entry", () => {
    const config: { provider: Record<string, unknown> } = { provider: {} }
    expect(applyProviderDisconnect(config, "github-copilot")).toBe(true)
    expect(disabledProvidersOf(config)).toEqual(["github-copilot"])
    // Idempotent: a second disconnect changes nothing.
    expect(applyProviderDisconnect(config, "github-copilot")).toBe(false)
  })

  test("enable removes the disabled entry again", () => {
    const config = { disabled_providers: ["github-copilot", "opencode"] }
    expect(applyProviderEnable(config, "github-copilot")).toBe(true)
    expect(config.disabled_providers).toEqual(["opencode"])
    expect(applyProviderEnable(config, "github-copilot")).toBe(false)
  })
})

describe("disconnectOpencodeProvider IO", () => {
  test("writes the config without the disconnected provider", async () => {
    configJson = JSON.stringify({
      provider: { meta: { npm: "@ai-sdk/openai" } },
    })
    writtenConfig = null
    expect(await disconnectOpencodeProvider("user-1", "meta")).toBe(true)
    expect(JSON.parse(writtenConfig ?? "{}").provider).toEqual({})
  })

  test("enableOpencodeProvider round-trips a disabled provider", async () => {
    configJson = JSON.stringify({ disabled_providers: ["github-copilot"] })
    writtenConfig = null
    expect(await enableOpencodeProvider("user-1", "github-copilot")).toBe(true)
    expect(JSON.parse(writtenConfig ?? "{}").disabled_providers).toEqual([])
  })
})
