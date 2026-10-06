export class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "AiError"
  }
}

export type AiModel = {
  id: string
  name: string
  context: number
  output: number
}

export type EmbeddingModel = {
  id: string
  name: string
  dimension: number
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: unknown
  name?: string
  tool_calls?: unknown
  tool_call_id?: string
}

export type ChatRequest = {
  model: AiModel
  messages: ChatMessage[]
  stream: boolean
  tools?: unknown
  toolChoice?: unknown
  reasoningEffort?: string
}

export type ChatResponse =
  | { stream: ReadableStream<Uint8Array> }
  | { json: unknown }

export type EmbedRequest = {
  model: EmbeddingModel
  input: string | string[]
}

export type EmbedResponse = {
  vectors: number[][]
  usage?: { promptTokens: number }
}

export type AiApi = {
  chat(req: ChatRequest): Promise<ChatResponse>
  embed(req: EmbedRequest): Promise<EmbedResponse>
  vlm?(req: ChatRequest): Promise<ChatResponse>
}

export type AiConfig = {
  models: {
    chat: AiModel
    small: AiModel
    embed: EmbeddingModel
    vlm: AiModel
  }
  api: AiApi
}

export type OpenAICompatibleApi = {
  type: "openai-compatible"
  baseURL: string
  apiKey: string
  headers?: Record<string, string>
  chatPath?: string
  embedPath?: string
}

export type AiConfigInput = {
  models: AiConfig["models"]
  api: AiApi | OpenAICompatibleApi
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiError(500, `${label} is required`)
  }
  return value.trim()
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AiError(500, `${label} must be a positive number`)
  }
  return value
}

function model(value: unknown, label: string): AiModel {
  if (!value || typeof value !== "object")
    throw new AiError(500, `${label} is required`)
  const row = value as Record<string, unknown>
  return {
    id: requiredString(row.id, `${label}.id`),
    name: requiredString(row.name, `${label}.name`),
    context: requiredNumber(row.context, `${label}.context`),
    output: requiredNumber(row.output, `${label}.output`),
  }
}

function embedModel(value: unknown): EmbeddingModel {
  if (!value || typeof value !== "object")
    throw new AiError(500, "models.embed is required")
  const row = value as Record<string, unknown>
  return {
    id: requiredString(row.id, "models.embed.id"),
    name: requiredString(row.name, "models.embed.name"),
    dimension: requiredNumber(row.dimension, "models.embed.dimension"),
  }
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

function dropEmpty(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  )
}

function openaiCompatible(api: OpenAICompatibleApi): AiApi {
  const baseURL = requiredString(api.baseURL, "api.baseURL")
  const apiKey = requiredString(api.apiKey, "api.apiKey")
  const headers = api.headers ?? {}
  const chatPath = api.chatPath ?? "/chat/completions"
  const embedPath = api.embedPath ?? "/embeddings"

  async function post(path: string, body: unknown, timeoutMs: number) {
    const response = await fetch(joinUrl(baseURL, path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new AiError(response.status, await response.text())
    }
    return response
  }

  const chat = async (req: ChatRequest): Promise<ChatResponse> => {
    const payload = dropEmpty({
      model: req.model.id,
      messages: req.messages,
      stream: req.stream,
      tools: req.tools,
      tool_choice: req.toolChoice,
      reasoning_effort: req.reasoningEffort,
    })
    const send = (body: Record<string, unknown>) =>
      post(chatPath, body, req.stream ? 600_000 : 120_000)
    let response: Response
    try {
      response = await send(
        req.stream
          ? { ...payload, stream_options: { include_usage: true } }
          : payload,
      )
    } catch (error) {
      if (!(req.stream && error instanceof AiError && error.status === 400)) {
        throw error
      }
      response = await send(payload)
    }
    if (req.stream) {
      if (!response.body) throw new AiError(502, "empty upstream stream")
      return { stream: response.body }
    }
    return { json: await response.json() }
  }

  return {
    chat,
    async embed(req) {
      const response = await post(
        embedPath,
        { model: req.model.id, input: req.input },
        60_000,
      )
      const json = (await response.json()) as {
        data?: { index?: number; embedding?: number[] }[]
        usage?: { prompt_tokens?: number }
      }
      const rows = [...(json.data ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      )
      return {
        vectors: rows.map((row) => row.embedding ?? []),
        usage:
          json.usage?.prompt_tokens === undefined
            ? undefined
            : { promptTokens: json.usage.prompt_tokens },
      }
    },
  }
}

function isOpenAICompatible(
  api: AiConfigInput["api"],
): api is OpenAICompatibleApi {
  return "type" in api && api.type === "openai-compatible"
}

export function defineAi(input: AiConfigInput): AiConfig {
  if (!input?.models) throw new AiError(500, "models is required")
  const models = {
    chat: model(input.models.chat, "models.chat"),
    small: model(input.models.small, "models.small"),
    embed: embedModel(input.models.embed),
    vlm: model(input.models.vlm, "models.vlm"),
  }
  if (!input.api) throw new AiError(500, "api is required")
  if (isOpenAICompatible(input.api)) {
    return { models, api: openaiCompatible(input.api) }
  }
  if (
    typeof input.api.chat !== "function" ||
    typeof input.api.embed !== "function"
  ) {
    throw new AiError(
      500,
      "api.chat and api.embed must be functions, or api.type must be openai-compatible",
    )
  }
  return { models, api: input.api }
}

export type PublicModel = "chat" | "small" | "embed" | "vlm"

export function resolvePublicModel(
  id: string | undefined,
  ai: AiConfig,
): PublicModel {
  if (id === "small" || id === ai.models.small.id) return "small"
  if (id === "embed" || id === ai.models.embed.id) return "embed"
  if (id === "vlm" || id === ai.models.vlm.id) return "vlm"
  return "chat"
}
