import {
  accountIdField,
  apiKeyField,
  type CatalogSpec,
  catalogById,
  catalogPublic,
  modelOptions,
} from "./provider-catalog"

// The watchdog verdict-provider catalog. Split from watchdog.ts so team.ts
// can validate the shared watchdog overlay without an import cycle
// (watchdog.ts resolves team state).
export type WatchdogProviderId = "workers-ai" | "openai" | "xai" | "custom"

export type WatchdogProviderSpec = CatalogSpec<WatchdogProviderId> & {
  /** Cloudflare Workers AI path-style models need the account id. */
  accountRequired: boolean
  baseUrl: string | null
}

export const watchdogProviders: readonly WatchdogProviderSpec[] = [
  {
    id: "workers-ai",
    label: "Cloudflare Workers AI",
    vaultSlug: "cloudflare",
    fields: [accountIdField(), apiKeyField("API key", "Cloudflare API token")],
    models: modelOptions(["@cf/mistralai/mistral-small-3.1-24b-instruct"]),
    defaultModel: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    allowCustomModel: true,
    accountRequired: true,
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    vaultSlug: "openai",
    fields: [apiKeyField("API key", "OpenAI API key")],
    models: modelOptions(["gpt-4o-mini", "gpt-4o"]),
    defaultModel: "gpt-4o-mini",
    allowCustomModel: true,
    accountRequired: false,
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "xai",
    label: "xAI",
    vaultSlug: "xai",
    fields: [apiKeyField("API key", "xAI API key")],
    models: modelOptions(["grok-3-mini"]),
    defaultModel: "grok-3-mini",
    allowCustomModel: true,
    accountRequired: false,
    baseUrl: "https://api.x.ai/v1",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    vaultSlug: "",
    fields: [
      apiKeyField("API key", "API key", false),
      {
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://gateway.example/v1",
        required: true,
      },
    ],
    // Any model the endpoint serves; typed, never blank.
    models: [],
    defaultModel: "",
    allowCustomModel: true,
    accountRequired: false,
    baseUrl: null,
  },
]

export function watchdogProviderById(id: string) {
  return catalogById(watchdogProviders, id)
}

export function watchdogProviderPublic() {
  return catalogPublic(watchdogProviders)
}

export function providerBaseUrl(spec: WatchdogProviderSpec, accountId: string) {
  if (!spec.baseUrl) return ""
  return spec.baseUrl.replace("{accountId}", encodeURIComponent(accountId))
}
