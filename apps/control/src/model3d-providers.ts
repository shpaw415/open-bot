import type { Model3dProvider } from "@open-bot/db"

export type Model3dProviderField = {
  label: string
  placeholder: string
  required: boolean
}

export type Model3dProviderSpec = {
  id: string
  label: string
  defaultModel: string
  account: Model3dProviderField | null
  secret: Model3dProviderField
}

export const model3dProviders: Model3dProviderSpec[] = [
  {
    id: "meshy",
    label: "Meshy AI",
    defaultModel: "meshy-5",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Meshy API key",
      required: true,
    },
  },
  {
    id: "tripo",
    label: "Tripo AI",
    defaultModel: "latest",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Tripo API key",
      required: true,
    },
  },
  {
    id: "replicate",
    label: "Replicate",
    defaultModel: "firtoz/trellis",
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
    defaultModel: "fal-ai/tripo/v2.5/text-to-3d",
    account: null,
    secret: {
      label: "API key",
      placeholder: "fal API key",
      required: true,
    },
  },
]

export function model3dProviderById(id: string) {
  return model3dProviders.find((item) => item.id === id)
}

export function model3dProviderPublic() {
  return model3dProviders.map((item) => ({
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

export function model3dAuthReady(
  value: Model3dProvider | null,
): value is Model3dProvider {
  if (!value) return false
  const spec = model3dProviderById(value.provider)
  if (!spec) return false
  if (spec.account?.required && value.accountId.trim() === "") return false
  return value.apiKey.trim() !== "" && value.model.trim() !== ""
}
