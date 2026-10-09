import type { Db, VoiceConfig } from "@open-bot/db"

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
    defaultModel: "@cf/openai/whisper",
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
  const sttVault = db.getUserKey(userId, voiceVaultSlug(raw.sttProvider))
  const ttsVault = db.getUserKey(userId, voiceVaultSlug(raw.ttsProvider))
  const source = (key: string, vault: { apiKey: string } | null) =>
    key ? "setup" : vault?.apiKey ? "vault" : "missing"
  return {
    value: {
      ...raw,
      sttApiKey: raw.sttApiKey || sttVault?.apiKey || "",
      sttAccountId: raw.sttAccountId || sttVault?.accountId || "",
      ttsApiKey: raw.ttsApiKey || ttsVault?.apiKey || "",
      ttsAccountId: raw.ttsAccountId || ttsVault?.accountId || "",
    },
    sttSource: raw.sttProvider ? source(raw.sttApiKey, sttVault) : "missing",
    ttsSource: raw.ttsProvider ? source(raw.ttsApiKey, ttsVault) : "missing",
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
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/run/${modelPath(input.model)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // The whisper REST schema wants raw bytes as a JSON number array,
          // not a base64 string.
          audio: Array.from(input.audio),
        }),
        signal: AbortSignal.timeout(60_000),
      },
    )
    if (!response.ok)
      throw new Error(
        await providerError(response, "Cloudflare Workers AI", "stt"),
      )
    const body = (await response.json()) as {
      result?: { text?: unknown }
      errors?: unknown
    }
    return typeof body.result?.text === "string" ? body.result.text.trim() : ""
  }
  const endpoints: Record<string, string> = {
    "openai-stt": "https://api.openai.com/v1/audio/transcriptions",
    "groq-stt": "https://api.groq.com/openai/v1/audio/transcriptions",
  }
  const endpoint = endpoints[input.providerId]
  if (!endpoint) throw new Error("unsupported speech provider")
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
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(
      await providerError(
        response,
        voiceProviderById(input.providerId)?.label ?? "the speech provider",
        "stt",
      ),
    )
  }
  const body = (await response.json()) as { text?: unknown }
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
    const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
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
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(
        await providerError(
          response,
          voiceProviderById(input.providerId)?.label ?? "the speech provider",
          "tts",
        ),
      )
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: "audio/mpeg",
    }
  }
  if (input.providerId === "xai-tts") {
    const language = languageCode(input.language) || "en"
    const response = await fetchImpl("https://api.x.ai/v1/tts", {
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
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(
        await providerError(
          response,
          voiceProviderById(input.providerId)?.label ?? "the speech provider",
          "tts",
        ),
      )
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("content-type")?.split(";")[0] || "audio/wav",
    }
  }
  if (input.providerId === "workers-ai-tts") {
    const response = await fetchImpl(
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
        signal: AbortSignal.timeout(120_000),
      },
    )
    if (!response.ok)
      throw new Error(
        await providerError(
          response,
          voiceProviderById(input.providerId)?.label ?? "the speech provider",
          "tts",
        ),
      )
    const body = (await response.json()) as {
      result?: { audio?: unknown }
    }
    const audio =
      typeof body.result?.audio === "string" ? body.result.audio : ""
    if (!audio) throw new Error("tts provider returned no audio")
    return {
      bytes: new Uint8Array(Buffer.from(audio, "base64")),
      mime: "audio/mp3",
    }
  }
  throw new Error("unsupported speech provider")
}
