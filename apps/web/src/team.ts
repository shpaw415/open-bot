import { useEffect, useState } from "react"
import {
  api,
  type QuotaState,
  type TeamInfo,
  type TeamProviderOverlay,
} from "./api"

export const PERSONAL_TEAM: TeamInfo = {
  mode: "personal",
  lockModelPicker: false,
  lockWatchdog: false,
}

let teamCache: Promise<TeamInfo> | null = null

export function resetTeamModeCache() {
  teamCache = null
}

export function loadTeamMode(): Promise<TeamInfo> {
  teamCache ??= api<{ team?: TeamInfo }>("/api/keys")
    .then((body) => body.team ?? PERSONAL_TEAM)
    .catch(() => PERSONAL_TEAM)
  return teamCache
}

export function useTeamMode(): TeamInfo {
  const [team, setTeam] = useState<TeamInfo>(PERSONAL_TEAM)
  useEffect(() => {
    let alive = true
    void loadTeamMode().then((next) => {
      if (alive) setTeam(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return team
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export type QuotaMeterView = {
  visible: boolean
  severity: "info" | "warning" | "error"
  text: string
}

export function quotaMeterView(quota: QuotaState | null): QuotaMeterView {
  if (!quota || quota.limitTokens === null)
    return { visible: false, severity: "info", text: "" }
  const used = `${formatTokenCount(quota.used)} / ${formatTokenCount(quota.limitTokens)} tokens this week`
  if (quota.over && quota.behavior === "block")
    return {
      visible: true,
      severity: "error",
      text: `${used}. Sending is paused until the week resets.`,
    }
  if (quota.over)
    return {
      visible: true,
      severity: "warning",
      text: `${used}. You are over the weekly cap.`,
    }
  return { visible: true, severity: "info", text: used }
}

export type ParsedQuotaCap = { ok: true; value: number | null } | { ok: false }

// Empty inherits the host default (null), 0 means unlimited, otherwise a
// weekly token cap.
export function parseQuotaCapInput(raw: string): ParsedQuotaCap {
  const text = raw.trim()
  if (text === "") return { ok: true, value: null }
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return { ok: false }
  return { ok: true, value: Math.floor(value) }
}

const TEAM_SECRET_FIELDS = new Set(["apiKey", "gatewayToken"])

export function isTeamSecretField(field: string): boolean {
  return TEAM_SECRET_FIELDS.has(field)
}

// Present-set write where blank secret fields are omitted so a saved shared
// key survives an edit of the other fields.
export function teamKeysPayload(
  slug: string,
  fields: readonly { id: string }[],
  values: Record<string, string>,
): Record<string, string> {
  const body: Record<string, string> = { slug }
  for (const field of fields) {
    const value = values[field.id] ?? ""
    if (isTeamSecretField(field.id)) {
      if (value !== "") body[field.id] = value
    } else {
      body[field.id] = value
    }
  }
  return body
}

export type TeamOverlayField = {
  field: string
  label: string
  placeholder?: string
}

export type TeamOverlaySection = {
  section: keyof TeamProviderOverlay & string
  title: string
  description: string
  fields: TeamOverlayField[]
}

export const TEAM_OVERLAY_SECTIONS: TeamOverlaySection[] = [
  {
    section: "chat",
    title: "Chat",
    description: "Provider and model used as everyone's chat default.",
    fields: [
      { field: "provider", label: "Provider", placeholder: "openai" },
      { field: "model", label: "Model", placeholder: "model id" },
    ],
  },
  {
    section: "image",
    title: "Image generation",
    description: "Shared image provider setup.",
    fields: [
      { field: "provider", label: "Provider", placeholder: "cloudflare" },
      { field: "accountId", label: "Account ID" },
      { field: "apiKey", label: "API key" },
      { field: "model", label: "Model" },
    ],
  },
  {
    section: "video",
    title: "Video generation",
    description: "Shared video provider setup.",
    fields: [
      { field: "provider", label: "Provider", placeholder: "cloudflare" },
      { field: "accountId", label: "Account ID" },
      { field: "apiKey", label: "API key" },
      { field: "model", label: "Model" },
    ],
  },
  {
    section: "model3d",
    title: "3D model generation",
    description: "Shared 3D model provider setup.",
    fields: [
      { field: "provider", label: "Provider", placeholder: "cloudflare" },
      { field: "accountId", label: "Account ID" },
      { field: "apiKey", label: "API key" },
      { field: "model", label: "Model" },
    ],
  },
  {
    section: "system1",
    title: "System 1",
    description: "Shared System 1 decision-model provider.",
    fields: [
      { field: "provider", label: "Provider", placeholder: "cloudflare" },
      { field: "endpoint", label: "Endpoint URL" },
      { field: "apiKey", label: "API key" },
      { field: "gatewayToken", label: "Gateway token" },
      { field: "model", label: "Model" },
      { field: "accountId", label: "Account ID" },
      { field: "gatewayId", label: "Gateway ID" },
      { field: "slug", label: "Gateway slug" },
    ],
  },
  {
    section: "voice",
    title: "Voice",
    description:
      "Shared speech providers. Each user keeps their own voice and language.",
    fields: [
      { field: "sttProvider", label: "STT provider" },
      { field: "sttAccountId", label: "STT account ID" },
      { field: "sttApiKey", label: "STT API key" },
      { field: "sttModel", label: "STT model" },
      { field: "ttsProvider", label: "TTS provider" },
      { field: "ttsAccountId", label: "TTS account ID" },
      { field: "ttsApiKey", label: "TTS API key" },
      { field: "ttsModel", label: "TTS model" },
    ],
  },
  {
    section: "watchdog",
    title: "Watchdog verdict provider",
    description: "Shared watchdog LLM verdict provider.",
    fields: [
      { field: "provider", label: "Provider" },
      { field: "accountId", label: "Account ID" },
      { field: "apiKey", label: "API key" },
      { field: "model", label: "Model" },
      { field: "baseUrl", label: "Base URL" },
    ],
  },
]

export function overlayDraft(
  providers: TeamProviderOverlay,
): Record<string, Record<string, string>> {
  const draft: Record<string, Record<string, string>> = {}
  for (const { section, fields } of TEAM_OVERLAY_SECTIONS) {
    const values = providers[section] as
      | Record<string, string | null | undefined>
      | undefined
    draft[section] = Object.fromEntries(
      fields.map((field) => [field.field, values?.[field.field] ?? ""]),
    )
  }
  return draft
}

// Blank secret fields are omitted (keep the stored value); other blank fields
// clear (null).
export function overlayPatch(
  draft: Record<string, Record<string, string>>,
): TeamProviderOverlay {
  const providers: Record<string, Record<string, string | null>> = {}
  for (const [section, fields] of Object.entries(draft)) {
    const cleaned: Record<string, string | null> = {}
    for (const [field, raw] of Object.entries(fields)) {
      const value = raw.trim()
      if (isTeamSecretField(field)) {
        if (value !== "") cleaned[field] = value
      } else {
        cleaned[field] = value === "" ? null : value
      }
    }
    providers[section] = cleaned
  }
  return providers as TeamProviderOverlay
}
