import type { ImageProvider } from "@open-bot/db"

export type ImageProviderField = {
  label: string
  placeholder: string
  required: boolean
}

export type ImageProviderSpec = {
  id: string
  label: string
  defaultModel: string
  account: ImageProviderField | null
  secret: ImageProviderField
}

export const imageProviders: ImageProviderSpec[] = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
    defaultModel: "@cf/black-forest-labs/flux-2-klein-9b",
    account: {
      label: "Account ID",
      placeholder: "Cloudflare account ID",
      required: true,
    },
    secret: {
      label: "API token",
      placeholder: "Workers AI token",
      required: true,
    },
  },
  {
    id: "xai",
    label: "xAI (Grok image)",
    defaultModel: "grok-imagine-image",
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
    defaultModel: "grok-imagine-image",
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
    label: "OpenAI",
    defaultModel: "gpt-image-1",
    account: null,
    secret: {
      label: "API key",
      placeholder: "OpenAI API key",
      required: true,
    },
  },
  {
    id: "google",
    label: "Google Gemini (Imagen)",
    defaultModel: "imagen-4.0-generate-001",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Gemini API key",
      required: true,
    },
  },
  {
    id: "stability",
    label: "Stability AI",
    defaultModel: "core",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Stability API key",
      required: true,
    },
  },
  {
    id: "replicate",
    label: "Replicate",
    defaultModel: "black-forest-labs/flux-schnell",
    account: null,
    secret: {
      label: "API token",
      placeholder: "Replicate API token",
      required: true,
    },
  },
]

export function imageProviderById(id: string) {
  return imageProviders.find((item) => item.id === id)
}

export function imageProviderPublic() {
  return imageProviders.map((item) => ({
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

export function imageAuthReady(
  value: ImageProvider | null,
): value is ImageProvider {
  if (!value) return false
  const spec = imageProviderById(value.provider)
  if (!spec) return false
  if (spec.account?.required && value.accountId.trim() === "") return false
  return value.apiKey.trim() !== "" && value.model.trim() !== ""
}
