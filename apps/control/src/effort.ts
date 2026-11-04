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
    connected?: unknown
  }
  // Models of providers that are not connected cannot run a prompt, so they
  // are neither effort-stampable nor valid explicit picks. A missing/empty
  // connected list (older opencode) keeps every provider, as before.
  const connected = Array.isArray(body.connected)
    ? new Set(
        body.connected.filter(
          (id): id is string => typeof id === "string" && id !== "",
        ),
      )
    : null
  const map: VariantsByModel = new Map()
  for (const provider of body.all ?? []) {
    if (!provider.id) continue
    if (connected && connected.size > 0 && !connected.has(provider.id)) continue
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
/** One thread's explicit model + reasoning-effort pick (either half may be
 * null = desktop default). Made per council member at `ob-thread start`. */
export type ThreadModelChoice = {
  providerID: string | null
  modelID: string | null
  effort: string | null
}

/**
 * Checks an explicit pick against the desktop's connected models. Returns an
 * agent-facing error string, or null when the pick is usable. An unreadable
 * provider list is not an error — the pick goes out unvalidated rather than
 * blocking thread creation on a booting desktop (same fail-open rule as
 * applyThinkingEffort); a provably unknown model or effort level is refused
 * so the caller can fix the flag instead of watching a dead first prompt.
 */
export async function validateModelChoice(
  db: Db,
  userId: string,
  choice: ThreadModelChoice | null,
): Promise<string | null> {
  if (!choice || (!choice.providerID && !choice.effort)) return null
  const desktop = db.desktop(userId)
  if (!desktop) return null
  let map: VariantsByModel
  try {
    map = await fetchModelVariants(userId, desktop)
  } catch {
    return null
  }
  if (map.size === 0) return null
  const picked =
    choice.providerID && choice.modelID
      ? { providerID: choice.providerID, modelID: choice.modelID }
      : null
  if (picked && !map.has(`${picked.providerID}/${picked.modelID}`))
    return `unknown model "${picked.providerID}/${picked.modelID}" — run \`ob-thread models\` to list connected models`
  if (choice.effort) {
    const effective =
      picked ??
      (desktop.selectedProvider && desktop.selectedModel
        ? {
            providerID: desktop.selectedProvider,
            modelID: desktop.selectedModel,
          }
        : null)
    if (effective) {
      const variants =
        map.get(`${effective.providerID}/${effective.modelID}`) ?? null
      if (variants && !variants.includes(choice.effort)) {
        const ref = `${effective.providerID}/${effective.modelID}`
        return variants.length > 0
          ? `effort "${choice.effort}" is not available on ${ref} — levels: ${variants.join(", ")}`
          : `effort "${choice.effort}" is not available on ${ref} — that model has no reasoning effort levels`
      }
    }
  }
  return null
}

/**
 * Stamps an explicit pick onto a prompt body. The model goes on first so the
 * saved desktop effort is still applied (and checked) against the picked
 * model; an explicit effort then wins over the saved one.
 */
export async function applyModelChoice(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
  choice: ThreadModelChoice | null,
): Promise<void> {
  if (choice?.providerID && choice.modelID)
    body.model = { providerID: choice.providerID, modelID: choice.modelID }
  await applyThinkingEffort(db, userId, body)
  if (choice?.effort) body.variant = choice.effort
}

/** A stored per-thread pick (`thread_models` row), halves nullable. */
export type ThreadModelRow = {
  providerId: string | null
  modelId: string | null
  effort: string | null
}

/** The row as a choice; a half-written model pair is no model pick. */
export function threadModelChoice(
  row: ThreadModelRow | null,
): ThreadModelChoice | null {
  if (!row) return null
  const picked = Boolean(row.providerId && row.modelId)
  return {
    providerID: picked ? row.providerId : null,
    modelID: picked ? row.modelId : null,
    effort: row.effort,
  }
}

/**
 * Effective model + effort for one thread: each stored half wins, the
 * other falls back to the desktop default (or team overlay — the caller
 * resolves that into `fallback`). `thread` echoes the explicit pick so
 * the UI knows which halves are pinned to this thread.
 */
export function resolveThreadModel(
  row: ThreadModelRow | null,
  fallback: {
    providerID: string | null
    modelID: string | null
    thinkingEffort: string | null
  },
): {
  providerID: string | null
  modelID: string | null
  thinkingEffort: string | null
  thread: ThreadModelChoice | null
} {
  const thread = threadModelChoice(row)
  return {
    providerID: thread?.providerID ?? fallback.providerID,
    modelID: thread?.modelID ?? fallback.modelID,
    thinkingEffort: thread?.effort ?? fallback.thinkingEffort,
    thread,
  }
}

/**
 * Dashboard prompt stamp, per thread. The stored pick fills only what
 * the body leaves open — an explicit body model (the composer's current
 * pick, possibly newer than the stored row while its save is in flight)
 * always wins. The desktop effort applies first; the thread effort then
 * overrides it, but only on a model that provably supports it (an
 * unreadable provider list fails open like validateModelChoice, since
 * the pick was validated when it was stored). Never throws.
 */
export async function applyThreadModelChoice(
  db: Db,
  userId: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const choice = threadModelChoice(
    sessionId && typeof db.threadModel === "function"
      ? db.threadModel(userId, sessionId)
      : null,
  )
  if (!choice) {
    await applyThinkingEffort(db, userId, body)
    return
  }
  if (choice.providerID && choice.modelID && !bodyModel(body))
    body.model = { providerID: choice.providerID, modelID: choice.modelID }
  await applyThinkingEffort(db, userId, body)
  if (!choice.effort) return
  try {
    const desktop = db.desktop(userId)
    const effective =
      bodyModel(body) ??
      (desktop?.selectedProvider && desktop.selectedModel
        ? {
            providerID: desktop.selectedProvider,
            modelID: desktop.selectedModel,
          }
        : null)
    if (desktop && effective) {
      const map = await fetchModelVariants(userId, desktop)
      const key = `${effective.providerID}/${effective.modelID}`
      if (
        map.has(key) &&
        !supportsEffort(
          map,
          effective.providerID,
          effective.modelID,
          choice.effort,
        )
      )
        return
    }
  } catch {
    // Provider list unreadable — the pick was validated at save time.
  }
  body.variant = choice.effort
}

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
