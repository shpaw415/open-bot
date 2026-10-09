export type System1Spec = {
  id: string
  label: string
  defaultModel: string
  endpointPlaceholder: string
  keyRequired: boolean
  gatewayToken: boolean
}

export const CLOUDFLARE_ENDPOINT_PLACEHOLDER =
  "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-jev/v1/systemone"

export const CLEF_ENDPOINT_PLACEHOLDER =
  "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef"

export const LAYA_ENDPOINT_PLACEHOLDER = "http://laya.example:8000/v1/systemone"

export const SELFCLEF_ENDPOINT_PLACEHOLDER =
  "http://clef.example:8011/v1/systemone"

export const system1Providers: System1Spec[] = [
  {
    id: "cloudflare-jev",
    label: "Cloudflare Jev",
    defaultModel: "jev-latest",
    endpointPlaceholder: CLOUDFLARE_ENDPOINT_PLACEHOLDER,
    keyRequired: true,
    gatewayToken: true,
  },
  {
    id: "cloudflare-clef",
    label: "Cloudflare Clef",
    defaultModel: "clef",
    endpointPlaceholder: CLEF_ENDPOINT_PLACEHOLDER,
    keyRequired: true,
    gatewayToken: false,
  },
  {
    id: "laya",
    label: "Self-hosted Laya",
    defaultModel: "",
    endpointPlaceholder: LAYA_ENDPOINT_PLACEHOLDER,
    keyRequired: false,
    gatewayToken: false,
  },
  {
    id: "selfhosted-clef",
    label: "Self-hosted Clef",
    defaultModel: "clef-flash",
    endpointPlaceholder: SELFCLEF_ENDPOINT_PLACEHOLDER,
    keyRequired: false,
    gatewayToken: false,
  },
]

export function system1ProviderById(id: string) {
  return system1Providers.find((item) => item.id === id)
}

export function system1ProviderPublic() {
  return system1Providers.map((item) => ({
    id: item.id,
    label: item.label,
    defaultModel: item.defaultModel,
    endpointPlaceholder: item.endpointPlaceholder,
    keyRequired: item.keyRequired,
    gatewayToken: item.gatewayToken,
  }))
}

export function composeCloudflareEndpoint(
  accountId: string,
  gatewayId: string,
  slug: string,
) {
  const account = accountId.trim()
  const gateway = gatewayId.trim()
  const name = (slug.trim() || "jev").replace(/^custom-/, "")
  if (!/^[A-Za-z0-9_-]+$/.test(account)) return ""
  if (!/^[A-Za-z0-9_-]+$/.test(gateway)) return ""
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return ""
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/custom-${name}/v1/systemone`
}

export function composeClefEndpoint(accountId: string) {
  const account = accountId.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(account)) return ""
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/clef`
}

export function system1EndpointError(provider: string, endpoint: string) {
  const spec = system1ProviderById(provider)
  if (!spec) return "unsupported provider"
  if (endpoint.includes("{") || endpoint.includes("}")) {
    return "replace the endpoint placeholders"
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return "endpoint must be a URL"
  }
  if (url.username || url.password) {
    return "endpoint must not include a username or password"
  }
  if (spec.id === "cloudflare-jev" || spec.id === "cloudflare-clef") {
    if (url.protocol !== "https:") return "Cloudflare endpoint must be https"
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${spec.label} endpoint must be http or https`
  }
  return null
}

export function system1FieldError(name: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return `${name} may only contain letters, numbers, hyphens, and underscores`
  }
  return null
}
