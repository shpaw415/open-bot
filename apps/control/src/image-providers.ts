import type { ImageProvider } from "@open-bot/db"
import {
  accountIdField,
  apiKeyField,
  type CatalogSpec,
  catalogById,
  catalogPublic,
  modelOptions,
  parseFlatConfig,
} from "./provider-catalog"

export type ImageProviderId =
  | "cloudflare-workers-ai"
  | "xai"
  | "xai-gateway"
  | "openai"
  | "google"
  | "stability"
  | "replicate"

export type ImageProviderSpec = CatalogSpec<ImageProviderId>

export const imageProviders: readonly ImageProviderSpec[] = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
    vaultSlug: "cloudflare",
    fields: [accountIdField(), apiKeyField("API token", "Workers AI token")],
    models: modelOptions([
      "@cf/black-forest-labs/flux-2-klein-9b",
      "@cf/black-forest-labs/flux-1-schnell",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    ]),
    defaultModel: "@cf/black-forest-labs/flux-2-klein-9b",
    allowCustomModel: true,
  },
  {
    id: "xai",
    label: "xAI (Grok image)",
    vaultSlug: "xai",
    fields: [apiKeyField("API key", "xAI API key")],
    models: modelOptions(["grok-imagine-image"]),
    defaultModel: "grok-imagine-image",
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
    models: modelOptions(["grok-imagine-image"]),
    defaultModel: "grok-imagine-image",
    allowCustomModel: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    vaultSlug: "openai",
    fields: [apiKeyField("API key", "OpenAI API key")],
    models: modelOptions(["gpt-image-1", "dall-e-3", "dall-e-2"]),
    defaultModel: "gpt-image-1",
    allowCustomModel: true,
  },
  {
    id: "google",
    label: "Google Gemini (Imagen)",
    vaultSlug: "google",
    fields: [apiKeyField("API key", "Gemini API key")],
    models: modelOptions(["imagen-4.0-generate-001"]),
    defaultModel: "imagen-4.0-generate-001",
    allowCustomModel: true,
  },
  {
    id: "stability",
    label: "Stability AI",
    vaultSlug: "stability",
    fields: [apiKeyField("API key", "Stability API key")],
    models: modelOptions(["core", "ultra"]),
    defaultModel: "core",
    allowCustomModel: true,
  },
  {
    id: "replicate",
    label: "Replicate",
    vaultSlug: "replicate",
    fields: [apiKeyField("API token", "Replicate API token")],
    models: modelOptions([
      "black-forest-labs/flux-schnell",
      "black-forest-labs/flux-dev",
      "black-forest-labs/flux-pro",
    ]),
    defaultModel: "black-forest-labs/flux-schnell",
    allowCustomModel: true,
  },
]

export function imageProviderById(id: string) {
  return catalogById(imageProviders, id)
}

export function imageProviderPublic() {
  return catalogPublic(imageProviders)
}

// Flat storage parses into one of these or null: account-backed providers
// (Cloudflare) cannot be built without an account id.
export type ImageConfig =
  | {
      provider: "cloudflare-workers-ai" | "xai-gateway"
      apiKey: string
      accountId: string
      model: string
    }
  | {
      provider: "xai" | "openai" | "google" | "stability" | "replicate"
      apiKey: string
      model: string
    }

export function parseImageConfig(
  value: ImageProvider | null,
): ImageConfig | null {
  const parsed = parseFlatConfig(imageProviders, value)
  if (!parsed) return null
  const { spec, apiKey, accountId, model } = parsed
  if (spec.id === "cloudflare-workers-ai" || spec.id === "xai-gateway") {
    return { provider: spec.id, apiKey, accountId, model }
  }
  return { provider: spec.id, apiKey, model }
}

export function imageAuthReady(
  value: ImageProvider | null,
): value is ImageProvider {
  return parseImageConfig(value) !== null
}
