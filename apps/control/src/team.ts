import type { Db, Role, TeamKey } from "@open-bot/db"

export type TeamMode = "personal" | "team"

export type TeamProviderOverlay = {
  chat?: {
    provider?: string | null
    model?: string | null
  }
  image?: {
    provider?: string | null
    accountId?: string | null
    apiKey?: string | null
    model?: string | null
  }
  video?: {
    provider?: string | null
    accountId?: string | null
    apiKey?: string | null
    model?: string | null
  }
  model3d?: {
    provider?: string | null
    accountId?: string | null
    apiKey?: string | null
    model?: string | null
  }
  system1?: {
    provider?: string | null
    endpoint?: string | null
    apiKey?: string | null
    gatewayToken?: string | null
    model?: string | null
    accountId?: string | null
    gatewayId?: string | null
    slug?: string | null
  }
  voice?: {
    sttProvider?: string | null
    sttAccountId?: string | null
    sttApiKey?: string | null
    sttModel?: string | null
    ttsProvider?: string | null
    ttsAccountId?: string | null
    ttsApiKey?: string | null
    ttsModel?: string | null
  }
  watchdog?: {
    provider?: string | null
    accountId?: string | null
    apiKey?: string | null
    model?: string | null
    baseUrl?: string | null
  }
}

export type TeamConfig = {
  mode: TeamMode
  lockModelPicker: boolean
  lockWatchdog: boolean
  quotaDefaultTokens: number | null
  quotaBehavior: "block" | "warn"
  providers: TeamProviderOverlay
}

const DEFAULT_CONFIG: TeamConfig = {
  mode: "personal",
  lockModelPicker: false,
  lockWatchdog: false,
  quotaDefaultTokens: null,
  quotaBehavior: "block",
  providers: {},
}

const PROVIDER_SECTIONS: Record<string, readonly string[]> = {
  chat: ["provider", "model"],
  image: ["provider", "accountId", "apiKey", "model"],
  video: ["provider", "accountId", "apiKey", "model"],
  model3d: ["provider", "accountId", "apiKey", "model"],
  system1: [
    "provider",
    "endpoint",
    "apiKey",
    "gatewayToken",
    "model",
    "accountId",
    "gatewayId",
    "slug",
  ],
  voice: [
    "sttProvider",
    "sttAccountId",
    "sttApiKey",
    "sttModel",
    "ttsProvider",
    "ttsAccountId",
    "ttsApiKey",
    "ttsModel",
  ],
  watchdog: ["provider", "accountId", "apiKey", "model", "baseUrl"],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseProviders(
  value: unknown,
  strict: boolean,
): TeamProviderOverlay | null {
  if (!isObject(value)) {
    if (strict) throw new Error("invalid providers")
    return null
  }
  if (strict) {
    for (const key of Object.keys(value)) {
      if (!(key in PROVIDER_SECTIONS)) {
        throw new Error(`invalid providers.${key}`)
      }
    }
  }
  const out: Record<string, Record<string, string | null>> = {}
  for (const [section, fields] of Object.entries(PROVIDER_SECTIONS)) {
    const raw = value[section]
    if (raw === undefined) continue
    if (!isObject(raw)) {
      if (strict) throw new Error(`invalid providers.${section}`)
      continue
    }
    const cleaned: Record<string, string | null> = {}
    for (const [field, fieldValue] of Object.entries(raw)) {
      if (!fields.includes(field)) {
        if (strict) throw new Error(`invalid providers.${section}.${field}`)
        continue
      }
      if (fieldValue !== null && typeof fieldValue !== "string") {
        if (strict) throw new Error(`invalid providers.${section}.${field}`)
        continue
      }
      cleaned[field] = fieldValue
    }
    out[section] = cleaned
  }
  return out as TeamProviderOverlay
}

export function getTeamConfig(db: Db): TeamConfig {
  const raw = db.getSetting("team_config")
  if (raw === null) return { ...DEFAULT_CONFIG, providers: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_CONFIG, providers: {} }
  }
  if (!isObject(parsed)) return { ...DEFAULT_CONFIG, providers: {} }
  const config: TeamConfig = { ...DEFAULT_CONFIG, providers: {} }
  if (parsed.mode === "personal" || parsed.mode === "team") {
    config.mode = parsed.mode
  }
  if (typeof parsed.lockModelPicker === "boolean") {
    config.lockModelPicker = parsed.lockModelPicker
  }
  if (typeof parsed.lockWatchdog === "boolean") {
    config.lockWatchdog = parsed.lockWatchdog
  }
  if (
    typeof parsed.quotaDefaultTokens === "number" &&
    Number.isFinite(parsed.quotaDefaultTokens) &&
    parsed.quotaDefaultTokens >= 0
  ) {
    config.quotaDefaultTokens = Math.floor(parsed.quotaDefaultTokens)
  }
  if (parsed.quotaBehavior === "block" || parsed.quotaBehavior === "warn") {
    config.quotaBehavior = parsed.quotaBehavior
  }
  const providers = parseProviders(parsed.providers, false)
  if (providers) config.providers = providers
  return config
}

export type TeamSecretMarkers = Record<
  string,
  { hasKey: boolean; hasGatewayToken?: boolean }
>

const SECRET_KEY_FIELDS = new Set(["apiKey", "sttApiKey", "ttsApiKey"])

// GET responses never carry overlay secrets: secret fields become null and a
// per-section marker map tells the admin UI whether a value is stored.
export function redactTeamConfig(config: TeamConfig): {
  config: TeamConfig
  secrets: TeamSecretMarkers
} {
  const providers: Record<string, Record<string, string | null>> = {}
  const secrets: TeamSecretMarkers = {}
  for (const [section, fields] of Object.entries(config.providers)) {
    const out: Record<string, string | null> = {}
    let hasKey = false
    let hasGatewayToken = false
    for (const [field, value] of Object.entries(fields)) {
      if (field === "gatewayToken") {
        hasGatewayToken = hasGatewayToken || Boolean(value)
        out[field] = null
      } else if (SECRET_KEY_FIELDS.has(field)) {
        hasKey = hasKey || Boolean(value)
        out[field] = null
      } else {
        out[field] = value
      }
    }
    providers[section] = out
    const declared = PROVIDER_SECTIONS[section] ?? []
    secrets[section] = declared.includes("gatewayToken")
      ? { hasKey, hasGatewayToken }
      : { hasKey }
  }
  return {
    config: { ...config, providers: providers as TeamProviderOverlay },
    secrets,
  }
}

export function saveTeamConfig(db: Db, patch: Partial<TeamConfig>): TeamConfig {
  const current = getTeamConfig(db)
  const next: TeamConfig = { ...current, providers: { ...current.providers } }
  if (patch.mode !== undefined) {
    if (patch.mode !== "personal" && patch.mode !== "team") {
      throw new Error("invalid mode")
    }
    next.mode = patch.mode
  }
  if (patch.lockModelPicker !== undefined) {
    if (typeof patch.lockModelPicker !== "boolean") {
      throw new Error("invalid lockModelPicker")
    }
    next.lockModelPicker = patch.lockModelPicker
  }
  if (patch.lockWatchdog !== undefined) {
    if (typeof patch.lockWatchdog !== "boolean") {
      throw new Error("invalid lockWatchdog")
    }
    next.lockWatchdog = patch.lockWatchdog
  }
  if (patch.quotaDefaultTokens !== undefined) {
    if (
      patch.quotaDefaultTokens !== null &&
      (typeof patch.quotaDefaultTokens !== "number" ||
        !Number.isFinite(patch.quotaDefaultTokens) ||
        patch.quotaDefaultTokens < 0)
    ) {
      throw new Error("invalid quotaDefaultTokens")
    }
    next.quotaDefaultTokens =
      patch.quotaDefaultTokens === null
        ? null
        : Math.floor(patch.quotaDefaultTokens)
  }
  if (patch.quotaBehavior !== undefined) {
    if (patch.quotaBehavior !== "block" && patch.quotaBehavior !== "warn") {
      throw new Error("invalid quotaBehavior")
    }
    next.quotaBehavior = patch.quotaBehavior
  }
  if (patch.providers !== undefined) {
    const patchProviders = (parseProviders(patch.providers, true) ??
      {}) as Record<string, Record<string, string | null>>
    const merged: Record<string, Record<string, string | null>> = {
      ...(current.providers as Record<string, Record<string, string | null>>),
    }
    for (const [section, fields] of Object.entries(patchProviders)) {
      const base = { ...(merged[section] ?? {}) }
      for (const [field, raw] of Object.entries(fields)) {
        base[field] = raw === "" ? null : raw
      }
      if (Object.values(base).every((value) => value === null)) {
        delete merged[section]
      } else {
        merged[section] = base
      }
    }
    next.providers = merged as TeamProviderOverlay
  }
  db.setSetting("team_config", JSON.stringify(next))
  return next
}

export function teamMode(db: Db): TeamMode {
  return getTeamConfig(db).mode
}

export function teamWriteLocked(db: Db, role: Role): boolean {
  return teamMode(db) === "team" && role !== "admin"
}

export function objectHasAnyField(
  value: unknown,
  fields: readonly string[],
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return fields.some((field) => record[field] !== undefined)
}

export function effectiveUserKey(
  db: Db,
  userId: string,
  slug: string,
): TeamKey | null {
  if (teamMode(db) === "team") return db.getTeamKey(slug)
  const key = db.getUserKey(userId, slug)
  if (!key) return null
  const { userId: _userId, ...rest } = key
  return rest
}

export function weeklyWindowStart(now: number): number {
  const date = new Date(now)
  return (
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
    ((date.getUTCDay() + 6) % 7) * 86400000
  )
}

export function userWeeklyUsage(db: Db, userId: string, now: number): number {
  return db.usageSumSince(userId, weeklyWindowStart(now))
}

export type ResolvedQuota = {
  limitTokens: number | null
  used: number
  over: boolean
  behavior: "block" | "warn"
}

export function resolveQuota(
  db: Db,
  userId: string,
  now: number,
): ResolvedQuota {
  const config = getTeamConfig(db)
  const quota = db.getUserQuota(userId)
  // 0 means unlimited for both the per-user override and the host default.
  const fallback =
    config.quotaDefaultTokens !== null && config.quotaDefaultTokens > 0
      ? config.quotaDefaultTokens
      : null
  const limit =
    quota && quota.weeklyTokens !== null
      ? quota.weeklyTokens === 0
        ? null
        : quota.weeklyTokens
      : fallback
  const used = db.usageSumSince(userId, weeklyWindowStart(now))
  return {
    limitTokens: limit,
    used,
    over: limit !== null && used >= limit,
    behavior: config.quotaBehavior,
  }
}
