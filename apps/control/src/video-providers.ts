import type { VideoProvider } from "@open-bot/db"
import {
  accountIdField,
  apiKeyField,
  type CatalogSpec,
  catalogById,
  catalogPublic,
  modelOptions,
  parseFlatConfig,
} from "./provider-catalog"

export type VideoProviderId =
  | "xai"
  | "xai-gateway"
  | "openai"
  | "google"
  | "replicate"
  | "fal"

export type VideoProviderSpec = CatalogSpec<VideoProviderId>

const GROK_VIDEO_MODELS = modelOptions([
  "grok-imagine-video-1.5",
  "grok-imagine-video",
  "grok-imagine-video-1.5-lite",
])

export const videoProviders: readonly VideoProviderSpec[] = [
  {
    id: "xai",
    label: "xAI (Grok Imagine)",
    vaultSlug: "xai",
    fields: [apiKeyField("API key", "xAI API key")],
    models: GROK_VIDEO_MODELS,
    defaultModel: "grok-imagine-video-1.5",
    allowCustomModel: true,
  },
  {
    id: "xai-gateway",
    label: "xAI (Cloudflare Gateway)",
    vaultSlug: "cloudflare",
    fields: [
      accountIdField(),
      apiKeyField("API token", "Cloudflare API token"),
    ],
    models: GROK_VIDEO_MODELS,
    defaultModel: "grok-imagine-video-1.5",
    allowCustomModel: true,
  },
  {
    id: "openai",
    label: "OpenAI (Sora 2)",
    vaultSlug: "openai",
    fields: [apiKeyField("API key", "OpenAI API key")],
    models: modelOptions(["sora-2", "sora-2-pro"]),
    defaultModel: "sora-2",
    allowCustomModel: true,
  },
  {
    id: "google",
    label: "Google (Veo)",
    vaultSlug: "google",
    fields: [apiKeyField("API key", "Gemini API key")],
    models: modelOptions([
      "veo-3.0-fast-generate-001",
      "veo-3.0-generate-001",
      "veo-2.0-generate-001",
    ]),
    defaultModel: "veo-3.0-fast-generate-001",
    allowCustomModel: true,
  },
  {
    id: "replicate",
    label: "Replicate",
    vaultSlug: "replicate",
    fields: [apiKeyField("API token", "Replicate API token")],
    models: modelOptions([
      "google/veo-3-fast",
      "minimax/video-01",
      "wan-video/wan-2.2-t2v-fast",
    ]),
    defaultModel: "google/veo-3-fast",
    allowCustomModel: true,
  },
  {
    id: "fal",
    label: "fal.ai",
    vaultSlug: "fal",
    fields: [apiKeyField("API key", "fal API key")],
    models: modelOptions([
      "fal-ai/veo3",
      "fal-ai/kling-video/v2/master/text-to-video",
    ]),
    defaultModel: "fal-ai/veo3",
    allowCustomModel: true,
  },
]

// Derived from the catalog so the model lists live in exactly one place.
export const videoModelCatalog: Record<string, string[]> = Object.fromEntries(
  videoProviders.map((spec) => [spec.id, spec.models.map((model) => model.id)]),
)

const IMAGE_MODEL_PATTERN =
  /(grok-imagine-image|dall-e|gpt-image|imagen|flux|stable-?diffusion|sdxl|sd3)/i

const PROVIDER_VIDEO_PATTERN: Record<string, RegExp> = {
  xai: /^grok-imagine-video/i,
  "xai-gateway": /^grok-imagine-video/i,
  openai: /^sora/i,
  google: /veo/i,
  replicate:
    /(veo|kling|wan[/~-]|minimax\/video|luma|ltx|hunyuan|pika|video-)/i,
  fal: /(veo|kling|wan[/~-]|minimax|luma|ltx|hunyuan|pika|video)/i,
}

export function videoModelLooksLikeImage(model: string): boolean {
  return IMAGE_MODEL_PATTERN.test(model)
}

export function videoModelMatchesProvider(
  provider: string,
  model: string,
): boolean {
  const pattern = PROVIDER_VIDEO_PATTERN[provider]
  return pattern ? pattern.test(model) : true
}

export function videoProviderById(id: string) {
  return catalogById(videoProviders, id)
}

export function videoProviderPublic() {
  return catalogPublic(videoProviders)
}

export type VideoConfig =
  | {
      provider: "xai-gateway"
      apiKey: string
      accountId: string
      model: string
    }
  | {
      provider: "xai" | "openai" | "google" | "replicate" | "fal"
      apiKey: string
      model: string
    }

export function parseVideoConfig(
  value: VideoProvider | null,
): VideoConfig | null {
  const parsed = parseFlatConfig(videoProviders, value)
  if (!parsed) return null
  const { spec, apiKey, accountId, model } = parsed
  if (spec.id === "xai-gateway") {
    return { provider: spec.id, apiKey, accountId, model }
  }
  return { provider: spec.id, apiKey, model }
}

export function videoAuthReady(
  value: VideoProvider | null,
): value is VideoProvider {
  return parseVideoConfig(value) !== null
}
