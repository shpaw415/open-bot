import type { VikingEmbedProvider, VikingProvider } from "@open-bot/db"

// Catalog of embedding providers the Config page offers, mirroring what
// OpenViking's embedding.dense layer actually supports (openai-compatible,
// plus the native voyage/cohere/jina/gemini/dashscope/minimax/volcengine/
// litellm/local embedders). Each entry says which inputs the form shows,
// the OpenViking runtime name, and the endpoint default applied when no
// base URL override is stored — the same defaults OpenViking's embedders
// carry, repeated here so the form can display what will be used.

export type EmbedFieldMode = "required" | "optional" | "hidden"

export type VikingEmbedCatalogEntry = {
  id: VikingEmbedProvider
  label: string
  // OpenViking embedding.dense.provider runtime name.
  runtime: string
  // Endpoint used when no base URL override is stored ("" = none).
  defaultBase: string
  baseMode: EmbedFieldMode
  keyMode: EmbedFieldMode
  // Only Cloudflare asks for an account id (the endpoint is derived).
  accountMode: EmbedFieldMode
  exampleModels: string[]
  defaultDimension: number
  note?: string
}

const CLOUDFLARE_BASE = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`

export function cloudflareEmbedBase(accountId: string): string {
  const id = accountId.trim()
  return id ? CLOUDFLARE_BASE(id) : ""
}

export const VIKING_EMBED_CATALOG: readonly VikingEmbedCatalogEntry[] = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
    runtime: "openai",
    defaultBase: "",
    baseMode: "hidden",
    keyMode: "required",
    accountMode: "required",
    exampleModels: [
      "@cf/qwen/qwen3-embedding-0.6b",
      "@cf/baai/bge-m3",
      "@cf/openai/text-embedding-3-small",
    ],
    defaultDimension: 1024,
    note: "OpenAI-compatible endpoint derived from your Cloudflare account id.",
  },
  {
    id: "openai",
    label: "OpenAI",
    runtime: "openai",
    defaultBase: "https://api.openai.com/v1",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["text-embedding-3-small", "text-embedding-3-large"],
    defaultDimension: 1536,
  },
  {
    id: "voyage",
    label: "Voyage AI",
    runtime: "voyage",
    defaultBase: "https://api.voyageai.com/v1",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["voyage-4-lite", "voyage-3-large"],
    defaultDimension: 1024,
  },
  {
    id: "cohere",
    label: "Cohere",
    runtime: "cohere",
    defaultBase: "https://api.cohere.com",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["embed-english-v3.0", "embed-multilingual-v3.0"],
    defaultDimension: 1024,
  },
  {
    id: "jina",
    label: "Jina AI",
    runtime: "jina",
    defaultBase: "https://api.jina.ai/v1",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["jina-embeddings-v4", "jina-clip-v2"],
    defaultDimension: 1024,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    runtime: "gemini",
    defaultBase: "",
    baseMode: "hidden",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["gemini-embedding-001", "text-embedding-004"],
    defaultDimension: 3072,
    note: "Native Gemini API — endpoint fixed, only the key is needed.",
  },
  {
    id: "dashscope",
    label: "Alibaba DashScope",
    runtime: "dashscope",
    defaultBase: "https://dashscope.aliyuncs.com",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["text-embedding-v4", "text-embedding-v3"],
    defaultDimension: 1024,
  },
  {
    id: "minimax",
    label: "MiniMax",
    runtime: "minimax",
    defaultBase: "https://api.minimax.chat/v1/embeddings",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["embo-01"],
    defaultDimension: 1536,
  },
  {
    id: "volcengine",
    label: "Volcengine Ark",
    runtime: "volcengine",
    defaultBase: "https://ark.cn-beijing.volces.com/api/v3",
    baseMode: "optional",
    keyMode: "required",
    accountMode: "hidden",
    exampleModels: ["doubao-embedding-text-240715"],
    defaultDimension: 2048,
  },
  {
    id: "ollama",
    label: "Ollama (local server)",
    runtime: "ollama",
    defaultBase: "",
    baseMode: "required",
    keyMode: "optional",
    accountMode: "hidden",
    exampleModels: ["nomic-embed-text", "qwen3-embedding:4b"],
    defaultDimension: 768,
    note: "Point at the Ollama server the Viking container can reach (no key unless the server asks for one).",
  },
  {
    id: "litellm",
    label: "LiteLLM proxy",
    runtime: "litellm",
    defaultBase: "",
    baseMode: "required",
    keyMode: "optional",
    accountMode: "hidden",
    exampleModels: ["openai/text-embedding-3-small"],
    defaultDimension: 1536,
    note: "Any embedding the proxy routes; the dimension must match the routed model.",
  },
  {
    id: "local",
    label: "Local model (in-container)",
    runtime: "local",
    defaultBase: "",
    baseMode: "hidden",
    keyMode: "hidden",
    accountMode: "hidden",
    exampleModels: ["bge-small-zh-v1.5-f16"],
    defaultDimension: 512,
    note: "The bge-small model shipped inside the Viking image — nothing to configure.",
  },
  {
    id: "custom-openai-compatible",
    label: "Custom OpenAI-compatible",
    runtime: "openai",
    defaultBase: "",
    baseMode: "required",
    keyMode: "optional",
    accountMode: "hidden",
    exampleModels: ["your-embed-model"],
    defaultDimension: 1536,
    note: "Any endpoint that speaks the OpenAI /embeddings shape.",
  },
]

// Embedding providers whose endpoint can also serve the custom-source VLM
// (mirrors VIKING_CUSTOM_VLM_PROVIDERS in @open-bot/db).
const CUSTOM_VLM_EMBEDDERS: readonly VikingEmbedProvider[] = [
  "cloudflare-workers-ai",
  "openai",
  "ollama",
  "litellm",
  "custom-openai-compatible",
]

export function embedCatalogById(
  id: string,
): VikingEmbedCatalogEntry | undefined {
  return VIKING_EMBED_CATALOG.find((entry) => entry.id === id)
}

export function isVikingEmbedProviderId(
  value: string,
): value is VikingEmbedProvider {
  return embedCatalogById(value) !== undefined
}

export function vikingEmbedLabel(id: string): string {
  return embedCatalogById(id)?.label ?? id
}

export function embedSupportsCustomVlm(id: string): boolean {
  return CUSTOM_VLM_EMBEDDERS.includes(id as VikingEmbedProvider)
}

// What the Config form needs per provider (no runtime internals).
export type VikingEmbedPublicEntry = {
  id: string
  label: string
  defaultBase: string
  baseMode: EmbedFieldMode
  keyMode: EmbedFieldMode
  accountMode: EmbedFieldMode
  exampleModels: string[]
  defaultDimension: number
  note?: string
}

export function vikingEmbedCatalogPublic(): VikingEmbedPublicEntry[] {
  return VIKING_EMBED_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    defaultBase: entry.defaultBase,
    baseMode: entry.baseMode,
    keyMode: entry.keyMode,
    accountMode: entry.accountMode,
    exampleModels: entry.exampleModels,
    defaultDimension: entry.defaultDimension,
    ...(entry.note ? { note: entry.note } : {}),
  }))
}

export type ResolvedVikingEmbedding = {
  provider: string
  model: string
  apiKey: string
  apiBase: string
  dimension: number
}

// Derive the embedding.dense block for OpenViking's config from the saved
// provider form: native embedders map to their runtime name with the
// catalog's endpoint default when no override is stored, Cloudflare
// derives its OpenAI-compatible base from the account id, and everything
// OpenAI-shaped routes through provider "openai".
export function resolveVikingEmbedding(
  viking: VikingProvider,
): ResolvedVikingEmbedding {
  const entry = embedCatalogById(viking.embedProvider)
  const model = viking.embedModel.trim()
  const apiKey = viking.apiKey.trim()
  const override = viking.baseURL.trim()
  const dimension = viking.embedDimension
  if (!entry) {
    return {
      provider: "openai",
      model,
      apiKey,
      apiBase: override,
      dimension,
    }
  }
  if (entry.id === "cloudflare-workers-ai") {
    return {
      provider: "openai",
      model,
      apiKey,
      apiBase: override || cloudflareEmbedBase(viking.embedAccountId),
      dimension,
    }
  }
  if (entry.id === "local") {
    // The in-container model needs no endpoint and no credential; stored
    // overrides from a previously selected provider are ignored.
    return {
      provider: "local",
      model,
      apiKey: "",
      apiBase: "",
      dimension,
    }
  }
  return {
    provider: entry.runtime,
    model,
    apiKey,
    apiBase: override || entry.defaultBase,
    dimension,
  }
}
