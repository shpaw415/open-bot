import type { Db, Desktop } from "@open-bot/db"
import { endpoint } from "./docker"

export type VariantsByModel = Map<string, string[]>

// Prompt-time lookups reuse a short-lived cache so chat messages never pay an
// extra /provider round-trip. Saves clear it to re-validate immediately.
const VARIANTS_TTL_MS = 5 * 60 * 1000
const variantsCache = new Map<string, { at: number; map: VariantsByModel }>()

export function clearModelVariants(userId: string) {
  variantsCache.delete(userId)
}

export function basicOpencodeAuth(password: string) {
  return {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  }
}

/** Variant ids per connected model, keyed "providerID/modelID". Cache-first. */
export async function fetchModelVariants(
  userId: string,
  desktop: Desktop,
): Promise<VariantsByModel> {
  const cached = variantsCache.get(userId)
  if (cached && Date.now() - cached.at < VARIANTS_TTL_MS) return cached.map
  const base = await endpoint(userId, "opencode", 4096)
  const response = await fetch(`${base}/provider`, {
    headers: basicOpencodeAuth(desktop.opencodePassword),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`provider list failed (${response.status})`)
  const body = (await response.json()) as {
    all?: {
      id?: string
      models?: Record<string, { variants?: unknown } | undefined>
    }[]
  }
  const map: VariantsByModel = new Map()
  for (const provider of body.all ?? []) {
    if (!provider.id) continue
    for (const [modelID, info] of Object.entries(provider.models ?? {})) {
      const variants =
        info?.variants && typeof info.variants === "object"
          ? Object.keys(info.variants).filter(
              (key): key is string => typeof key === "string" && key !== "",
            )
          : []
      map.set(`${provider.id}/${modelID}`, variants)
    }
  }
  variantsCache.set(userId, { at: Date.now(), map })
  return map
}

/** True when the effort is a known variant of that model. */
export function supportsEffort(
  map: VariantsByModel,
  providerID: string,
  modelID: string,
  effort: string,
) {
  return map.get(`${providerID}/${modelID}`)?.includes(effort) ?? false
}

function bodyModel(
  body: Record<string, unknown>,
): { providerID: string; modelID: string } | null {
  const model = body.model
  if (!model || typeof model !== "object" || Array.isArray(model)) return null
  const record = model as Record<string, unknown>
  const providerID = record.providerID
  const modelID = record.modelID
  if (typeof providerID !== "string" || typeof modelID !== "string") return null
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

/**
 * Stamps the desktop's saved thinking effort onto an opencode prompt body as
 * `variant`, but only when that variant exists for the turn's model (the body
 * model, else the desktop default). Never throws and never wakes a desktop:
 * an unresolvable effort just means the prompt goes out without one.
 */
export async function applyThinkingEffort(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const desktop = db.desktop(userId)
    const effort = desktop?.thinkingEffort
    if (!desktop || !effort) return
    const model =
      bodyModel(body) ??
      (desktop.selectedProvider && desktop.selectedModel
        ? {
            providerID: desktop.selectedProvider,
            modelID: desktop.selectedModel,
          }
        : null)
    if (!model) return
    const map = await fetchModelVariants(userId, desktop)
    if (!supportsEffort(map, model.providerID, model.modelID, effort)) return
    body.variant = effort
  } catch {
    // Desktop down or provider list unavailable — send the prompt as-is.
  }
}
