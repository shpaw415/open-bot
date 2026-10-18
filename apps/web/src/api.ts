export type Me = {
  id: string
  email: string
  role: "admin" | "user"
  mustChangePassword?: boolean
  desktop?: "starting" | "running" | "sleeping"
  model?: {
    providerID: string | null
    modelID: string | null
    thinkingEffort?: string | null
  } | null
}

export function clientId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// HTTP error carrying the parsed JSON body (402 needsPurchase for paid
// plugins, 409 needsConfirm, …) so callers can react to structured fields.
export class ApiHttpError extends Error {
  status: number
  body: Record<string, unknown>
  constructor(
    message: string,
    status: number,
    body: Record<string, unknown> = {},
  ) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string
    reason?: string
  }
  if (!response.ok) {
    // Session 401s carry a machine reason — make the message actionable
    // instead of a bare "unauthorized" on every surface.
    const hint =
      response.status === 401 && body.reason === "no_cookie"
        ? " — session cookie not sent (insecure origin or blocked cookies); sign in again"
        : response.status === 401 &&
            (body.reason === "expired_session" ||
              body.reason === "invalid_session")
          ? " — sign in again"
          : ""
    throw new ApiHttpError(
      (body.error ?? response.statusText) + hint,
      response.status,
      body,
    )
  }
  return body
}

export function isTeamLockedError(caught: unknown): boolean {
  return caught instanceof ApiHttpError && caught.body.error === "team_locked"
}

export type TeamMode = "personal" | "team"

export type TeamInfo = {
  mode: TeamMode
  lockModelPicker: boolean
  lockWatchdog: boolean
}

export type QuotaState = {
  limitTokens: number | null
  used: number
  over: boolean
  behavior: "block" | "warn"
}

export type TeamProviderOverlay = {
  chat?: { provider?: string | null; model?: string | null }
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

export type TeamAdminConfig = {
  mode: TeamMode
  lockModelPicker: boolean
  lockWatchdog: boolean
  quotaDefaultTokens: number | null
  quotaBehavior: "block" | "warn"
  providers: TeamProviderOverlay
}

export type TeamConfigPatch = {
  mode?: TeamMode
  lockModelPicker?: boolean
  lockWatchdog?: boolean
  quotaDefaultTokens?: number | null
  quotaBehavior?: "block" | "warn"
  providers?: TeamProviderOverlay
}

export type TeamCatalogField = {
  id: string
  label: string
  placeholder: string
  required: boolean
}

export type TeamCatalogEntry = {
  id: string
  label: string
  description: string
  chatProvider: boolean
  fields: TeamCatalogField[]
  usedBy: string[]
}

export type TeamKeyState = { slug: string; hasKey: boolean }

export type TeamSecretMarkers = Record<
  string,
  { hasKey: boolean; hasGatewayToken?: boolean }
>

export type TeamQuotaUser = {
  userId: string
  email: string
  weeklyTokens: number | null
  used: number
  limitTokens: number | null
}

export type TeamAdminBody = {
  config: TeamAdminConfig
  secrets: TeamSecretMarkers
  catalog: TeamCatalogEntry[]
  keys: TeamKeyState[]
}

export type TeamQuotasBody = {
  default: number | null
  behavior: "block" | "warn"
  users: TeamQuotaUser[]
}

export function fetchQuota(): Promise<QuotaState> {
  return api<QuotaState>("/api/quota")
}

export function fetchTeamAdmin(): Promise<TeamAdminBody> {
  return api<TeamAdminBody>("/api/admin/team")
}

export function saveTeamAdminConfig(
  patch: TeamConfigPatch,
): Promise<{ config: TeamAdminConfig; secrets: TeamSecretMarkers }> {
  return api<{ config: TeamAdminConfig; secrets: TeamSecretMarkers }>(
    "/api/admin/team",
    {
      method: "PUT",
      body: JSON.stringify(patch),
    },
  )
}

export function saveTeamAdminKey(
  payload: Record<string, string>,
): Promise<{ keys: TeamKeyState[] }> {
  return api<{ keys: TeamKeyState[] }>("/api/admin/team/keys", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function importTeamAdmin(): Promise<{
  config: TeamAdminConfig
  secrets: TeamSecretMarkers
  keys: TeamKeyState[]
}> {
  return api<{
    config: TeamAdminConfig
    secrets: TeamSecretMarkers
    keys: TeamKeyState[]
  }>("/api/admin/team/import", { method: "POST" })
}

export function fetchTeamQuotas(): Promise<TeamQuotasBody> {
  return api<TeamQuotasBody>("/api/admin/team/quotas")
}

export function saveTeamUserQuota(
  userId: string,
  weeklyTokens: number | null,
): Promise<unknown> {
  return api("/api/admin/team/quota", {
    method: "PUT",
    body: JSON.stringify({ userId, weeklyTokens }),
  })
}

export type DesktopStatus = {
  phase: "starting" | "running" | "sleeping"
  error?: string
}

export async function waitForDesktop(timeoutMs = 330_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const status = await api<DesktopStatus>("/api/desktop")
    if (status.error) throw new Error(status.error)
    if (status.phase === "running") return
    if (Date.now() > deadline)
      throw new Error("desktop did not start in time, try again")
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}
