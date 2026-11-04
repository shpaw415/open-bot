import type { Db, VoiceConfig } from "@open-bot/db"
import { effectiveUserKey, getTeamConfig, objectHasAnyField } from "./team"
import {
  AURA_TTS_MODEL,
  canonicalVoiceProviderId,
  DEEPGRAM_STT_MODEL,
  defaultVoiceFor,
  languageCode,
  normalizeVoiceModel,
  type SttConfig,
  TTS_MAX_CHARS,
  type TtsConfig,
  type VoiceKind,
  voiceModelSpec,
  voiceProviderForKind,
  voiceVaultSlug,
} from "./voice-catalog"

export * from "./voice-catalog"

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
// per-user, which is why a team-mode partial PUT carries only those. The
// provider must belong to the side it is saved on, and an explicitly sent
// model must be one that provider offers.
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
    const spec = rawProvider
      ? voiceProviderForKind(rawProvider, side)
      : undefined
    if (rawProvider && !spec) {
      return { next: current, error: "unsupported speech provider" }
    }
    const sameProvider =
      canonicalVoiceProviderId(savedProvider) === (spec?.id ?? "")
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
    if (raw.model === undefined) {
      next[`${side}Model`] = spec
        ? normalizeVoiceModel(spec, sameProvider ? savedModel : "")
        : ""
    } else {
      const wanted = String(raw.model ?? "").trim()
      if (spec && wanted) {
        if (spec.models.length === 0) {
          return {
            next: current,
            error: `${spec.label} does not take a model`,
          }
        }
        if (!voiceModelSpec(spec, normalizeVoiceModel(spec, wanted))) {
          return {
            next: current,
            error: `unsupported model for ${spec.label}: ${wanted}`,
          }
        }
      }
      next[`${side}Model`] = spec ? normalizeVoiceModel(spec, wanted) : ""
    }
    if (side === "tts") {
      next.ttsVoice =
        raw.voice === undefined
          ? current.ttsVoice
          : String(raw.voice ?? "").trim() ||
            (spec ? defaultVoiceFor(spec, next.ttsModel) : "")
    }
  }
  next.language =
    body.language === undefined
      ? current.language
      : String(body.language ?? "").trim()
  return { next, error: null }
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
  // Saved rows and team overlays can still carry the pre-consolidation
  // Cloudflare ids; everything downstream sees the canonical ones.
  merged.sttProvider = canonicalVoiceProviderId(merged.sttProvider)
  merged.ttsProvider = canonicalVoiceProviderId(merged.ttsProvider)
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

// Turn provider failures into something the Config page can act on.
async function providerError(
  response: Response,
  label: string,
  kind: VoiceKind,
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

function cloudflareRunUrl(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath(model)}`
}

export type FetchImpl = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export type SttInput = {
  config: SttConfig
  language: string
  audio: Uint8Array
  mime: string
  fetchImpl?: FetchImpl
}

async function cloudflareStt(
  config: Extract<SttConfig, { provider: "cloudflare-stt" }>,
  input: SttInput,
  fetchImpl: FetchImpl,
): Promise<string> {
  const language = languageCode(input.language)
  const deepgram = config.model === DEEPGRAM_STT_MODEL
  // The whisper REST schema wants raw bytes as a JSON number array, not a
  // base64 string; nova-3 takes the same array plus formatting flags.
  const payload: Record<string, unknown> = { audio: Array.from(input.audio) }
  if (deepgram) {
    payload.smart_format = true
    payload.punctuate = true
  } else {
    payload.vad_filter = true
  }
  if (language) payload.language = language
  const response = await providerFetch(
    fetchImpl,
    "Cloudflare Workers AI",
    cloudflareRunUrl(config.accountId, config.model),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
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
      text?: unknown
      transcription_info?: { text?: unknown }
      results?: {
        channels?: { alternatives?: { transcript?: unknown }[] }[]
      }
    }
    errors?: unknown
    success?: unknown
  }>(response, "Cloudflare Workers AI")
  const envelope = cloudflareEnvelopeError(body)
  if (envelope) throw new Error(`Cloudflare Workers AI failed: ${envelope}`)
  const text = deepgram
    ? body.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    : (body.result?.text ?? body.result?.transcription_info?.text)
  if (text === undefined)
    throw new Error("Cloudflare Workers AI returned no transcription")
  return typeof text === "string" ? text.trim() : ""
}

// OpenAI, Groq and xAI all take multipart transcription posts; xAI is the
// odd one out: its `file` part must come after every other parameter.
async function multipartStt(
  input: SttInput,
  fetchImpl: FetchImpl,
  target: { url: string; label: string; apiKey: string; model: string },
  fileLast: boolean,
): Promise<string> {
  const form = new FormData()
  const bytes = new Uint8Array(input.audio)
  const file = () =>
    form.append(
      "file",
      new Blob([bytes.buffer as ArrayBuffer], {
        type: input.mime || "audio/webm",
      }),
      "audio.webm",
    )
  const params = () => {
    form.append("model", target.model)
    const language = languageCode(input.language)
    if (language) form.append("language", language)
  }
  if (fileLast) {
    params()
    file()
  } else {
    file()
    params()
  }
  const response = await providerFetch(
    fetchImpl,
    target.label,
    target.url,
    {
      method: "POST",
      headers: { authorization: `Bearer ${target.apiKey}` },
      body: form,
    },
    60_000,
  )
  if (!response.ok) {
    throw new Error(await providerError(response, target.label, "stt"))
  }
  const body = await providerJson<{ text?: unknown }>(response, target.label)
  if (body.text === undefined)
    throw new Error(`${target.label} returned no transcription`)
  return typeof body.text === "string" ? body.text.trim() : ""
}

export async function runStt(input: SttInput): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  const config = input.config
  switch (config.provider) {
    case "cloudflare-stt":
      return cloudflareStt(config, input, fetchImpl)
    case "openai-stt":
      return multipartStt(
        input,
        fetchImpl,
        {
          url: "https://api.openai.com/v1/audio/transcriptions",
          label: "OpenAI (Whisper)",
          apiKey: config.apiKey,
          model: config.model,
        },
        false,
      )
    case "groq-stt":
      return multipartStt(
        input,
        fetchImpl,
        {
          url: "https://api.groq.com/openai/v1/audio/transcriptions",
          label: "Groq (Whisper)",
          apiKey: config.apiKey,
          model: config.model,
        },
        false,
      )
    case "xai-stt":
      return multipartStt(
        input,
        fetchImpl,
        {
          url: "https://api.x.ai/v1/stt",
          label: "xAI (Grok Voice Transcribe)",
          apiKey: config.apiKey,
          model: config.model,
        },
        true,
      )
    default: {
      const exhaustive: never = config
      throw new Error(`unsupported speech provider: ${String(exhaustive)}`)
    }
  }
}

export type TtsInput = {
  config: TtsConfig
  language: string
  text: string
  fetchImpl?: FetchImpl
}

export type TtsAudio = { bytes: Uint8Array; mime: string }

async function cloudflareTts(
  config: Extract<TtsConfig, { provider: "cloudflare-tts" }>,
  input: TtsInput,
  fetchImpl: FetchImpl,
  text: string,
): Promise<TtsAudio> {
  const aura = config.model === AURA_TTS_MODEL
  const response = await providerFetch(
    fetchImpl,
    "Cloudflare Workers AI",
    cloudflareRunUrl(config.accountId, config.model),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        aura
          ? { text, speaker: config.voice || "angus", encoding: "mp3" }
          : { prompt: text, lang: languageCode(input.language) || "en" },
      ),
    },
    120_000,
  )
  if (!response.ok)
    throw new Error(
      await providerError(response, "Cloudflare Workers AI", "tts"),
    )
  if (aura) {
    // Aura streams raw audio back; a JSON body here is the error envelope.
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("json")) {
      const body = await providerJson<{
        errors?: unknown
        success?: unknown
      }>(response, "Cloudflare Workers AI")
      const envelope = cloudflareEnvelopeError(body)
      throw new Error(
        `Cloudflare Workers AI failed: ${envelope ?? "no audio returned"}`,
      )
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: contentType.split(";")[0] || "audio/mpeg",
    }
  }
  const body = await providerJson<{
    result?: { audio?: unknown }
    errors?: unknown
    success?: unknown
  }>(response, "Cloudflare Workers AI")
  const envelope = cloudflareEnvelopeError(body)
  if (envelope) throw new Error(`Cloudflare Workers AI failed: ${envelope}`)
  const audio = typeof body.result?.audio === "string" ? body.result.audio : ""
  if (!audio) throw new Error("Cloudflare Workers AI returned no audio")
  return {
    bytes: new Uint8Array(Buffer.from(audio, "base64")),
    mime: "audio/mp3",
  }
}

export async function runTts(input: TtsInput): Promise<TtsAudio> {
  const fetchImpl = input.fetchImpl ?? fetch
  const text = input.text.slice(0, TTS_MAX_CHARS)
  if (text.trim() === "") throw new Error("text is required")
  const config = input.config
  switch (config.provider) {
    case "openai-tts": {
      const response = await providerFetch(
        fetchImpl,
        "OpenAI",
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            input: text,
            voice: config.voice || "alloy",
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
    case "xai-tts": {
      const response = await providerFetch(
        fetchImpl,
        "xAI",
        "https://api.x.ai/v1/tts",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text,
            voice_id: config.voice || "eve",
            language: languageCode(input.language) || "en",
          }),
        },
        120_000,
      )
      if (!response.ok)
        throw new Error(await providerError(response, "xAI", "tts"))
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mime:
          response.headers.get("content-type")?.split(";")[0] || "audio/wav",
      }
    }
    case "cloudflare-tts":
      return cloudflareTts(config, input, fetchImpl, text)
    default: {
      const exhaustive: never = config
      throw new Error(`unsupported speech provider: ${String(exhaustive)}`)
    }
  }
}
