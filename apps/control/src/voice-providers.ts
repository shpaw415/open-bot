import type { Db, VoiceConfig } from "@open-bot/db"
import { effectiveUserKey, getTeamConfig, objectHasAnyField } from "./team"

const VOICE_SHARED_SIDE_FIELDS = ["provider", "accountId", "apiKey", "model"]

// A team-mode non-admin may only write per-user fields (tts voice, language);
// any shared field anywhere in the body makes the whole PUT a team write.
export function voiceSharedFieldsPresent(
  body: Record<string, unknown>,
): boolean {
  return (
    objectHasAnyField(body.stt, VOICE_SHARED_SIDE_FIELDS) ||
    objectHasAnyField(body.tts, VOICE_SHARED_SIDE_FIELDS)
  )
}

// Merge a PUT body onto the saved voice config, field by field: an absent
// section or field keeps the stored value, a present field replaces it (blank
// clears). Provider config is shared in team mode; voice/language are
// per-user, which is why a team-mode partial PUT carries only those.
export function applyVoicePatch(
  current: VoiceConfig,
  body: Record<string, unknown>,
): { next: VoiceConfig; error: string | null } {
  const section = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  const next: VoiceConfig = { ...current }
  for (const side of ["stt", "tts"] as const) {
    const raw = section(body[side])
    if (!raw) continue
    const savedProvider = current[`${side}Provider`]
    const savedAccountId = current[`${side}AccountId`]
    const savedApiKey = current[`${side}ApiKey`]
    const savedModel = current[`${side}Model`]
    const rawProvider =
      raw.provider === undefined
        ? savedProvider
        : String(raw.provider ?? "").trim()
    const spec = rawProvider ? voiceProviderById(rawProvider) : undefined
    if (rawProvider && !spec) {
      return { next: current, error: "unsupported speech provider" }
    }
    const sameProvider = savedProvider === (spec?.id ?? "")
    next[`${side}Provider`] = spec?.id ?? ""
    next[`${side}AccountId`] =
      raw.accountId === undefined
        ? sameProvider
          ? savedAccountId
          : ""
        : String(raw.accountId ?? "").trim()
    next[`${side}ApiKey`] =
      raw.apiKey === undefined
        ? sameProvider
          ? savedApiKey
          : ""
        : String(raw.apiKey ?? "").trim() || (sameProvider ? savedApiKey : "")
    next[`${side}Model`] =
      raw.model === undefined
        ? savedModel || spec?.defaultModel || ""
        : String(raw.model ?? "").trim() || spec?.defaultModel || ""
    if (side === "tts") {
      next.ttsVoice =
        raw.voice === undefined
          ? current.ttsVoice
          : String(raw.voice ?? "").trim() || spec?.defaultVoice || ""
    }
  }
  next.language =
    body.language === undefined
      ? current.language
      : String(body.language ?? "").trim()
  return { next, error: null }
}

export type VoiceField = {
  label: string
  placeholder: string
  required: boolean
}

export type VoiceProviderSpec = {
  id: string
  label: string
  kind: "stt" | "tts"
  defaultModel: string
  modelOptional: boolean
  defaultVoice: string
  account: VoiceField | null
  secret: VoiceField
}

export const TTS_MAX_CHARS = 4000
export const STT_MAX_BYTES = 25 * 1024 * 1024
export const ttsMaxChars = (text: string) => text.slice(0, TTS_MAX_CHARS)

export const WORKERS_AI_STT_DEFAULT_MODEL = "@cf/openai/whisper-large-v3-turbo"
// Rows saved before the turbo default keep the old model literally; run them
// on turbo instead (the old model takes no language hint and is much weaker).
const LEGACY_WORKERS_AI_STT_MODEL = "@cf/openai/whisper"
// Only whisper turbo accepts the language/vad extras — smaller whisper
// deployments reject unknown fields.
const WORKERS_AI_STT_EXTRAS_MODELS = new Set([WORKERS_AI_STT_DEFAULT_MODEL])
const DEEPGRAM_STT_DEFAULT_MODEL = "@cf/deepgram/nova-3"

export const voiceProviders: VoiceProviderSpec[] = [
  {
    id: "openai-stt",
    label: "OpenAI (Whisper)",
    kind: "stt",
    defaultModel: "whisper-1",
    modelOptional: false,
    defaultVoice: "",
    account: null,
    secret: {
      label: "API key",
      placeholder: "OpenAI API key",
      required: true,
    },
  },
  {
    id: "groq-stt",
    label: "Groq (Whisper)",
    kind: "stt",
    defaultModel: "whisper-large-v3",
    modelOptional: false,
    defaultVoice: "",
    account: null,
    secret: {
      label: "API key",
      placeholder: "Groq API key",
      required: true,
    },
  },
  {
    id: "workers-ai-stt",
    label: "Cloudflare Workers AI (Whisper)",
    kind: "stt",
    defaultModel: WORKERS_AI_STT_DEFAULT_MODEL,
    modelOptional: false,
    defaultVoice: "",
    account: {
      label: "Account ID",
      placeholder: "Cloudflare account ID",
      required: true,
    },
    secret: {
      label: "API token",
      placeholder: "Cloudflare API token",
      required: true,
    },
  },
  {
    id: "deepgram-stt",
    label: "Cloudflare Workers AI (Deepgram Nova-3)",
    kind: "stt",
    defaultModel: DEEPGRAM_STT_DEFAULT_MODEL,
    modelOptional: false,
    defaultVoice: "",
    account: {
      label: "Account ID",
      placeholder: "Cloudflare account ID",
      required: true,
    },
    secret: {
      label: "API token",
      placeholder: "Cloudflare API token",
      required: true,
    },
  },
  {
    id: "openai-tts",
    label: "OpenAI",
    kind: "tts",
    defaultModel: "gpt-4o-mini-tts",
    modelOptional: false,
    defaultVoice: "alloy",
    account: null,
    secret: {
      label: "API key",
      placeholder: "OpenAI API key",
      required: true,
    },
  },
  {
    id: "xai-tts",
    label: "xAI (Grok voice)",
    kind: "tts",
    defaultModel: "",
    modelOptional: true,
    defaultVoice: "eve",
    account: null,
    secret: {
      label: "API key",
      placeholder: "xAI API key",
      required: true,
    },
  },
  {
    id: "workers-ai-tts",
    label: "Cloudflare Workers AI (Melotts)",
    kind: "tts",
    defaultModel: "@cf/myshell-ai/melotts",
    modelOptional: false,
    defaultVoice: "",
    account: {
      label: "Account ID",
      placeholder: "Cloudflare account ID",
      required: true,
    },
    secret: {
      label: "API token",
      placeholder: "Cloudflare API token",
      required: true,
    },
  },
]

export function voiceProviderById(id: string) {
  return voiceProviders.find((item) => item.id === id)
}

export function voiceProvidersPublic() {
  return voiceProviders.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    defaultModel: item.defaultModel,
    modelOptional: item.modelOptional,
    defaultVoice: item.defaultVoice,
    account: item.account,
    secret: {
      label: item.secret.label,
      placeholder: item.secret.placeholder,
    },
  }))
}

const voiceVaultSlugs: Record<string, string> = {
  "workers-ai-stt": "cloudflare",
  "deepgram-stt": "cloudflare",
  "workers-ai-tts": "cloudflare",
  "xai-tts": "xai",
  "openai-stt": "openai",
  "openai-tts": "openai",
}

export function voiceVaultSlug(providerId: string) {
  return voiceVaultSlugs[providerId] ?? ""
}

export function voiceReady(value: VoiceConfig, side: "stt" | "tts"): boolean {
  const providerId = side === "stt" ? value.sttProvider : value.ttsProvider
  const accountId = side === "stt" ? value.sttAccountId : value.ttsAccountId
  const apiKey = side === "stt" ? value.sttApiKey : value.ttsApiKey
  const model = side === "stt" ? value.sttModel : value.ttsModel
  const spec = voiceProviderById(providerId)
  if (!spec) return false
  if (spec.account?.required && accountId.trim() === "") return false
  if (apiKey.trim() === "") return false
  if (!spec.modelOptional && model.trim() === "") return false
  return true
}

export type ResolvedVoice = {
  value: VoiceConfig
  sttSource: "setup" | "vault" | "missing"
  ttsSource: "setup" | "vault" | "missing"
}

export function resolveVoiceConfig(db: Db, userId: string): ResolvedVoice {
  const raw = db.getVoiceConfig(userId)
  const config = getTeamConfig(db)
  // Team mode: the overlay is authoritative for the shared provider fields
  // (unset → empty, raw is never a fallback); ttsVoice/language stay per-user.
  const overlay = config.mode === "team" ? (config.providers.voice ?? {}) : null
  const merged: VoiceConfig = overlay
    ? {
        ...raw,
        sttProvider: overlay.sttProvider ?? "",
        sttAccountId: overlay.sttAccountId ?? "",
        sttApiKey: overlay.sttApiKey ?? "",
        sttModel: overlay.sttModel ?? "",
        ttsProvider: overlay.ttsProvider ?? "",
        ttsAccountId: overlay.ttsAccountId ?? "",
        ttsApiKey: overlay.ttsApiKey ?? "",
        ttsModel: overlay.ttsModel ?? "",
      }
    : raw
  const sttVault = effectiveUserKey(
    db,
    userId,
    voiceVaultSlug(merged.sttProvider),
  )
  const ttsVault = effectiveUserKey(
    db,
    userId,
    voiceVaultSlug(merged.ttsProvider),
  )
  const source = (key: string, vault: { apiKey: string } | null) =>
    key ? "setup" : vault?.apiKey ? "vault" : "missing"
  return {
    value: {
      ...merged,
      sttApiKey: merged.sttApiKey || sttVault?.apiKey || "",
      sttAccountId: merged.sttAccountId || sttVault?.accountId || "",
      ttsApiKey: merged.ttsApiKey || ttsVault?.apiKey || "",
      ttsAccountId: merged.ttsAccountId || ttsVault?.accountId || "",
    },
    sttSource: merged.sttProvider
      ? source(merged.sttApiKey, sttVault)
      : "missing",
    ttsSource: merged.ttsProvider
      ? source(merged.ttsApiKey, ttsVault)
      : "missing",
  }
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
    if (
      spec.account?.required &&
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

// Turn provider failures into something the Config page can act on.
async function providerError(
  response: Response,
  label: string,
  kind: "stt" | "tts",
): Promise<string> {
  const detail = (await response.text().catch(() => "")).slice(0, 200)
  if (response.status === 401 || response.status === 403) {
    return `${label} rejected the ${kind === "stt" ? "speech-to-text" : "text-to-speech"} API key (${response.status})`
  }
  return `${label} failed (${response.status})${detail ? `: ${detail}` : ""}`
}

// Label the two failure modes an HTTP status cannot describe: the request
// never left (network) or never got an answer (timeout).
async function providerFetch(
  fetchImpl: FetchImpl,
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(
        `${label} did not answer within ${Math.round(timeoutMs / 1000)}s`,
      )
    }
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `: ${error.cause.message}`
        : ""
    throw new Error(`could not reach ${label}${cause}`)
  }
}

// Parse a provider's JSON body, naming the provider when the body is not JSON
// (a proxy or captive portal answering with HTML would surface a bare
// SyntaxError otherwise).
async function providerJson<T>(response: Response, label: string): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(`${label} returned a malformed response`)
  }
}

// The Workers AI REST API can answer HTTP 200 with a rejected-request
// envelope — treat it as the error it is instead of "no transcription".
function cloudflareEnvelopeError(body: {
  success?: unknown
  errors?: unknown
}): string | null {
  const messages = (Array.isArray(body.errors) ? body.errors : [])
    .map((item) => {
      if (typeof item === "string") return item.trim()
      if (item && typeof item === "object") {
        const message = (item as { message?: unknown }).message
        if (typeof message === "string") return message.trim()
      }
      return ""
    })
    .filter((text) => text !== "")
  if (body.success === false || messages.length > 0) {
    return messages.length > 0
      ? messages.join("; ")
      : "the request was rejected"
  }
  return null
}

// Workers AI models are path segments like "@cf/openai/whisper": keep the
// slashes, encode the rest.
function modelPath(model: string): string {
  return model.split("/").map(encodeURIComponent).join("/")
}
export type FetchImpl = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export type SttInput = {
  providerId: string
  apiKey: string
  accountId: string
  model: string
  language: string
  audio: Uint8Array
  mime: string
  fetchImpl?: FetchImpl
}

export async function runStt(input: SttInput): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  if (input.providerId === "workers-ai-stt") {
    const model =
      !input.model || input.model === LEGACY_WORKERS_AI_STT_MODEL
        ? WORKERS_AI_STT_DEFAULT_MODEL
        : input.model
    const payload: Record<string, unknown> = {
      // The whisper REST schema wants raw bytes as a JSON number array,
      // not a base64 string.
      audio: Array.from(input.audio),
    }
    const language = languageCode(input.language)
    if (WORKERS_AI_STT_EXTRAS_MODELS.has(model)) {
      if (language) payload.language = language
      payload.vad_filter = true
    }
    const response = await providerFetch(
      fetchImpl,
      "Cloudflare Workers AI",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/run/${modelPath(model)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      60_000,
    )
    if (!response.ok)
      throw new Error(
        await providerError(response, "Cloudflare Workers AI", "stt"),
      )
    const body = await providerJson<{
      result?: { text?: unknown; transcription_info?: { text?: unknown } }
      errors?: unknown
      success?: unknown
    }>(response, "Cloudflare Workers AI")
    const envelope = cloudflareEnvelopeError(body)
    if (envelope) throw new Error(`Cloudflare Workers AI failed: ${envelope}`)
    const text = body.result?.text ?? body.result?.transcription_info?.text
    if (text === undefined)
      throw new Error("Cloudflare Workers AI returned no transcription")
    return typeof text === "string" ? text.trim() : ""
  }
  if (input.providerId === "deepgram-stt") {
    const model = input.model || DEEPGRAM_STT_DEFAULT_MODEL
    const payload: Record<string, unknown> = {
      audio: Array.from(input.audio),
      smart_format: true,
      punctuate: true,
    }
    const language = languageCode(input.language)
    if (language) payload.language = language
    const response = await providerFetch(
      fetchImpl,
      "Cloudflare Workers AI",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/run/${modelPath(model)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      60_000,
    )
    if (!response.ok)
      throw new Error(
        await providerError(response, "Cloudflare Workers AI", "stt"),
      )
    const body = await providerJson<{
      result?: {
        results?: {
          channels?: {
            alternatives?: { transcript?: unknown }[]
          }[]
        }
      }
      errors?: unknown
      success?: unknown
    }>(response, "Cloudflare Workers AI")
    const envelope = cloudflareEnvelopeError(body)
    if (envelope) throw new Error(`Cloudflare Workers AI failed: ${envelope}`)
    const transcript =
      body.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    if (transcript === undefined)
      throw new Error("Cloudflare Workers AI returned no transcription")
    return typeof transcript === "string" ? transcript.trim() : ""
  }
  const endpoints: Record<string, string> = {
    "openai-stt": "https://api.openai.com/v1/audio/transcriptions",
    "groq-stt": "https://api.groq.com/openai/v1/audio/transcriptions",
  }
  const endpoint = endpoints[input.providerId]
  if (!endpoint) throw new Error("unsupported speech provider")
  const label =
    voiceProviderById(input.providerId)?.label ?? "the speech provider"
  const form = new FormData()
  const bytes = new Uint8Array(input.audio)
  form.append(
    "file",
    new Blob([bytes.buffer as ArrayBuffer], {
      type: input.mime || "audio/webm",
    }),
    "audio.webm",
  )
  form.append("model", input.model)
  const language = languageCode(input.language)
  if (language) form.append("language", language)
  const response = await providerFetch(
    fetchImpl,
    label,
    endpoint,
    {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}` },
      body: form,
    },
    60_000,
  )
  if (!response.ok) {
    throw new Error(await providerError(response, label, "stt"))
  }
  const body = await providerJson<{ text?: unknown }>(response, label)
  if (body.text === undefined)
    throw new Error(`${label} returned no transcription`)
  return typeof body.text === "string" ? body.text.trim() : ""
}

export type TtsInput = {
  providerId: string
  apiKey: string
  accountId: string
  model: string
  voice: string
  language: string
  text: string
  fetchImpl?: FetchImpl
}

export type TtsAudio = { bytes: Uint8Array; mime: string }

export async function runTts(input: TtsInput): Promise<TtsAudio> {
  const fetchImpl = input.fetchImpl ?? fetch
  const text = input.text.slice(0, TTS_MAX_CHARS)
  if (text.trim() === "") throw new Error("text is required")
  if (input.providerId === "openai-tts") {
    const response = await providerFetch(
      fetchImpl,
      "OpenAI",
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model || "gpt-4o-mini-tts",
          input: text,
          voice: input.voice || "alloy",
          response_format: "mp3",
        }),
      },
      120_000,
    )
    if (!response.ok)
      throw new Error(await providerError(response, "OpenAI", "tts"))
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: "audio/mpeg",
    }
  }
  if (input.providerId === "xai-tts") {
    const language = languageCode(input.language) || "en"
    const response = await providerFetch(
      fetchImpl,
      "xAI",
      "https://api.x.ai/v1/tts",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice_id: input.voice || "eve",
          language,
        }),
      },
      120_000,
    )
    if (!response.ok)
      throw new Error(await providerError(response, "xAI", "tts"))
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("content-type")?.split(";")[0] || "audio/wav",
    }
  }
  if (input.providerId === "workers-ai-tts") {
    const response = await providerFetch(
      fetchImpl,
      "Cloudflare Workers AI",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/run/${modelPath(input.model || "@cf/myshell-ai/melotts")}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: text,
          lang: languageCode(input.language) || "en",
        }),
      },
      120_000,
    )
    if (!response.ok)
      throw new Error(
        await providerError(response, "Cloudflare Workers AI", "tts"),
      )
    const body = await providerJson<{
      result?: { audio?: unknown }
      errors?: unknown
      success?: unknown
    }>(response, "Cloudflare Workers AI")
    const envelope = cloudflareEnvelopeError(body)
    if (envelope) throw new Error(`Cloudflare Workers AI failed: ${envelope}`)
    const audio =
      typeof body.result?.audio === "string" ? body.result.audio : ""
    if (!audio) throw new Error("Cloudflare Workers AI returned no audio")
    return {
      bytes: new Uint8Array(Buffer.from(audio, "base64")),
      mime: "audio/mp3",
    }
  }
  throw new Error("unsupported speech provider")
}
