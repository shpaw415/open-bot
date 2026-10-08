import type { VideoProvider } from "@open-bot/db"

export type VideoProviderField = {
  label: string
  placeholder: string
  required: boolean
}

export type VideoProviderSpec = {
  id: string
  label: string
  defaultModel: string
  account: VideoProviderField | null
  secret: VideoProviderField
}

export const videoProviders: VideoProviderSpec[] = [
  {
    id: "xai",
    label: "xAI (Grok Imagine)",
    defaultModel: "grok-imagine-video-1.5",
    account: null,
    secret: {
      label: "API key",
      placeholder: "xAI API key",
      required: true,
    },
  },
  {
    id: "xai-gateway",
    label: "xAI (Cloudflare Gateway)",
    defaultModel: "grok-imagine-video-1.5",
    account: {
      label: "Account ID",
      placeholder: "Cloudflare account ID",
      required: true,
    },
    secret: {
      label: "API token",
      placeholder: "Cloudflare API token",
      required: true,
    },
  },
  {
    id: "openai",
    label: "OpenAI (Sora 2)",
    defaultModel: "sora-2",
    account: null,
    secret: {
      label: "API key",
      placeholder: "OpenAI API key",
      required: true,
    },
  },
  {
    id: "google",
    label: "Google (Veo)",
    defaultModel: "veo-3.0-fast-generate-001",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Gemini API key",
      required: true,
    },
  },
  {
    id: "replicate",
    label: "Replicate",
    defaultModel: "google/veo-3-fast",
    account: null,
    secret: {
      label: "API token",
      placeholder: "Replicate API token",
      required: true,
    },
  },
  {
    id: "fal",
    label: "fal.ai",
    defaultModel: "fal-ai/veo3",
    account: null,
    secret: {
      label: "API key",
      placeholder: "fal API key",
      required: true,
    },
  },
]

export const videoModelCatalog: Record<string, string[]> = {
  xai: [
    "grok-imagine-video-1.5",
    "grok-imagine-video",
    "grok-imagine-video-1.5-lite",
  ],
  "xai-gateway": [
    "grok-imagine-video-1.5",
    "grok-imagine-video",
    "grok-imagine-video-1.5-lite",
  ],
  openai: ["sora-2", "sora-2-pro"],
  google: [
    "veo-3.0-generate-001",
    "veo-3.0-fast-generate-001",
    "veo-2.0-generate-001",
  ],
  replicate: [
    "google/veo-3-fast",
    "minimax/video-01",
    "wan-video/wan-2.2-t2v-fast",
  ],
  fal: ["fal-ai/veo3", "fal-ai/kling-video/v2/master/text-to-video"],
}

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
  return videoProviders.find((item) => item.id === id)
}

export function videoProviderPublic() {
  return videoProviders.map((item) => ({
    id: item.id,
    label: item.label,
    defaultModel: item.defaultModel,
    account: item.account,
    secret: {
      label: item.secret.label,
      placeholder: item.secret.placeholder,
    },
  }))
}

export function videoAuthReady(
  value: VideoProvider | null,
): value is VideoProvider {
  if (!value) return false
  const spec = videoProviderById(value.provider)
  if (!spec) return false
  if (spec.account?.required && value.accountId.trim() === "") return false
  return value.apiKey.trim() !== "" && value.model.trim() !== ""
}
