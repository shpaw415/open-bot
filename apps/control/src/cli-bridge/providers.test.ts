import { expect, test } from "bun:test"
import {
  bridgeMcpServers,
  claudeMcpConfig,
  cliProviders,
  filterCliModels,
  flattenMessages,
  looksLoggedOut,
  mergeCliProviderConfig,
  museFailedMcpServer,
  museMcpPlan,
  opencodeCliProviderConfig,
  openVikingMcpServer,
  parseClaudeLine,
  parseCliStatus,
  parseMuseLine,
  routeCliModel,
} from "./providers"

test("registry covers both CLIs with unique bare model ids", () => {
  expect(cliProviders.map((item) => item.id)).toEqual([
    "claude-code",
    "muse-code",
  ])
  const ids = cliProviders.flatMap((item) =>
    item.models.map((model) => model.id),
  )
  expect(new Set(ids).size).toBe(ids.length)
})

test("routeCliModel routes bare and prefixed ids, rejects unknown", () => {
  expect(routeCliModel("opus")?.provider.id).toBe("claude-code")
  expect(routeCliModel("claude-code/sonnet")?.model.cliModel).toBe("sonnet")
  expect(routeCliModel("default")?.provider.id).toBe("muse-code")
  expect(routeCliModel("default")?.model.cliModel).toBeNull()
  expect(routeCliModel("gpt-5")).toBeNull()
})

test("opencode config has bridge URL, no apiKey, effort variants", () => {
  const config = opencodeCliProviderConfig() as Record<
    string,
    {
      options: Record<string, unknown>
      models: Record<string, { variants: Record<string, unknown> }>
    }
  >
  for (const id of ["claude-code", "muse-code"]) {
    expect(config[id]?.options.baseURL).toBe("http://127.0.0.1:4760/v1")
    expect(config[id]?.options.apiKey).toBeUndefined()
  }
  expect(config["claude-code"]?.models.opus?.variants.high).toEqual({
    reasoningEffort: "high",
  })
})

test("mergeCliProviderConfig preserves user providers, wins its own ids", () => {
  const merged = mergeCliProviderConfig({
    model: "openai/gpt-5",
    provider: {
      mine: { npm: "@ai-sdk/openai-compatible" },
      "claude-code": { stale: true },
    },
  }) as { model?: string; provider: Record<string, Record<string, unknown>> }
  expect(merged.model).toBe("openai/gpt-5")
  expect(merged.provider.mine?.npm).toBe("@ai-sdk/openai-compatible")
  expect(merged.provider["claude-code"]?.stale).toBeUndefined()
  expect(merged.provider["claude-code"]?.npm).toBe("@ai-sdk/openai-compatible")
  expect(merged.provider["muse-code"]).toBeDefined()
})

test("flattenMessages: single user turn stays a bare prompt", () => {
  const flat = flattenMessages([
    { role: "system", content: "be terse" },
    { role: "user", content: "hello" },
  ])
  expect(flat.prompt).toBe("hello")
  expect(flat.system).toContain("be terse")
  expect(flat.system).toContain("CLI bridge")
})

test("flattenMessages: history becomes a transcript, tool results capped", () => {
  const flat = flattenMessages([
    { role: "system", content: "s" },
    { role: "user", content: "first" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "bash" } }],
    },
    { role: "tool", content: "x".repeat(9000), name: "bash" },
    { role: "user", content: [{ type: "text", text: "second" }] },
  ])
  expect(flat.prompt).toContain("User: first")
  expect(flat.prompt).toContain("called tools: bash")
  expect(flat.prompt).toContain("User: second")
  // transcript + one capped tool result, not 9000 chars of x
  expect((flat.prompt.match(/x/g) ?? []).length).toBeLessThanOrEqual(4000)
})

test("flattenMessages: data-url images extracted, placeholder in text", () => {
  const flat = flattenMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
      ],
    },
  ])
  expect(flat.images).toEqual([{ mediaType: "image/png", dataBase64: "AAA=" }])
  expect(flat.prompt).toContain("[image attached]")
})

test("parseClaudeLine: deltas, assistant fallback, result usage + error", () => {
  expect(
    parseClaudeLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hi" },
        },
      }),
    ),
  ).toEqual({ delta: "hi" })
  expect(
    parseClaudeLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "…" },
        },
      }),
    ),
  ).toBeNull()
  expect(
    parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "full" }, { type: "tool_use" }],
        },
      }),
    ),
  ).toEqual({ assistantText: "full" })
  const result = parseClaudeLine(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 },
    }),
  )
  expect(result?.result).toEqual({
    text: "done",
    isError: false,
    usage: { promptTokens: 15, completionTokens: 3 },
  })
  expect(
    parseClaudeLine(
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        result: "boom",
      }),
    )?.result?.isError,
  ).toBe(true)
  expect(parseClaudeLine("not json")).toBeNull()
})

test("parseMuseLine: run.output.delta only, banners skipped", () => {
  expect(
    parseMuseLine(
      JSON.stringify({
        payload_type: "run.output.delta",
        payload: { kind: "run_output_delta", text: "echo: hi" },
      }),
    ),
  ).toEqual({ delta: "echo: hi" })
  expect(
    parseMuseLine(
      JSON.stringify({ payload_type: "run.lifecycle.started", payload: {} }),
    ),
  ).toBeNull()
  expect(parseMuseLine("muse: workspace root: /tmp")).toBeNull()
})

test("looksLoggedOut matches both CLIs' auth failures", () => {
  expect(looksLoggedOut("Not logged in · Please run /login")).toBe(true)
  expect(looksLoggedOut("no saved credential; run `muse login`")).toBe(true)
  expect(looksLoggedOut("all good")).toBe(false)
})

test("claudeMcpConfig translates local + remote, drops disabled/unknown", () => {
  const out = claudeMcpConfig({
    mcp: {
      files: {
        type: "local",
        command: ["npx", "-y", "srv"],
        environment: { A: "1" },
      },
      web: { type: "remote", url: "https://x.test/mcp", headers: { H: "v" } },
      off: { type: "local", command: ["x"], enabled: false },
      weird: { type: "???", command: ["x"] },
    },
  })
  expect(JSON.parse(out ?? "{}")).toEqual({
    mcpServers: {
      files: { command: "npx", args: ["-y", "srv"], env: { A: "1" } },
      web: { type: "http", url: "https://x.test/mcp", headers: { H: "v" } },
    },
  })
  expect(claudeMcpConfig({ mcp: {} })).toBeNull()
  expect(claudeMcpConfig(null)).toBeNull()
})

test("openVikingMcpServer derives /mcp + Bearer from desktop env", () => {
  expect(
    openVikingMcpServer({
      OPENVIKING_URL: "http://viking:1933/",
      OPENVIKING_API_KEY: "ukey",
    }),
  ).toEqual({
    kind: "http",
    url: "http://viking:1933/mcp",
    headers: { Authorization: "Bearer ukey" },
  })
  const custom = openVikingMcpServer({
    OPENVIKING_MCP_URL: "http://v:9/custom",
    OPENVIKING_API_KEY: "k",
  })
  expect(custom?.kind).toBe("http")
  expect(custom?.kind === "http" ? custom.url : "").toBe("http://v:9/custom")
  expect(openVikingMcpServer({ OPENVIKING_URL: "http://v" })).toBeNull()
  expect(openVikingMcpServer({ OPENVIKING_API_KEY: "k" })).toBeNull()
})

test("bridgeMcpServers adds OpenViking and wins the proxy entry", () => {
  const servers = bridgeMcpServers(
    {
      mcp: {
        openviking: { type: "local", command: ["node", "proxy.mjs"] },
        files: { type: "local", command: ["npx", "srv"] },
      },
    },
    { OPENVIKING_URL: "http://viking:1933", OPENVIKING_API_KEY: "ukey" },
  )
  expect(servers.openviking).toEqual({
    kind: "http",
    url: "http://viking:1933/mcp",
    headers: { Authorization: "Bearer ukey" },
  })
  expect(servers.files?.kind).toBe("stdio")
  const claudeJson = JSON.parse(
    claudeMcpConfig(
      { mcp: {} },
      { OPENVIKING_URL: "http://viking:1933", OPENVIKING_API_KEY: "ukey" },
    ) ?? "{}",
  )
  expect(claudeJson.mcpServers.openviking).toEqual({
    type: "http",
    url: "http://viking:1933/mcp",
    headers: { Authorization: "Bearer ukey" },
  })
})

test("museMcpPlan emits -c pairs with secrets as env references", () => {
  const plan = museMcpPlan({
    openviking: {
      kind: "http",
      url: "http://viking:1933/mcp",
      headers: { Authorization: "Bearer ukey" },
    },
    files: {
      kind: "stdio",
      command: "npx",
      args: ["srv"],
      env: { TOKEN: "shh" },
    },
    "bad name!": { kind: "http", url: "http://x", headers: {} },
  })
  expect(plan.names).toEqual(["openviking", "files"])
  expect(plan.args).toHaveLength(4)
  expect(plan.args[0]).toBe("-c")
  expect(plan.args[1]).toContain("mcpServers.openviking=")
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal muse ${VAR} secret reference
  expect(plan.args[1]).toContain("${OPEN_BOT_MCP_S0}")
  expect(plan.args[1]).not.toContain("ukey")
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal muse ${VAR} secret reference
  expect(plan.args[3]).toContain("${OPEN_BOT_MCP_S1}")
  expect(plan.env).toEqual({
    OPEN_BOT_MCP_S0: "Bearer ukey",
    OPEN_BOT_MCP_S1: "shh",
  })
  const dropped = museMcpPlan(
    { openviking: { kind: "http", url: "http://v/mcp", headers: {} } },
    new Set(["openviking"]),
  )
  expect(dropped.names).toEqual([])
})

test("museFailedMcpServer extracts the fatal server name", () => {
  expect(
    museFailedMcpServer(
      "agent loop failed: Required MCP server `probe` failed during startup",
    ),
  ).toBe("probe")
  expect(museFailedMcpServer("unrelated failure")).toBeNull()
})

test("filterCliModels drops logged-out CLI models only", () => {
  const models = [
    { providerID: "openai", modelID: "gpt" },
    { providerID: "claude-code", modelID: "opus" },
    { providerID: "muse-code", modelID: "default" },
  ]
  const status = parseCliStatus({
    claudeCode: { installed: true, loggedIn: false },
    museCode: { installed: true, loggedIn: true },
  })
  expect(filterCliModels(models, status).map((m) => m.providerID)).toEqual([
    "openai",
    "muse-code",
  ])
  expect(filterCliModels(models, null)).toEqual(models)
})

test("parseCliStatus maps probe output, tolerates missing rows", () => {
  const parsed = parseCliStatus({
    claudeCode: { installed: true, loggedIn: true, account: "a@b.test" },
    museCode: { installed: true, loggedIn: false },
  })
  expect(parsed).toEqual([
    {
      id: "claude-code",
      label: "Claude Code",
      installed: true,
      loggedIn: true,
      account: "a@b.test",
    },
    {
      id: "muse-code",
      label: "Muse",
      installed: true,
      loggedIn: false,
      account: null,
    },
  ])
  expect(parseCliStatus("nope")).toBeNull()
  expect(parseCliStatus({})).toBeNull()
})
