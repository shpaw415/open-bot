import {
  accountIdField,
  apiKeyField,
  type CatalogSpec,
  catalogById,
  type ProviderFieldSpec,
} from "./provider-catalog"

export type System1ProviderId =
  | "cloudflare-jev"
  | "cloudflare-clef"
  | "laya"
  | "selfhosted-clef"

export type System1Spec = CatalogSpec<System1ProviderId> & {
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

const endpointField = (placeholder: string): ProviderFieldSpec => ({
  key: "endpoint",
  label: "Endpoint",
  placeholder,
  required: true,
})

export const system1Providers: readonly System1Spec[] = [
  {
    id: "cloudflare-jev",
    label: "Cloudflare Jev",
    vaultSlug: "cloudflare",
    fields: [
      accountIdField(),
      {
        key: "gatewayId",
        label: "Gateway ID",
        placeholder: "home-ai",
        required: true,
      },
      {
        key: "slug",
        label: "Provider slug",
        placeholder: "jev",
        required: false,
      },
      endpointField(CLOUDFLARE_ENDPOINT_PLACEHOLDER),
      apiKeyField("API key", "Cloudflare API token"),
      {
        key: "gatewayToken",
        label: "Gateway token (optional)",
        placeholder: "cf-aig-authorization",
        required: false,
        secret: true,
      },
    ],
    models: [{ id: "jev-latest", label: "jev-latest" }],
    defaultModel: "jev-latest",
    allowCustomModel: true,
    endpointPlaceholder: CLOUDFLARE_ENDPOINT_PLACEHOLDER,
    keyRequired: true,
    gatewayToken: true,
  },
  {
    id: "cloudflare-clef",
    label: "Cloudflare Clef",
    vaultSlug: "cloudflare",
    fields: [
      accountIdField(),
      endpointField(CLEF_ENDPOINT_PLACEHOLDER),
      apiKeyField("API key", "Cloudflare API token"),
    ],
    models: [
      { id: "clef", label: "clef" },
      { id: "clef-flash", label: "clef-flash" },
    ],
    defaultModel: "clef",
    allowCustomModel: true,
    endpointPlaceholder: CLEF_ENDPOINT_PLACEHOLDER,
    keyRequired: true,
    gatewayToken: false,
  },
  {
    id: "laya",
    label: "Self-hosted Laya",
    vaultSlug: "laya",
    fields: [
      endpointField(LAYA_ENDPOINT_PLACEHOLDER),
      apiKeyField("API key (optional)", "Laya API key (optional)", false),
    ],
    // The server chooses when blank; any model name may be typed.
    models: [],
    defaultModel: "",
    allowCustomModel: true,
    endpointPlaceholder: LAYA_ENDPOINT_PLACEHOLDER,
    keyRequired: false,
    gatewayToken: false,
  },
  {
    id: "selfhosted-clef",
    label: "Self-hosted Clef",
    vaultSlug: "",
    fields: [
      endpointField(SELFCLEF_ENDPOINT_PLACEHOLDER),
      apiKeyField("API key (optional)", "API key (optional)", false),
    ],
    models: [
      { id: "clef-flash", label: "clef-flash" },
      { id: "clef", label: "clef" },
    ],
    defaultModel: "clef-flash",
    allowCustomModel: true,
    endpointPlaceholder: SELFCLEF_ENDPOINT_PLACEHOLDER,
    keyRequired: false,
    gatewayToken: false,
  },
]

export function system1ProviderById(id: string) {
  return catalogById(system1Providers, id)
}

export function system1ProviderPublic() {
  return system1Providers.map((item) => ({
    id: item.id,
    label: item.label,
    vaultSlug: item.vaultSlug || null,
    fields: item.fields,
    models: item.models,
    defaultModel: item.defaultModel,
    allowCustomModel: item.allowCustomModel,
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
