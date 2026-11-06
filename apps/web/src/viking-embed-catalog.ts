// Web mirror of the control plane's Viking embedding catalog
// (apps/control/src/viking-embedding-catalog.ts). Kept in sync with the
// served `embedProviders` on GET /api/viking, which the control plane
// validates against — this mirror only drives the form's rendering.

export type EmbedFieldMode = "required" | "optional" | "hidden"

export type VikingEmbedId =
  | "cloudflare-workers-ai"
  | "openai"
  | "voyage"
  | "cohere"
  | "jina"
  | "gemini"
  | "dashscope"
  | "minimax"
  | "volcengine"
  | "ollama"
  | "litellm"
  | "local"
  | "custom-openai-compatible"

export type VikingEmbedSpec = {
  id: VikingEmbedId
  label: string
  defaultBase: string
  baseMode: EmbedFieldMode
  keyMode: EmbedFieldMode
  accountMode: EmbedFieldMode
  exampleModels: string[]
  defaultDimension: number
  note?: string
}

// Embedding providers whose endpoint can also serve the custom-source VLM.
const CUSTOM_VLM_EMBEDDERS: VikingEmbedId[] = [
  "cloudflare-workers-ai",
  "openai",
  "ollama",
  "litellm",
  "custom-openai-compatible",
]

export const VIKING_EMBED_SPECS: VikingEmbedSpec[] = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
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
    defaultBase: "",
    baseMode: "required",
    keyMode: "optional",
    accountMode: "hidden",
    exampleModels: ["your-embed-model"],
    defaultDimension: 1536,
    note: "Any endpoint that speaks the OpenAI /embeddings shape.",
  },
]

export function vikingEmbedSpec(
  id: string | undefined,
): VikingEmbedSpec | undefined {
  return VIKING_EMBED_SPECS.find((spec) => spec.id === id)
}

export function embedSupportsCustomVlm(id: string | undefined): boolean {
  return id !== undefined && CUSTOM_VLM_EMBEDDERS.includes(id as VikingEmbedId)
}
