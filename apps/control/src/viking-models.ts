import type { VikingProvider } from "@open-bot/db"
import {
  embedSupportsCustomVlm,
  vikingEmbedLabel,
} from "./viking-embedding-catalog"

// Maps a model connected in the desktop's OpenCode onto an OpenViking VLM
// backend. OpenViking speaks its own provider names (registry: volcengine,
// openai, azure, kimi, glm, litellm, openai-codex) — this module is the
// single place that knows which OpenCode providers can feed it, how the
// model string is formed, and where the credential comes from. Pure: the
// caller supplies the desktop's OpenCode auth entries and a vault lookup.

export type OpencodeAuthEntry = {
  type?: string
  key?: string
  access?: string
  refresh?: string
  accountId?: string
}

export type VikingVlmBackend = "openai-codex" | "openai" | "glm" | "litellm"

type VlmMapping = {
  backend: VikingVlmBackend
  // LiteLLM route prefix; model = `${prefix}/${modelId}` (litellm kind only).
  litellmPrefix?: string
  apiBase?: string
  // Keys-tab vault slug used when the desktop auth has no usable entry.
  vaultSlug?: string
  // OAuth access tokens are usable as the bearer credential (xAI). OpenAI
  // OAuth goes through the codex backend instead; other providers' OAuth
  // (Anthropic subscription etc.) is not an API credential and is rejected.
  oauthAccess?: boolean
}

const LITELLM = (prefix: string, extra?: Partial<VlmMapping>): VlmMapping => ({
  backend: "litellm",
  litellmPrefix: prefix,
  ...extra,
})

export const OPENCODE_VLM_PROVIDERS: Record<string, VlmMapping> = {
  // Resolved dynamically: OAuth entry → Codex subscription backend,
  // API-key entry → plain OpenAI API. The static entry here only marks the
  // provider as supported and names the vault fallback.
  openai: { backend: "openai", vaultSlug: "openai" },
  xai: LITELLM("xai", { vaultSlug: "xai", oauthAccess: true }),
  "zai-coding-plan": { backend: "glm" },
  zai: { backend: "glm", apiBase: "https://api.z.ai/api/paas/v4" },
  zhipuai: { backend: "glm", apiBase: "https://api.z.ai/api/paas/v4" },
  anthropic: LITELLM("anthropic", { vaultSlug: "anthropic" }),
  google: LITELLM("gemini", { vaultSlug: "google" }),
  openrouter: LITELLM("openrouter", { vaultSlug: "openrouter" }),
  deepseek: LITELLM("deepseek"),
  groq: LITELLM("groq"),
  mistral: LITELLM("mistral"),
  moonshot: LITELLM("moonshot"),
  kimi: LITELLM("moonshot"),
  togetherai: LITELLM("together_ai"),
}

export function supportedVlmProviderIds(): string[] {
  return Object.keys(OPENCODE_VLM_PROVIDERS).sort()
}

export type ResolvedVikingVlm =
  | { backend: "openai-codex"; model: string }
  | {
      backend: "openai" | "glm" | "litellm"
      model: string
      apiKey: string
      apiBase?: string
    }

export type VlmResolution = { vlm: ResolvedVikingVlm } | { error: string }

function authEntry(
  auth: Record<string, OpencodeAuthEntry> | null,
  providerId: string,
): OpencodeAuthEntry | null {
  const entry = auth?.[providerId]
  return entry && typeof entry === "object" ? entry : null
}

// Resolve the OpenViking VLM backend for a saved Viking provider. Custom
// source passes the stored endpoint through untouched. OpenCode source
// maps the provider, then takes the credential from the desktop's OpenCode
// auth first (that is what "connected" means), falling back to the stored
// vault key for API-key providers.
export function resolveVikingVlm(
  viking: VikingProvider,
  auth: Record<string, OpencodeAuthEntry> | null,
  vaultKey: (slug: string) => string,
): VlmResolution {
  if (viking.vlmSource !== "opencode") {
    // Only OpenAI-compatible embedding endpoints can double as the VLM
    // endpoint; a native embedder (Voyage, Cohere, …) serves embeddings
    // only, so the VLM must come from OpenCode instead.
    if (!embedSupportsCustomVlm(viking.embedProvider)) {
      return {
        error: `OpenViking cannot use the ${vikingEmbedLabel(viking.embedProvider)} embedding endpoint as a VLM — switch the embedding provider or source the VLM from an OpenCode model in Config → OpenViking`,
      }
    }
    const customBase =
      viking.embedProvider === "openai" && !viking.baseURL.trim()
        ? "https://api.openai.com/v1"
        : viking.baseURL.trim()
    return {
      vlm: {
        backend: "openai",
        model: viking.vlmModel,
        apiKey: viking.apiKey,
        apiBase: customBase,
      },
    }
  }
  const providerId = viking.vlmProvider.trim()
  const modelId = viking.vlmModel.trim()
  const mapping = OPENCODE_VLM_PROVIDERS[providerId]
  if (!mapping || !modelId) {
    return {
      error: `OpenViking cannot use the OpenCode provider "${providerId || "(none)"}" for its VLM — pick a supported provider or the custom endpoint in Config → OpenViking`,
    }
  }
  const entry = authEntry(auth, providerId)

  if (providerId === "openai") {
    if (entry?.type === "oauth" && entry.refresh) {
      return { vlm: { backend: "openai-codex", model: modelId } }
    }
    const apiKey =
      (entry?.type === "api" ? entry.key?.trim() : "") ||
      vaultKey("openai").trim()
    if (!apiKey) {
      return {
        error:
          "OpenViking VLM: no OpenAI credential found — connect OpenAI (subscription or API key) in Config → Providers, or store an OpenAI key in Keys",
      }
    }
    return {
      vlm: {
        backend: "openai",
        model: modelId,
        apiKey,
        apiBase: "https://api.openai.com/v1",
      },
    }
  }

  let apiKey = ""
  if (entry?.type === "api") apiKey = entry.key?.trim() ?? ""
  else if (entry?.type === "oauth") {
    if (!mapping.oauthAccess) {
      return {
        error: `OpenViking VLM: the ${providerId} subscription login in OpenCode is not an API credential OpenViking can call — connect an API key for ${providerId} or pick another provider`,
      }
    }
    apiKey = entry.access?.trim() ?? ""
  }
  if (!apiKey && mapping.vaultSlug) apiKey = vaultKey(mapping.vaultSlug).trim()
  if (!apiKey) {
    return {
      error: `OpenViking VLM: no credential found for the OpenCode provider "${providerId}" — connect it in Config → Providers${mapping.vaultSlug ? ` or store a ${mapping.vaultSlug} key in Keys` : ""}`,
    }
  }
  const model =
    mapping.backend === "litellm" && mapping.litellmPrefix
      ? `${mapping.litellmPrefix}/${modelId}`
      : modelId
  return {
    vlm: {
      backend: mapping.backend,
      model,
      apiKey,
      ...(mapping.apiBase ? { apiBase: mapping.apiBase } : {}),
    },
  }
}

// Convert OpenCode's openai OAuth entry into the Muse auth-file shape
// OpenViking's external bootstrap reads ({tokens:{access_token,
// refresh_token}}). Null when the entry is missing or not OAuth. OpenCode
// stays the refresh owner: OpenViking re-reads this file whenever its
// tokens change and only refreshes itself once the file disappears.
export function codexBootstrapFromOpencodeAuth(
  auth: Record<string, OpencodeAuthEntry> | null,
): string | null {
  const entry = authEntry(auth, "openai")
  if (entry?.type !== "oauth") return null
  const access = entry.access?.trim() ?? ""
  const refresh = entry.refresh?.trim() ?? ""
  if (!access || !refresh) return null
  return JSON.stringify(
    {
      auth_mode: "chatgpt",
      tokens: {
        access_token: access,
        refresh_token: refresh,
        ...(entry.accountId ? { account_id: entry.accountId } : {}),
      },
    },
    null,
    2,
  )
}
