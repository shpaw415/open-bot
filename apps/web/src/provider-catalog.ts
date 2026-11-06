// Mirrors the public catalog shape in apps/control/src/provider-catalog.ts
// (served by the per-kind GET routes and `providerCatalogs` on
// GET /api/admin/team). The per-user Config forms and the admin team
// sections render exactly the fields and models a provider declares.
export type ProviderFieldKey =
  | "accountId"
  | "apiKey"
  | "gatewayToken"
  | "endpoint"
  | "baseUrl"
  | "gatewayId"
  | "slug"

export type ProviderFieldSpec = {
  key: ProviderFieldKey
  label: string
  placeholder: string
  required: boolean
  secret?: boolean
  hint?: string
}

export type ProviderModelSpec = { id: string; label: string }

export type PublicCatalogSpec = {
  id: string
  label: string
  vaultSlug: string | null
  fields: ProviderFieldSpec[]
  models: ProviderModelSpec[]
  defaultModel: string
  allowCustomModel: boolean
}

// Provider id unions, mirroring the control catalogs — overlay and form
// state that carries a provider is checked against these, not `string`.
export type ImageProviderId =
  | "cloudflare-workers-ai"
  | "xai"
  | "xai-gateway"
  | "openai"
  | "google"
  | "stability"
  | "replicate"
export type VideoProviderId =
  | "xai"
  | "xai-gateway"
  | "openai"
  | "google"
  | "replicate"
  | "fal"
export type Model3dProviderId = "meshy" | "tripo" | "replicate" | "fal"
export type System1ProviderId =
  | "cloudflare-jev"
  | "cloudflare-clef"
  | "laya"
  | "selfhosted-clef"
export type WatchdogProviderId = "workers-ai" | "openai" | "xai" | "custom"

// system1ProviderPublic() adds endpoint composition metadata on top.
export type System1PublicSpec = PublicCatalogSpec & {
  endpointPlaceholder: string
  keyRequired: boolean
  gatewayToken: boolean
}

export function specForId<S extends PublicCatalogSpec>(
  providers: readonly S[],
  id: string,
): S | undefined {
  return providers.find((item) => item.id === id)
}

export function modelFor(
  spec: PublicCatalogSpec | undefined,
  modelId: string,
): ProviderModelSpec | undefined {
  return spec?.models.find((model) => model.id === modelId)
}

export function hasField(
  spec: PublicCatalogSpec | undefined,
  key: ProviderFieldKey,
): ProviderFieldSpec | undefined {
  return spec?.fields.find((field) => field.key === key)
}

// Blank takes the provider default (mirrors normalizeCatalogModel).
export function normalizeModel(spec: PublicCatalogSpec, model: string) {
  return model.trim() || spec.defaultModel
}

export const CUSTOM_MODEL = "__custom__"

export function isCustomModel(
  spec: PublicCatalogSpec | undefined,
  model: string,
): boolean {
  return Boolean(
    spec && spec.models.length > 0 && model !== "" && !modelFor(spec, model),
  )
}
