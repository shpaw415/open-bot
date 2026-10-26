// CLI subscription providers: Muse and Muse exposed to
// opencode as custom OpenAI-compatible providers through the in-desktop
// bridge (server.ts in this directory, copied into the image at
// /opt/open-bot/cli-bridge/). The CLIs are full agents, not model APIs:
// the bridge hands each opencode chat request to the CLI's headless mode
// and streams its text back as one assistant message. The CLI runs its
// own tool loop in the same workspace with the same PATH, so the ob-*
// CLIs stay reachable through its shell; opencode's own tools and the
// OpenViking plugin tools are not passed through.
//
// This module is the single registry shared by the control plane
// (login/logout, auth sync, /api/providers), the image entrypoint
// (opencode.json provider entries, re-derived every boot in jq from the
// same shapes below), and the bridge itself.

export const CLI_BRIDGE_PORT = 4760
export const CLI_BRIDGE_URL = `http://127.0.0.1:${CLI_BRIDGE_PORT}/v1`
// Dummy key written into opencode's auth.json while the CLI is logged in;
// opencode treats the entry as "connected" and passes it to the bridge,
// which ignores it (the CLI's own subscription login is the real auth).
export const CLI_BRIDGE_KEY = "open-bot-cli-bridge"

export type CliId = "claude-code" | "muse-code"

export type CliModel = {
  // Model id inside the opencode provider entry. Bare ids must stay
  // unique across both CLI providers: the bridge routes on this alone.
  id: string
  name: string
  // Value for the CLI's --model flag; null omits the flag (CLI default).
  cliModel: string | null
  context: number
  output: number
  // Thinking-effort variant ids, forwarded to the CLI's effort flag.
  variants: string[]
}

export type CliProvider = {
  id: CliId
  label: string
  description: string
  bin: string
  // Env var the bridge checks first for the binary path (tests, overrides).
  binEnv: string
  loginArgs: string[]
  logoutArgs: string[]
  models: CliModel[]
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const MUSE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

export const cliProviders: CliProvider[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    description:
      "Claude Code CLI with your Anthropic subscription login (claude auth login). Runs its own agent loop in the workspace.",
    bin: "claude",
    binEnv: "OPEN_BOT_CLAUDE_BIN",
    loginArgs: ["auth", "login"],
    logoutArgs: ["auth", "logout"],
    models: [
      {
        id: "opus",
        name: "Claude Code · Opus",
        cliModel: "opus",
        context: 200_000,
        output: 32_000,
        variants: CLAUDE_EFFORTS,
      },
      {
        id: "sonnet",
        name: "Claude Code · Sonnet",
        cliModel: "sonnet",
        context: 200_000,
        output: 32_000,
        variants: CLAUDE_EFFORTS,
      },
      {
        id: "haiku",
        name: "Claude Code · Haiku",
        cliModel: "haiku",
        context: 200_000,
        output: 32_000,
        variants: CLAUDE_EFFORTS,
      },
    ],
  },
  {
    id: "muse-code",
    label: "Muse",
    description:
      "Muse CLI with your Meta subscription login (muse login). Runs its own agent loop in the workspace.",
    bin: "muse",
    binEnv: "OPEN_BOT_MUSE_BIN",
    loginArgs: ["login"],
    logoutArgs: ["logout"],
    models: [
      {
        id: "default",
        name: "Muse · Default",
        cliModel: null,
        context: 200_000,
        output: 32_000,
        variants: MUSE_EFFORTS,
      },
    ],
  },
]

export function isCliProviderId(value: unknown): value is CliId {
  return value === "claude-code" || value === "muse-code"
}

export function cliProviderById(id: string): CliProvider | undefined {
  return cliProviders.find((item) => item.id === id)
}

export type CliRoute = { provider: CliProvider; model: CliModel }

// The bridge receives the bare model id from opencode's OpenAI-compatible
// call. Accept (and strip) a "<provider>/" prefix defensively.
export function routeCliModel(modelId: string): CliRoute | null {
  const bare = modelId.includes("/")
    ? (modelId.split("/").slice(1).join("/") ?? modelId)
    : modelId
  for (const provider of cliProviders) {
    const model = provider.models.find((item) => item.id === bare)
    if (model) return { provider, model }
  }
  return null
}

// The opencode.json `.provider` entries for both CLIs. No apiKey in
// options on purpose: connected state comes from the auth.json entry the
// control plane syncs from the CLI's real login state.
export function opencodeCliProviderConfig() {
  const out: Record<string, unknown> = {}
  for (const provider of cliProviders) {
    const models: Record<string, unknown> = {}
    for (const model of provider.models) {
      const variants: Record<string, unknown> = {}
      for (const variant of model.variants) {
        variants[variant] = { reasoningEffort: variant }
      }
      models[model.id] = {
        name: model.name,
        limit: { context: model.context, output: model.output },
        variants,
      }
    }
    out[provider.id] = {
      npm: "@ai-sdk/openai-compatible",
      name: `${provider.label} (subscription)`,
      options: { baseURL: CLI_BRIDGE_URL },
      models,
    }
  }
  return out
}

// Appended to the system prompt handed to the CLI: the desktop contract
// carries over (OpenViking arrives as the same MCP server opencode uses,
// skills are synced into the CLI's own skill roots, ob-* CLIs are on
// PATH); only opencode-native surfaces stay behind.
export const CLI_ADAPTER_NOTE = [
  "Bridge note: you are answering as the open-bot desktop agent through a CLI bridge.",
  "OpenViking is connected as an MCP server, so the openviking_* tools and the desktop skills work as documented; the ob-* CLIs are on PATH for your shell tool.",
  "opencode-native tools (task subagents) are unavailable — use your own equivalents. Work in the current directory.",
  "The conversation transcript below is the full thread history; reply to the last user message with one final message.",
].join(" ")

export type FlatImage = { mediaType: string; dataBase64: string }
export type FlattenedRequest = {
  system: string
  prompt: string
  images: FlatImage[]
}

type ChatPart = Record<string, unknown>
type ChatMessageLike = {
  role?: string
  content?: unknown
  name?: string
  tool_calls?: unknown
}

function partText(part: ChatPart, images: FlatImage[]): string {
  if (part.type === "text" && typeof part.text === "string") return part.text
  if (part.type === "image_url") {
    const url = (part.image_url as { url?: unknown } | undefined)?.url
    if (typeof url === "string") {
      const match = /^data:([^;,]+)[^,]*,(.+)$/s.exec(url)
      if (match) {
        images.push({
          mediaType: match[1] ?? "image/png",
          dataBase64: match[2] ?? "",
        })
        return "[image attached]"
      }
      return `[image: ${url.slice(0, 120)}]`
    }
  }
  if (part.type === "image") return "[image attached]"
  if (typeof part.text === "string") return part.text
  return ""
}

function messageText(message: ChatMessageLike, images: FlatImage[]): string {
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        part && typeof part === "object"
          ? partText(part as ChatPart, images)
          : "",
      )
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

const TOOL_RESULT_CAP = 4000

// Flatten an OpenAI-style messages array into one CLI prompt. The CLI is
// stateless per call, so history rides along as a transcript; opencode
// re-sends the full history on every request, which keeps turns aligned
// without CLI session state.
export function flattenMessages(messages: unknown): FlattenedRequest {
  const list: ChatMessageLike[] = Array.isArray(messages)
    ? (messages as ChatMessageLike[])
    : []
  const images: FlatImage[] = []
  const systemParts: string[] = []
  const turns: { role: string; text: string }[] = []
  for (const message of list) {
    const role = typeof message.role === "string" ? message.role : "user"
    let text = messageText(message, images)
    if (role === "tool") {
      text = `[tool result${message.name ? ` from ${message.name}` : ""}] ${text.slice(0, TOOL_RESULT_CAP)}`
    }
    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      const names = message.tool_calls
        .map((call) => {
          const fn = (call as { function?: { name?: unknown } })?.function
          return typeof fn?.name === "string" ? fn.name : ""
        })
        .filter(Boolean)
      if (names.length)
        text = `${text}\n[assistant called tools: ${names.join(", ")}]`.trim()
    }
    if (!text.trim()) continue
    if (role === "system") systemParts.push(text)
    else turns.push({ role, text })
  }
  const system = [...systemParts, CLI_ADAPTER_NOTE].join("\n\n")
  if (turns.length <= 1) {
    return { system, prompt: turns[0]?.text ?? "", images }
  }
  const label = (role: string) =>
    role === "assistant" ? "Assistant" : role === "tool" ? "Tool" : "User"
  const transcript = turns
    .map((turn) => `${label(turn.role)}: ${turn.text}`)
    .join("\n\n")
  return {
    system,
    prompt: `Conversation so far:\n\n${transcript}\n\nReply to the last user message above. Continue as the assistant; send one final message only.`,
    images,
  }
}

export type CliEvent = {
  delta?: string
  // Full assistant text from a non-streamed message event (fallback when
  // the CLI emits no partial deltas).
  assistantText?: string
  result?: {
    text: string
    isError: boolean
    usage?: { promptTokens: number; completionTokens: number }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

// One line of `claude -p --output-format stream-json --include-partial-messages`.
export function parseClaudeLine(line: string): CliEvent | null {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (event.type === "stream_event") {
    const inner = asRecord(event.event)
    const delta = asRecord(inner?.delta)
    if (inner?.type === "content_block_delta" && delta?.type === "text_delta") {
      return typeof delta.text === "string" ? { delta: delta.text } : null
    }
    return null
  }
  if (event.type === "assistant") {
    const message = asRecord(event.message)
    const content = Array.isArray(message?.content) ? message.content : []
    const text = content
      .map((block) => {
        const row = asRecord(block)
        return row?.type === "text" && typeof row.text === "string"
          ? row.text
          : ""
      })
      .filter(Boolean)
      .join("")
    return text ? { assistantText: text } : null
  }
  if (event.type === "result") {
    const usage = asRecord(event.usage)
    const promptTokens =
      num(usage?.input_tokens) +
      num(usage?.cache_read_input_tokens) +
      num(usage?.cache_creation_input_tokens)
    return {
      result: {
        text: typeof event.result === "string" ? event.result : "",
        isError:
          event.is_error === true ||
          (typeof event.subtype === "string" && event.subtype !== "success"),
        usage: usage
          ? { promptTokens, completionTokens: num(usage.output_tokens) }
          : undefined,
      },
    }
  }
  return null
}

// One line of `muse exec --json` (MSP JSONL). Text arrives as
// run.output.delta payloads; non-JSON banner lines are skipped.
export function parseMuseLine(line: string): CliEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  let event: Record<string, unknown>
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (event.payload_type !== "run.output.delta") return null
  const payload = asRecord(event.payload)
  return typeof payload?.text === "string" && payload.text
    ? { delta: payload.text }
    : null
}

export function looksLoggedOut(text: string): boolean {
  return /not logged in|please run \/login|run `?muse login|no (saved )?credential|authentication required/i.test(
    text,
  )
}

export function completionChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

export function usageChunk(
  id: string,
  model: string,
  usage: { promptTokens: number; completionTokens: number },
) {
  return {
    ...completionChunk(id, model, {}, null),
    choices: [],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.promptTokens + usage.completionTokens,
    },
  }
}

export function completionBody(
  id: string,
  model: string,
  text: string,
  usage?: { promptTokens: number; completionTokens: number },
) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
      total_tokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
    },
  }
}

export type McpServerShape =
  | {
      kind: "stdio"
      command: string
      args: string[]
      env: Record<string, string>
    }
  | { kind: "http"; url: string; headers: Record<string, string> }

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

// opencode's mcp map in a neutral shape both CLIs can consume. Unknown
// shapes are dropped, never guessed.
export function mcpServersFromOpencode(
  opencodeConfig: unknown,
): Record<string, McpServerShape> {
  const mcp = asRecord(asRecord(opencodeConfig)?.mcp)
  if (!mcp) return {}
  const servers: Record<string, McpServerShape> = {}
  for (const [name, raw] of Object.entries(mcp)) {
    const entry = asRecord(raw)
    if (!entry || entry.enabled === false) continue
    if (entry.type === "local" && Array.isArray(entry.command)) {
      const command = entry.command.filter(
        (item): item is string => typeof item === "string",
      )
      if (!command.length) continue
      servers[name] = {
        kind: "stdio",
        command: command[0] ?? "",
        args: command.slice(1),
        env: stringMap(entry.environment),
      }
    } else if (entry.type === "remote" && typeof entry.url === "string") {
      servers[name] = {
        kind: "http",
        url: entry.url,
        headers: stringMap(entry.headers),
      }
    }
  }
  return servers
}

// The desktop's OpenViking as a direct streamable-HTTP MCP entry — the
// same server opencode reaches through the plugin's stdio proxy.
// OPENVIKING_API_KEY in the desktop is already the scoped user key,
// whose Bearer form the /mcp endpoint takes.
export function openVikingMcpServer(
  env: Record<string, string | undefined>,
): McpServerShape | null {
  const key = env.OPENVIKING_API_KEY?.trim()
  const explicit = env.OPENVIKING_MCP_URL?.trim()
  const base = env.OPENVIKING_URL?.trim().replace(/\/+$/, "")
  const url = explicit || (base ? `${base}/mcp` : "")
  if (!url || !key) return null
  return {
    kind: "http",
    url,
    headers: { Authorization: `Bearer ${key}` },
  }
}

// User/plugin MCP servers from opencode.json plus OpenViking, which wins
// its own name: the on-disk entry (when present) is opencode's stdio
// proxy, and both CLIs do better talking to the server directly.
export function bridgeMcpServers(
  opencodeConfig: unknown,
  env: Record<string, string | undefined>,
): Record<string, McpServerShape> {
  const servers = mcpServersFromOpencode(opencodeConfig)
  const viking = openVikingMcpServer(env)
  if (viking) servers.openviking = viking
  return servers
}

function claudeServerEntry(server: McpServerShape): Record<string, unknown> {
  if (server.kind === "stdio") {
    return {
      command: server.command,
      args: server.args,
      ...(Object.keys(server.env).length ? { env: server.env } : {}),
    }
  }
  return {
    type: "http",
    url: server.url,
    ...(Object.keys(server.headers).length ? { headers: server.headers } : {}),
  }
}

// Claude Code's --mcp-config payload for the bridge server set.
export function claudeMcpConfig(
  opencodeConfig: unknown,
  env: Record<string, string | undefined> = {},
): string | null {
  const servers = bridgeMcpServers(opencodeConfig, env)
  if (Object.keys(servers).length === 0) return null
  const mcpServers: Record<string, unknown> = {}
  for (const [name, server] of Object.entries(servers)) {
    mcpServers[name] = claudeServerEntry(server)
  }
  return JSON.stringify({ mcpServers })
}

export type MuseMcpPlan = {
  // `-c mcpServers.<name>=<json>` pairs for one exec run.
  args: string[]
  // Secret values referenced as ${VAR} leaves inside those JSON values;
  // the spawn env must carry them or muse refuses the run.
  env: Record<string, string>
  names: string[]
}

const MUSE_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/

// Muse reads MCP servers from settings.json `mcpServers`; the bridge
// passes them per run with `-c mcpServers.<name>=…` so the user's own
// settings stay untouched. Muse refuses literal secrets in -c values:
// header and env values travel as whole-value ${VAR} references backed
// by the returned env. Names muse cannot address are skipped.
export function museMcpPlan(
  servers: Record<string, McpServerShape>,
  exclude: ReadonlySet<string> = new Set(),
): MuseMcpPlan {
  const args: string[] = []
  const env: Record<string, string> = {}
  const names: string[] = []
  let secretIndex = 0
  const secret = (value: string) => {
    const name = `OPEN_BOT_MCP_S${secretIndex++}`
    env[name] = value
    return `\${${name}}`
  }
  for (const [name, server] of Object.entries(servers)) {
    if (!MUSE_SERVER_NAME.test(name) || exclude.has(name)) continue
    const entry: Record<string, unknown> =
      server.kind === "stdio"
        ? {
            command: server.command,
            args: server.args,
            ...(Object.keys(server.env).length
              ? {
                  env: Object.fromEntries(
                    Object.entries(server.env).map(([key, value]) => [
                      key,
                      secret(value),
                    ]),
                  ),
                }
              : {}),
          }
        : {
            url: server.url,
            ...(Object.keys(server.headers).length
              ? {
                  headers: Object.fromEntries(
                    Object.entries(server.headers).map(([key, value]) => [
                      key,
                      secret(value),
                    ]),
                  ),
                }
              : {}),
          }
    args.push("-c", `mcpServers.${name}=${JSON.stringify(entry)}`)
    names.push(name)
  }
  return { args, env, names }
}

// Extra skill roots opencode loads beside ~/.config/opencode/skills
// (the OpenViking plugin registers its bundled skills here). The bridge
// mirrors them into each CLI's own skill root before a run.
export function opencodeSkillPaths(opencodeConfig: unknown): string[] {
  const paths = asRecord(asRecord(opencodeConfig)?.skills)?.paths
  if (!Array.isArray(paths)) return []
  return paths.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
}

// Muse treats a settings MCP server that fails startup as a fatal run
// error naming the server; the bridge drops the named server and
// retries so one dead server cannot take every muse turn down with it.
export function museFailedMcpServer(text: string): string | null {
  const match = /Required MCP server `([^`]+)` failed/.exec(text)
  return match?.[1] ?? null
}

// Merge the CLI provider entries into an opencode.json document. The
// entrypoint re-applies this every boot (apply-config.ts) so registry
// changes land without a config migration; user entries under other
// provider ids are preserved, ours win their own ids.
export function mergeCliProviderConfig(config: unknown) {
  const root = asRecord(config) ?? {}
  const existing = asRecord(root.provider) ?? {}
  return {
    ...root,
    provider: { ...existing, ...opencodeCliProviderConfig() },
  }
}

export type CliStatus = {
  id: CliId
  label: string
  installed: boolean
  loggedIn: boolean
  account: string | null
}

// opencode reports keyless custom providers as connected even when the
// CLI behind them is logged out, so /api/models filters CLI models by
// the probed login state. A null status (probe unavailable) keeps the
// models: the bridge's own login error is clearer than a vanished entry.
export function filterCliModels<T extends { providerID: string }>(
  models: T[],
  status: CliStatus[] | null,
): T[] {
  if (!status) return models
  const loggedIn = new Set(
    status.filter((row) => row.loggedIn).map((row) => row.id),
  )
  return models.filter(
    (model) =>
      !isCliProviderId(model.providerID) || loggedIn.has(model.providerID),
  )
}

// Parse cli-status.sh output into the /api/providers shape.
export function parseCliStatus(raw: unknown): CliStatus[] | null {
  const root = asRecord(raw)
  if (!root) return null
  const read = (key: string) => asRecord(root[key])
  const rows: Record<CliId, Record<string, unknown> | null> = {
    "claude-code": read("claudeCode"),
    "muse-code": read("museCode"),
  }
  if (!rows["claude-code"] && !rows["muse-code"]) return null
  return cliProviders.map((provider) => {
    const row = rows[provider.id]
    return {
      id: provider.id,
      label: provider.label,
      installed: row?.installed === true,
      loggedIn: row?.loggedIn === true,
      account:
        typeof row?.account === "string" && row.account ? row.account : null,
    }
  })
}
