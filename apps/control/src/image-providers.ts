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
