import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import {
  CUSTOM_MODEL,
  modelFor,
  type ProviderFieldKey,
  type PublicCatalogSpec,
} from "./provider-catalog"
import Stack from "./stack"
import { VaultOverrideButton } from "./vault-lock"

export type CatalogFieldsProps = {
  spec: PublicCatalogSpec
  values: Partial<Record<ProviderFieldKey, string>>
  onChange: (key: ProviderFieldKey, value: string) => void
  disabled?: boolean
  // User forms: the vault supplies the credentials, fields stay locked
  // until the explicit override.
  locked?: boolean
  onOverride?: () => void
  // User forms: a saved key exists for the currently selected provider.
  hasSavedSecret?: boolean
  // Admin forms: a secret value is stored server-side for this field.
  secretStored?: (key: ProviderFieldKey) => boolean
  width?: number
}

// The credential fields a catalog provider declares — nothing else renders.
// Secret fields are passwords whose blank value keeps the stored key.
export function CatalogFields({
  spec,
  values,
  onChange,
  disabled = false,
  locked = false,
  onOverride,
  hasSavedSecret = false,
  secretStored,
  width,
}: CatalogFieldsProps) {
  const sx = width ? { width } : undefined
  return (
    <>
      {spec.fields.map((field) => {
        const stored = secretStored?.(field.key) ?? false
        const input = field.secret ? (
          <TextField
            key={field.key}
            label={
              locked
                ? field.key === "apiKey"
                  ? "Using the vault key"
                  : `${field.label} (from vault)`
                : hasSavedSecret
                  ? `${field.label} (blank keeps the saved key)`
                  : field.label
            }
            type={locked ? undefined : "password"}
            value={locked ? "" : (values[field.key] ?? "")}
            placeholder={
              locked
                ? "••••••••"
                : stored
                  ? "(stored — leave blank to keep)"
                  : secretStored
                    ? "(not set)"
                    : field.placeholder
            }
            helpText={field.hint}
            disabled={disabled || locked}
            sx={width ? sx : { flex: 1 }}
            onChange={(event) => onChange(field.key, event.currentTarget.value)}
          />
        ) : (
          <TextField
            key={field.key}
            label={locked ? `${field.label} (from vault)` : field.label}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            helpText={field.hint}
            disabled={disabled || locked}
            sx={sx}
            onChange={(event) => onChange(field.key, event.currentTarget.value)}
          />
        )
        return locked && onOverride ? (
          <Stack
            key={field.key}
            direction="row"
            spacing={1}
            alignItems="center"
          >
            {input}
            <VaultOverrideButton onClick={onOverride} />
          </Stack>
        ) : (
          <span key={field.key} style={{ display: "contents" }}>
            {input}
          </span>
        )
      })}
    </>
  )
}

export type CatalogModelSelectProps = {
  name: string
  label?: string
  spec: PublicCatalogSpec
  model: string
  custom: boolean
  disabled?: boolean
  width?: number
  // Text-field placeholder when the provider has no model list.
  freePlaceholder?: string
  onPick: (model: string, custom: boolean) => void
}

// The model picker for a catalog provider: a select of its models, plus a
// "Custom model…" escape hatch (free text) where the catalog allows it.
// Providers with no model list render the free text field alone. A saved
// model the catalog no longer lists shows as unsupported instead of
// vanishing.
export function CatalogModelSelect({
  name,
  label = "Model",
  spec,
  model,
  custom,
  disabled = false,
  width,
  freePlaceholder,
  onPick,
}: CatalogModelSelectProps) {
  const sx = width ? { width } : undefined
  if (spec.models.length === 0) {
    return (
      <TextField
        label={label}
        value={model}
        placeholder={freePlaceholder ?? spec.defaultModel}
        disabled={disabled}
        sx={sx}
        onChange={(event) => onPick(event.currentTarget.value, true)}
      />
    )
  }
  const known = model === "" || Boolean(modelFor(spec, model))
  return (
    <>
      <Select
        name={name}
        label={label}
        value={custom ? CUSTOM_MODEL : model}
        disabled={disabled}
        sx={sx}
        onSelect={(id) => {
          if (id === CUSTOM_MODEL) onPick(model, true)
          else onPick(id, false)
        }}
      >
        {[
          ...(known || custom
            ? []
            : [
                <option key={model} value={model}>
                  {`${model} (unsupported — pick a listed model)`}
                </option>,
              ]),
          ...spec.models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          )),
          ...(spec.allowCustomModel
            ? [
                <option key={CUSTOM_MODEL} value={CUSTOM_MODEL}>
                  Custom model…
                </option>,
              ]
            : []),
        ]}
      </Select>
      {spec.allowCustomModel && custom ? (
        <TextField
          label="Custom model"
          value={model}
          placeholder={spec.defaultModel}
          disabled={disabled}
          sx={sx}
          onChange={(event) => onPick(event.currentTarget.value, true)}
        />
      ) : null}
    </>
  )
}
