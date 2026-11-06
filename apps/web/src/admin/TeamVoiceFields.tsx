import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import Stack from "../stack"
import {
  canonicalVoiceProviderId,
  hasField,
  modelFor,
  normalizeVoiceModel,
  specFor,
  type VoiceKind,
  type VoiceSpec,
} from "../voice-catalog"

export type TeamVoiceFieldsProps = {
  providers: VoiceSpec[]
  // The `voice` overlay draft (sttProvider/sttAccountId/... flat fields).
  values: Record<string, string>
  // Per-field stored-secret markers (`secrets.voice.fields`).
  secrets?: Record<string, boolean>
  onChange: (field: string, value: string) => void
}

const SIDE_LABEL: Record<VoiceKind, string> = {
  stt: "Speech to text",
  tts: "Text to speech",
}

// The team voice overlay rendered from the same provider catalog as the
// per-user Voice tab: per side, a provider select, then only the credential
// fields and model select that provider takes. Voice and language have no
// overlay fields — they stay per-user even in team mode.
export function TeamVoiceFields({
  providers,
  values,
  secrets,
  onChange,
}: TeamVoiceFieldsProps) {
  if (providers.length === 0) {
    return (
      <Typography variant="caption" color="error">
        Provider catalog unavailable — the control plane is older than this
        dashboard. Update it before editing these settings.
      </Typography>
    )
  }
  return (
    <Stack spacing={1.5} sx={{ mt: 0.5 }}>
      {(["stt", "tts"] as const).map((side) => (
        <TeamVoiceSide
          key={side}
          side={side}
          providers={providers}
          values={values}
          secrets={secrets}
          onChange={onChange}
        />
      ))}
    </Stack>
  )
}

function TeamVoiceSide({
  side,
  providers,
  values,
  secrets,
  onChange,
}: TeamVoiceFieldsProps & { side: VoiceKind }) {
  const providerField = `${side}Provider`
  const accountField = `${side}AccountId`
  const apiKeyField = `${side}ApiKey`
  const modelField = `${side}Model`
  const providerId = canonicalVoiceProviderId(values[providerField] ?? "")
  const spec = specFor(providers, side, providerId)
  const model = spec
    ? normalizeVoiceModel(spec, values[modelField] ?? "")
    : (values[modelField] ?? "")
  const modelKnown = !spec || model === "" || Boolean(modelFor(spec, model))
  const keyStored = Boolean(secrets?.[apiKeyField])

  function pickProvider(id: string) {
    const next = specFor(providers, side, id)
    onChange(providerField, id)
    onChange(modelField, next?.defaultModel ?? "")
    if (!hasField(next, "accountId")) onChange(accountField, "")
  }

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="textSecondary">
        {SIDE_LABEL[side]}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
        <Select
          name={`team-voice-${side}-provider`}
          label={`${side.toUpperCase()} provider`}
          value={providerId}
          sx={{ width: 240 }}
          onSelect={pickProvider}
        >
          {[
            <option key="none" value="">
              Not set
            </option>,
            ...(providerId && !spec
              ? [
                  <option key={providerId} value={providerId}>
                    {`${providerId} (unsupported)`}
                  </option>,
                ]
              : []),
            ...providers
              .filter((item) => item.kind === side)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              )),
          ]}
        </Select>
        {spec
          ? spec.fields.map((field) =>
              field.key === "accountId" ? (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={values[accountField] ?? ""}
                  placeholder={field.placeholder}
                  helpText={field.hint}
                  sx={{ width: 240 }}
                  onChange={(event) =>
                    onChange(accountField, event.currentTarget.value)
                  }
                />
              ) : (
                <TextField
                  key={field.key}
                  label={field.label}
                  type="password"
                  value={values[apiKeyField] ?? ""}
                  placeholder={
                    keyStored ? "(stored — leave blank to keep)" : "(not set)"
                  }
                  sx={{ width: 240 }}
                  onChange={(event) =>
                    onChange(apiKeyField, event.currentTarget.value)
                  }
                />
              ),
            )
          : null}
        {spec && spec.models.length > 0 ? (
          <Select
            name={`team-voice-${side}-model`}
            label={`${side.toUpperCase()} model`}
            value={model}
            sx={{ width: 240 }}
            onSelect={(id) => onChange(modelField, id)}
          >
            {[
              ...(modelKnown
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
            ]}
          </Select>
        ) : null}
      </Stack>
    </Stack>
  )
}
