import Select from "@shpaw415/mui-lite/Select"
import { useEffect, useState } from "react"
import { CatalogFields, CatalogModelSelect } from "../ProviderFields"
import {
  isCustomModel,
  normalizeModel,
  type ProviderFieldKey,
  type PublicCatalogSpec,
  specForId,
} from "../provider-catalog"
import Stack from "../stack"

export type TeamProviderFieldsProps = {
  section: string
  providers: PublicCatalogSpec[]
  // The section's overlay draft (provider/accountId/apiKey/model/...).
  values: Record<string, string>
  // Per-field stored-secret markers (`secrets[section].fields`).
  secrets?: Record<string, boolean>
  onChange: (field: string, value: string) => void
}

// A single-provider team overlay section (image, video, model3d, system1,
// watchdog) rendered from its catalog: a provider select, then only the
// credential fields and model select that provider takes.
export function TeamProviderFields({
  section,
  providers,
  values,
  secrets,
  onChange,
}: TeamProviderFieldsProps) {
  const providerId = values.provider ?? ""
  const spec = specForId(providers, providerId)
  const model = spec
    ? normalizeModel(spec, values.model ?? "")
    : (values.model ?? "")
  const [modelCustom, setModelCustom] = useState(() =>
    isCustomModel(spec, model),
  )

  // Re-derive the custom flag when a fresh draft loads for this section.
  // Only the provider identity should reset the flag; keystrokes in the
  // custom field must not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: provider identity is the intended trigger (see above)
  useEffect(() => {
    setModelCustom(isCustomModel(specForId(providers, providerId), model))
  }, [providerId])

  function pickProvider(id: string) {
    const next = specForId(providers, id)
    onChange("provider", id)
    onChange("model", next?.defaultModel ?? "")
    setModelCustom(false)
    if (!next?.fields.some((field) => field.key === "accountId")) {
      onChange("accountId", "")
    }
  }

  const providerKnown =
    providerId === "" || Boolean(specForId(providers, providerId))

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
      <Select
        name={`team-${section}-provider`}
        label="Provider"
        value={providerId}
        sx={{ width: 240 }}
        onSelect={pickProvider}
      >
        {[
          <option key="none" value="">
            Not set
          </option>,
          ...(providerKnown
            ? []
            : [
                <option key={providerId} value={providerId}>
                  {`${providerId} (unsupported)`}
                </option>,
              ]),
          ...providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          )),
        ]}
      </Select>
      {spec ? (
        <>
          <CatalogFields
            spec={spec}
            values={values}
            width={240}
            secretStored={(key: ProviderFieldKey) => Boolean(secrets?.[key])}
            onChange={(key, value) => onChange(key, value)}
          />
          <CatalogModelSelect
            name={`team-${section}-model`}
            label="Model"
            spec={spec}
            model={model}
            custom={modelCustom}
            width={240}
            freePlaceholder={spec.defaultModel || "Model id"}
            onPick={(next, custom) => {
              onChange("model", next)
              setModelCustom(custom)
            }}
          />
        </>
      ) : null}
    </Stack>
  )
}
