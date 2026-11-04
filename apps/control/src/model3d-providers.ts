import type { Model3dProvider } from "@open-bot/db"
import {
  apiKeyField,
  type CatalogSpec,
  catalogById,
  catalogPublic,
  modelOptions,
  parseFlatConfig,
} from "./provider-catalog"

export type Model3dProviderId = "meshy" | "tripo" | "replicate" | "fal"

export type Model3dProviderSpec = CatalogSpec<Model3dProviderId>

export const model3dProviders: readonly Model3dProviderSpec[] = [
  {
    id: "meshy",
    label: "Meshy AI",
    vaultSlug: "meshy",
    fields: [apiKeyField("API key", "Meshy API key")],
    models: modelOptions(["meshy-5", "meshy-4", "latest"]),
    defaultModel: "meshy-5",
    allowCustomModel: true,
  },
  {
    id: "tripo",
    label: "Tripo AI",
    vaultSlug: "tripo",
    fields: [apiKeyField("API key", "Tripo API key")],
    models: modelOptions(["latest"]),
    defaultModel: "latest",
    allowCustomModel: true,
  },
  {
    id: "replicate",
    label: "Replicate",
    vaultSlug: "replicate",
    fields: [apiKeyField("API token", "Replicate API token")],
    models: modelOptions(["firtoz/trellis"]),
    defaultModel: "firtoz/trellis",
    allowCustomModel: true,
  },
  {
    id: "fal",
    label: "fal.ai",
    vaultSlug: "fal",
    fields: [apiKeyField("API key", "fal API key")],
    models: modelOptions(["fal-ai/tripo/v2.5/text-to-3d"]),
    defaultModel: "fal-ai/tripo/v2.5/text-to-3d",
    allowCustomModel: true,
  },
]

export function model3dProviderById(id: string) {
  return catalogById(model3dProviders, id)
}

export function model3dProviderPublic() {
  return catalogPublic(model3dProviders)
}

export type Model3dConfig = {
  provider: Model3dProviderId
  apiKey: string
  model: string
}

export function parseModel3dConfig(
  value: Model3dProvider | null,
): Model3dConfig | null {
  const parsed = parseFlatConfig(model3dProviders, value)
  if (!parsed) return null
  return {
    provider: parsed.spec.id,
    apiKey: parsed.apiKey,
    model: parsed.model,
  }
}

export function model3dAuthReady(
  value: Model3dProvider | null,
): value is Model3dProvider {
  return parseModel3dConfig(value) !== null
}
