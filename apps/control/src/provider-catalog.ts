// Shared shape for the single-provider catalogs (image, video, model3d,
// system1, watchdog) — the same treatment the voice catalog gets in
// voice-catalog.ts: each provider declares the credential fields it takes,
// the models it offers, and its vault slug, and config UIs render only
// that. Pure module (no DB/team imports) so team.ts can validate overlays
// against it without an import cycle.

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

export type CatalogSpec<Id extends string = string> = {
  id: Id
  label: string
  // Keys-tab vault slug this provider can reuse ("" = none).
  vaultSlug: string
  fields: readonly ProviderFieldSpec[]
  models: readonly ProviderModelSpec[]
  defaultModel: string
  // Media/LLM providers accept model ids beyond the curated list (any
  // Replicate slug, a just-released model): the select is the curated
  // path, "custom" stays an explicit escape hatch instead of free text
  // being the only path. Voice-style closed lists set this false.
  allowCustomModel: boolean
}

export const accountIdField = (
  placeholder = "Cloudflare account ID",
): ProviderFieldSpec => ({
  key: "accountId",
  label: "Account ID",
  placeholder,
  required: true,
  hint: "The 32-character ID from the Cloudflare dashboard.",
})

export const apiKeyField = (
  label: string,
  placeholder: string,
  required = true,
): ProviderFieldSpec => ({
  key: "apiKey",
  label,
  placeholder,
  required,
  secret: true,
})

export const modelOptions = (
  ids: readonly string[],
): readonly ProviderModelSpec[] => ids.map((id) => ({ id, label: id }))

export function catalogById<S extends CatalogSpec>(
  list: readonly S[],
  id: string,
): S | undefined {
  return list.find((item) => item.id === id)
}

export function catalogPublic<Id extends string>(
  list: readonly CatalogSpec<Id>[],
) {
  return list.map((item) => ({
    id: item.id,
    label: item.label,
    vaultSlug: item.vaultSlug || null,
    fields: item.fields,
    models: item.models,
    defaultModel: item.defaultModel,
    allowCustomModel: item.allowCustomModel,
  }))
}

export type PublicCatalogSpec = ReturnType<typeof catalogPublic>[number]

export function catalogField(
  spec: CatalogSpec | undefined,
  key: ProviderFieldKey,
): ProviderFieldSpec | undefined {
  return spec?.fields.find((field) => field.key === key)
}

export function catalogModel(
  spec: CatalogSpec,
  modelId: string,
): ProviderModelSpec | undefined {
  return spec.models.find((model) => model.id === modelId)
}

// Blank takes the provider default; anything else passes through (custom
// models validate through `modelAllowed`, not here).
export function normalizeCatalogModel(spec: CatalogSpec, model: string) {
  return model.trim() || spec.defaultModel
}

export function modelAllowed(spec: CatalogSpec, model: string): boolean {
  const wanted = model.trim()
  if (!wanted) return true
  return spec.allowCustomModel || Boolean(catalogModel(spec, wanted))
}

// The flat {provider, accountId, apiKey, model} storage shared by the media
// kinds, read through a catalog: the provider must be known, required
// credential fields must be present, and the model comes back normalized.
// Returns the discriminated pieces the per-kind parsers narrow further.
export type FlatProviderConfig = {
  provider: string
  accountId: string
  apiKey: string
  model: string
}

export function parseFlatConfig<S extends CatalogSpec>(
  list: readonly S[],
  value: FlatProviderConfig | null,
): {
  spec: S
  apiKey: string
  accountId: string
  model: string
} | null {
  if (!value) return null
  const spec = catalogById(list, value.provider)
  if (!spec) return null
  const apiKey = value.apiKey.trim()
  const account = catalogField(spec, "accountId")
  const accountId = value.accountId.trim()
  if (catalogField(spec, "apiKey")?.required && !apiKey) return null
  if (account?.required && !accountId) return null
  const model = normalizeCatalogModel(spec, value.model)
  if (!model || !modelAllowed(spec, model)) return null
  return { spec, apiKey, accountId, model }
}
