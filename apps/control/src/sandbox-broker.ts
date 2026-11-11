import {
  type AiApi,
  type AiModel,
  createOpenAiCompatibleApi,
} from "@open-bot/ai"
import type { Db, SandboxThreadRow } from "@open-bot/db"
import { parseSandboxModelRef, sandboxProfileFromJson } from "./sandbox"
import { effectiveUserKey } from "./team"

// Keyless provider brokering for sandbox threads (spec phase 3a): when a
// sandbox profile names "<provider>/<model>", the control plane calls
// that provider itself with the user's vault key and streams the reply
// through the /llm broker. The key never enters the container — the
// sandbox still holds only its broker token. OpenAI-compatible chat
// providers only; OAuth/CLI-bridge providers stay unavailable.

const BROKER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
}

export const SANDBOX_BROKER_PROVIDERS = Object.keys(BROKER_BASE_URLS)

export type BrokeredModel = {
  providerId: string
  modelId: string
  baseURL: string
  apiKey: string
}

/** Resolve a brokered ref against the user's vault. The vault row's
 * baseUrl (when set, e.g. OpenRouter custom endpoint) wins over the
 * provider default. */
export function resolveBrokeredModel(
  db: Db,
  userId: string,
  providerId: string,
  modelId: string,
): { brokered: BrokeredModel } | { error: string } {
  const fallback = BROKER_BASE_URLS[providerId]
  if (!fallback)
    return {
      error: `provider "${providerId}" cannot be brokered into a sandbox (supported: ${SANDBOX_BROKER_PROVIDERS.join(", ")})`,
    }
  const key = effectiveUserKey(db, userId, providerId)
  if (!key?.apiKey)
    return {
      error: `no API key for provider "${providerId}" — add one in Config → Keys, or pick the instance chat/small model`,
    }
  return {
    brokered: {
      providerId,
      modelId,
      baseURL: key.baseUrl?.trim() || fallback,
      apiKey: key.apiKey,
    },
  }
}

/** Validate a launch-time model ref: instance refs always pass; brokered
 * refs must resolve to a vault key right now (fail at launch, not on the
 * first turn). Returns the canonical ref string to snapshot. */
export function validateSandboxModel(
  db: Db,
  userId: string,
  ref: string | undefined,
): { model: string } | { error: string } {
  const parsed = parseSandboxModelRef(ref)
  if (!parsed)
    return { error: 'model must be "chat", "small", or "<provider>/<model>"' }
  if (parsed.kind === "instance") return { model: parsed.id }
  const resolved = resolveBrokeredModel(
    db,
    userId,
    parsed.providerId,
    parsed.modelId,
  )
  if ("error" in resolved) return resolved
  return { model: `${parsed.providerId}/${parsed.modelId}` }
}

/**
 * The broker call for one sandbox row, or null when the sandbox runs on
 * the instance models. A brokered sandbox routes every chat completion
 * (main agent and the small title agent alike) to its provider model.
 */
export function sandboxBrokerCall(
  db: Db,
  row: SandboxThreadRow,
): { api: AiApi; model: AiModel } | { error: string } | null {
  const profile = sandboxProfileFromJson(row.profile)
  const parsed = parseSandboxModelRef(profile.model)
  if (!parsed || parsed.kind === "instance") return null
  const resolved = resolveBrokeredModel(
    db,
    row.userId,
    parsed.providerId,
    parsed.modelId,
  )
  if ("error" in resolved) return resolved
  const { brokered } = resolved
  return {
    api: createOpenAiCompatibleApi({
      type: "openai-compatible",
      baseURL: brokered.baseURL,
      apiKey: brokered.apiKey,
    }),
    model: {
      id: brokered.modelId,
      name: `${brokered.providerId}/${brokered.modelId}`,
      context: 128000,
      output: 16000,
    },
  }
}
