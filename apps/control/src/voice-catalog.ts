import type { VoiceConfig } from "@open-bot/db"

// The provider catalog and everything derivable from it without the DB
// or team state: specs, canonical ids, model/voice resolution and the
// flat-storage parsers. `voice-providers.ts` layers saving, resolving
// and the provider HTTP calls on top; `team.ts` validates the shared
// voice overlay against this module (importing it here keeps the two
// free of an import cycle).

export type VoiceKind = "stt" | "tts"
export type SttProviderId =
  | "openai-stt"
  | "groq-stt"
  | "xai-stt"
  | "cloudflare-stt"
export type TtsProviderId = "openai-tts" | "xai-tts" | "cloudflare-tts"
export type VoiceProviderId = SttProviderId | TtsProviderId

export type VoiceOption = { id: string; label: string }

export type VoiceVoices = {
  options: readonly VoiceOption[]
  // xAI also accepts cloned custom voice ids, so its list is presets only.
  allowCustom?: boolean
}

export type VoiceModelSpec = {
  id: string
  label: string
  // Model-scoped voices (Cloudflare aura-1 speakers) override the provider's.
  voices?: VoiceVoices
  defaultVoice?: string
}

// The only free-typed credentials a provider can ask for. Model and voice are
// selects driven by `models`/`voices`, never free text.
export type VoiceFieldKey = "accountId" | "apiKey"

export type VoiceFieldSpec = {
  key: VoiceFieldKey
  label: string
  placeholder: string
  required: boolean
  secret?: boolean
  hint?: string
}

export type VoiceProviderSpec = {
  id: VoiceProviderId
  label: string
  kind: VoiceKind
  // Keys-tab vault slug this provider can reuse ("" = none).
  vaultSlug: string
  fields: readonly VoiceFieldSpec[]
  models: readonly VoiceModelSpec[]
  defaultModel: string
  voices?: VoiceVoices
  defaultVoice: string
}

export const TTS_MAX_CHARS = 4000
export const STT_MAX_BYTES = 25 * 1024 * 1024
export const ttsMaxChars = (text: string) => text.slice(0, TTS_MAX_CHARS)

export const WORKERS_AI_STT_DEFAULT_MODEL = "@cf/openai/whisper-large-v3-turbo"
// Rows saved before the turbo default keep the old model literally; run them
// on turbo instead (the old model takes no language hint and is much weaker).
const LEGACY_WORKERS_AI_STT_MODEL = "@cf/openai/whisper"
export const DEEPGRAM_STT_MODEL = "@cf/deepgram/nova-3"
export const AURA_TTS_MODEL = "@cf/deepgram/aura-1"
const MELOTTS_TTS_MODEL = "@cf/myshell-ai/melotts"

const CLOUDFLARE_FIELDS: readonly VoiceFieldSpec[] = [
  {
    key: "accountId",
    label: "Account ID",
    placeholder: "Cloudflare account ID",
    required: true,
    hint: "The 32-character ID from the Cloudflare dashboard.",
  },
  {
    key: "apiKey",
    label: "API token",
    placeholder: "Cloudflare API token",
    required: true,
    secret: true,
  },
]

const apiKeyField = (placeholder: string): readonly VoiceFieldSpec[] => [
  {
    key: "apiKey",
    label: "API key",
    placeholder,
    required: true,
    secret: true,
  },
]

const voiceOptions = (ids: readonly string[]): VoiceVoices => ({
  options: ids.map((id) => ({
    id,
    label: id[0] ? id[0].toUpperCase() + id.slice(1) : id,
  })),
})

export const voiceProviders: readonly VoiceProviderSpec[] = [
  {
    id: "openai-stt",
    label: "OpenAI (Whisper)",
    kind: "stt",
    vaultSlug: "openai",
    fields: apiKeyField("OpenAI API key"),
    models: [
      { id: "whisper-1", label: "Whisper 1" },
      { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe" },
    ],
    defaultModel: "whisper-1",
    defaultVoice: "",
  },
  {
    id: "groq-stt",
    label: "Groq (Whisper)",
    kind: "stt",
    vaultSlug: "",
    fields: apiKeyField("Groq API key"),
    models: [
      { id: "whisper-large-v3", label: "Whisper Large v3" },
      { id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo" },
    ],
    defaultModel: "whisper-large-v3",
    defaultVoice: "",
  },
  {
    id: "xai-stt",
    label: "xAI (Grok Voice Transcribe)",
    kind: "stt",
    vaultSlug: "xai",
    fields: apiKeyField("xAI API key"),
    models: [
      {
        id: "grok-voice-transcribe-2.0",
        label: "Grok Voice Transcribe 2.0",
      },
    ],
    defaultModel: "grok-voice-transcribe-2.0",
    defaultVoice: "",
  },
  {
    id: "cloudflare-stt",
    label: "Cloudflare Workers AI",
    kind: "stt",
    vaultSlug: "cloudflare",
    fields: CLOUDFLARE_FIELDS,
    models: [
      {
        id: WORKERS_AI_STT_DEFAULT_MODEL,
        label: "Whisper Large v3 Turbo",
      },
      { id: DEEPGRAM_STT_MODEL, label: "Deepgram Nova-3" },
    ],
    defaultModel: WORKERS_AI_STT_DEFAULT_MODEL,
    defaultVoice: "",
  },
  {
    id: "openai-tts",
    label: "OpenAI",
    kind: "tts",
    vaultSlug: "openai",
    fields: apiKeyField("OpenAI API key"),
    models: [
      { id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS" },
      { id: "tts-1", label: "TTS 1" },
      { id: "tts-1-hd", label: "TTS 1 HD" },
    ],
    defaultModel: "gpt-4o-mini-tts",
    voices: voiceOptions([
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ]),
    defaultVoice: "alloy",
  },
  {
    id: "xai-tts",
    label: "xAI (Grok Voice)",
    kind: "tts",
    vaultSlug: "xai",
    fields: apiKeyField("xAI API key"),
    // The xAI TTS endpoint takes no model.
    models: [],
    defaultModel: "",
    voices: {
      ...voiceOptions(["ara", "eve", "leo", "rex", "sal"]),
      allowCustom: true,
    },
    defaultVoice: "eve",
  },
  {
    id: "cloudflare-tts",
    label: "Cloudflare Workers AI",
    kind: "tts",
    vaultSlug: "cloudflare",
    fields: CLOUDFLARE_FIELDS,
    models: [
      { id: MELOTTS_TTS_MODEL, label: "MeloTTS" },
      {
        id: AURA_TTS_MODEL,
        label: "Deepgram Aura 1",
        voices: voiceOptions([
          "angus",
          "asteria",
          "arcas",
          "orion",
          "orpheus",
          "athena",
          "luna",
          "zeus",
          "perseus",
          "helios",
          "hera",
          "stella",
        ]),
        defaultVoice: "angus",
      },
    ],
    defaultModel: MELOTTS_TTS_MODEL,
    defaultVoice: "",
  },
]

// Provider ids saved before the Cloudflare entries were consolidated into one
// provider per kind with a model select.
const LEGACY_PROVIDER_IDS: Record<string, VoiceProviderId> = {
  "workers-ai-stt": "cloudflare-stt",
  "deepgram-stt": "cloudflare-stt",
  "workers-ai-tts": "cloudflare-tts",
}

export function canonicalVoiceProviderId(id: string): string {
  return LEGACY_PROVIDER_IDS[id] ?? id
}

export function voiceProviderById(id: string) {
  const canonical = canonicalVoiceProviderId(id)
  return voiceProviders.find((item) => item.id === canonical)
}

export type VoiceSpecForKind<K extends VoiceKind> = VoiceProviderSpec & {
  id: K extends "stt" ? SttProviderId : TtsProviderId
  kind: K
}

export function voiceProviderForKind<K extends VoiceKind>(
  id: string,
  kind: K,
): VoiceSpecForKind<K> | undefined {
  const spec = voiceProviderById(id)
  return spec && spec.kind === kind ? (spec as VoiceSpecForKind<K>) : undefined
}

export function voiceProvidersPublic() {
  return voiceProviders.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    vaultSlug: item.vaultSlug || null,
    fields: item.fields,
    models: item.models,
    defaultModel: item.defaultModel,
    voices: item.voices ?? null,
    defaultVoice: item.defaultVoice,
  }))
}

export function voiceVaultSlug(providerId: string) {
  return voiceProviderById(providerId)?.vaultSlug ?? ""
}

export function voiceModelSpec(
  spec: VoiceProviderSpec,
  modelId: string,
): VoiceModelSpec | undefined {
  return spec.models.find((model) => model.id === modelId)
}

// Blank takes the provider default; the retired Cloudflare whisper model
// remaps to turbo. Anything else passes through for the caller to validate
// against the provider's model list.
export function normalizeVoiceModel(
  spec: VoiceProviderSpec,
  model: string,
): string {
  const wanted = model.trim()
  if (!wanted) return spec.defaultModel
  if (spec.id === "cloudflare-stt" && wanted === LEGACY_WORKERS_AI_STT_MODEL) {
    return WORKERS_AI_STT_DEFAULT_MODEL
  }
  return wanted
}

export function voiceOptionsFor(
  spec: VoiceProviderSpec,
  modelId: string,
): VoiceVoices | undefined {
  return voiceModelSpec(spec, modelId)?.voices ?? spec.voices
}

export function defaultVoiceFor(
  spec: VoiceProviderSpec,
  modelId: string,
): string {
  return voiceModelSpec(spec, modelId)?.defaultVoice ?? spec.defaultVoice
}

// The voice a run actually uses: the saved pick when the selected model
// offers it (or the provider accepts custom ids), else the model default.
// Models with no voices (MeloTTS) resolve to "" — the field is not shown.
function resolveVoice(
  spec: VoiceProviderSpec,
  modelId: string,
  voice: string,
): string {
  const voices = voiceOptionsFor(spec, modelId)
  if (!voices) return ""
  const wanted = voice.trim()
  if (
    wanted &&
    (voices.allowCustom || voices.options.some((item) => item.id === wanted))
  ) {
    return wanted
  }
  return defaultVoiceFor(spec, modelId)
}

export type OpenAiSttModel =
  | "whisper-1"
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe"
export type GroqSttModel = "whisper-large-v3" | "whisper-large-v3-turbo"
export type XaiSttModel = "grok-voice-transcribe-2.0"
export type CloudflareSttModel =
  | "@cf/openai/whisper-large-v3-turbo"
  | "@cf/deepgram/nova-3"
export type OpenAiTtsModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd"
export type CloudflareTtsModel =
  | "@cf/myshell-ai/melotts"
  | "@cf/deepgram/aura-1"

// Flat storage (`VoiceConfig`) parses into one of these per side, or null
// when anything the provider needs is missing or not offered by it. This is
// the only shape `runStt`/`runTts` accept, so a Cloudflare config without an
// account id (or an OpenAI one carrying a Cloudflare model) cannot be built.
export type SttConfig =
  | { provider: "openai-stt"; apiKey: string; model: OpenAiSttModel }
  | { provider: "groq-stt"; apiKey: string; model: GroqSttModel }
  | { provider: "xai-stt"; apiKey: string; model: XaiSttModel }
  | {
      provider: "cloudflare-stt"
      apiKey: string
      accountId: string
      model: CloudflareSttModel
    }

export type TtsConfig =
  | {
      provider: "openai-tts"
      apiKey: string
      model: OpenAiTtsModel
      voice: string
    }
  | { provider: "xai-tts"; apiKey: string; voice: string }
  | {
      provider: "cloudflare-tts"
      apiKey: string
      accountId: string
      model: CloudflareTtsModel
      voice: string
    }

export function parseSttConfig(value: VoiceConfig): SttConfig | null {
  const spec = voiceProviderForKind(value.sttProvider, "stt")
  if (!spec) return null
  const apiKey = value.sttApiKey.trim()
  if (!apiKey) return null
  const model = normalizeVoiceModel(spec, value.sttModel)
  if (!voiceModelSpec(spec, model)) return null
  switch (spec.id) {
    case "openai-stt":
      return { provider: "openai-stt", apiKey, model: model as OpenAiSttModel }
    case "groq-stt":
      return { provider: "groq-stt", apiKey, model: model as GroqSttModel }
    case "xai-stt":
      return { provider: "xai-stt", apiKey, model: model as XaiSttModel }
    case "cloudflare-stt": {
      const accountId = value.sttAccountId.trim()
      if (!accountId) return null
      return {
        provider: "cloudflare-stt",
        apiKey,
        accountId,
        model: model as CloudflareSttModel,
      }
    }
    default:
      return null
  }
}

export function parseTtsConfig(value: VoiceConfig): TtsConfig | null {
  const spec = voiceProviderForKind(value.ttsProvider, "tts")
  if (!spec) return null
  const apiKey = value.ttsApiKey.trim()
  if (!apiKey) return null
  const model = normalizeVoiceModel(spec, value.ttsModel)
  if (spec.models.length > 0 && !voiceModelSpec(spec, model)) return null
  const voice = resolveVoice(spec, model, value.ttsVoice)
  switch (spec.id) {
    case "openai-tts":
      return {
        provider: "openai-tts",
        apiKey,
        model: model as OpenAiTtsModel,
        voice,
      }
    case "xai-tts":
      return { provider: "xai-tts", apiKey, voice }
    case "cloudflare-tts": {
      const accountId = value.ttsAccountId.trim()
      if (!accountId) return null
      return {
        provider: "cloudflare-tts",
        apiKey,
        accountId,
        model: model as CloudflareTtsModel,
        voice,
      }
    }
    default:
      return null
  }
}

export function voiceReady(value: VoiceConfig, side: VoiceKind): boolean {
  return side === "stt"
    ? parseSttConfig(value) !== null
    : parseTtsConfig(value) !== null
}

// "fr-CA" and "fr" both normalize to "fr"; "auto" and "" mean unspecified.
export function languageCode(language: string): string {
  const code = language.trim().toLowerCase().split("-")[0] ?? ""
  return /^[a-z]{2}$/.test(code) ? code : ""
}

const CF_ACCOUNT_PATTERN = /^[a-f0-9]{32}$/i
const MIN_KEY_CHARS = 20

// Catches obviously-wrong credentials before a save: a Cloudflare account
// email instead of the 32-char Account ID, or a truncated API key. Blank
// fields stay legal — they resolve from the vault instead.
export function voiceConfigError(value: VoiceConfig): string | null {
  for (const side of ["stt", "tts"] as const) {
    const providerId = side === "stt" ? value.sttProvider : value.ttsProvider
    if (!providerId) continue
    const spec = voiceProviderById(providerId)
    if (!spec) continue
    const accountId = side === "stt" ? value.sttAccountId : value.ttsAccountId
    const apiKey = side === "stt" ? value.sttApiKey : value.ttsApiKey
    const accountField = spec.fields.find((field) => field.key === "accountId")
    if (
      accountField?.required &&
      accountId.trim() &&
      !CF_ACCOUNT_PATTERN.test(accountId.trim())
    ) {
      return `${spec.label}: the Account ID must be the 32-character Cloudflare ID (or leave it blank to reuse the vault key)`
    }
    if (apiKey.trim() && apiKey.trim().length < MIN_KEY_CHARS) {
      return `${spec.label}: that API key looks too short to be valid (or leave it blank to reuse the vault key)`
    }
  }
  return null
}
