// Mirrors `voiceProvidersPublic()` in apps/control/src/voice-catalog.ts —
// the server catalog is the single source of truth for which fields, models
// and voices each provider takes; the per-user Voice tab and the admin team
// voice section both render from it.
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
  options: VoiceOption[]
  allowCustom?: boolean
}

export type VoiceModelSpec = {
  id: string
  label: string
  voices?: VoiceVoices
  defaultVoice?: string
}

export type VoiceFieldKey = "accountId" | "apiKey"

export type VoiceFieldSpec = {
  key: VoiceFieldKey
  label: string
  placeholder: string
  required: boolean
  secret?: boolean
  hint?: string
}

export type VoiceSpec = {
  id: VoiceProviderId
  label: string
  kind: VoiceKind
  vaultSlug: string | null
  fields: VoiceFieldSpec[]
  models: VoiceModelSpec[]
  defaultModel: string
  voices: VoiceVoices | null
  defaultVoice: string
}

// Provider ids saved before the Cloudflare entries were consolidated.
const LEGACY_PROVIDER_IDS: Record<string, string> = {
  "workers-ai-stt": "cloudflare-stt",
  "deepgram-stt": "cloudflare-stt",
  "workers-ai-tts": "cloudflare-tts",
}

export function canonicalVoiceProviderId(id: string): string {
  return LEGACY_PROVIDER_IDS[id] ?? id
}

const LEGACY_WHISPER_MODEL = "@cf/openai/whisper"
const WHISPER_TURBO_MODEL = "@cf/openai/whisper-large-v3-turbo"

// Blank takes the provider default; the retired Cloudflare whisper model
// remaps to turbo (mirrors normalizeVoiceModel on the server).
export function normalizeVoiceModel(spec: VoiceSpec, model: string): string {
  const wanted = model.trim()
  if (!wanted) return spec.defaultModel
  if (spec.id === "cloudflare-stt" && wanted === LEGACY_WHISPER_MODEL) {
    return WHISPER_TURBO_MODEL
  }
  return wanted
}

export function specFor(
  providers: VoiceSpec[],
  kind: VoiceKind,
  id: string,
): VoiceSpec | undefined {
  const canonical = canonicalVoiceProviderId(id)
  return providers.find((item) => item.kind === kind && item.id === canonical)
}

export function modelFor(
  spec: VoiceSpec | undefined,
  modelId: string,
): VoiceModelSpec | undefined {
  return spec?.models.find((model) => model.id === modelId)
}

export function voicesFor(
  spec: VoiceSpec | undefined,
  modelId: string,
): VoiceVoices | undefined {
  return modelFor(spec, modelId)?.voices ?? spec?.voices ?? undefined
}

export function defaultVoiceFor(
  spec: VoiceSpec | undefined,
  modelId: string,
): string {
  return modelFor(spec, modelId)?.defaultVoice ?? spec?.defaultVoice ?? ""
}

export function hasField(
  spec: VoiceSpec | undefined,
  key: VoiceFieldKey,
): VoiceFieldSpec | undefined {
  return spec?.fields.find((field) => field.key === key)
}
