import type {
  Db,
  ImageProvider,
  Model3dProvider,
  System1Provider,
  UserKey,
  VideoProvider,
} from "@open-bot/db"
import { system1FieldError } from "./system1"

export type KeyVaultFieldId =
  | "apiKey"
  | "accountId"
  | "gatewayId"
  | "gatewayToken"
  | "gatewaySlug"
  | "baseUrl"

export type KeyVaultField = {
  id: KeyVaultFieldId
  label: string
  placeholder: string
  required: boolean
}

export type KeyVaultSpec = {
  id: string
  label: string
  description: string
  chatProvider: boolean
  fields: KeyVaultField[]
  usedBy: string[]
}

const apiKeyField = (label: string, placeholder: string): KeyVaultField => ({
  id: "apiKey",
  label,
  placeholder,
  required: true,
})

export const keyVault: KeyVaultSpec[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    description:
      "Account-wide Cloudflare token, account ID, and AI Gateway details. Shared by Workers AI, xAI Gateway, and desktop navigation.",
    chatProvider: false,
    fields: [
      apiKeyField("API token", "Cloudflare API token"),
      {
        id: "accountId",
        label: "Account ID",
        placeholder: "Cloudflare account ID",
        required: true,
      },
      {
        id: "gatewayId",
        label: "Gateway ID",
        placeholder: "AI Gateway id (optional)",
        required: false,
      },
      {
        id: "gatewayToken",
        label: "Gateway token",
        placeholder: "cf-aig-authorization token (optional)",
        required: false,
      },
      {
        id: "gatewaySlug",
        label: "Custom provider slug",
        placeholder: "jev (optional)",
        required: false,
      },
    ],
    usedBy: [
      "Image · Cloudflare Workers AI",
      "Image & video · xAI (Cloudflare Gateway)",
      "Desktop navigation · Cloudflare Jev / Clef",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI API key for chat and media models.",
    chatProvider: true,
    fields: [apiKeyField("API key", "OpenAI API key")],
    usedBy: ["Chat models", "Image & video · OpenAI"],
  },
  {
    id: "google",
    label: "Google",
    description: "Gemini API key for chat and media models.",
    chatProvider: true,
    fields: [apiKeyField("API key", "Gemini API key")],
    usedBy: ["Chat models", "Image & video · Google"],
  },
  {
    id: "xai",
    label: "xAI",
    description: "xAI API key for chat and image models.",
    chatProvider: true,
    fields: [apiKeyField("API key", "xAI API key")],
    usedBy: ["Chat models", "Image & video · xAI"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Anthropic API key for chat models.",
    chatProvider: true,
    fields: [apiKeyField("API key", "Anthropic API key")],
    usedBy: ["Chat models"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter API key, optionally with a custom base URL.",
    chatProvider: true,
    fields: [
      apiKeyField("API key", "OpenRouter API key"),
      {
        id: "baseUrl",
        label: "Base URL",
        placeholder: "https://openrouter.ai/api/v1 (optional)",
        required: false,
      },
    ],
    usedBy: ["Chat models"],
  },
  {
    id: "stability",
    label: "Stability AI",
    description: "Stability API key for image models.",
    chatProvider: false,
    fields: [apiKeyField("API key", "Stability API key")],
    usedBy: ["Image · Stability"],
  },
  {
    id: "replicate",
    label: "Replicate",
    description: "Replicate API token for image and video models.",
    chatProvider: false,
    fields: [apiKeyField("API token", "Replicate API token")],
    usedBy: ["Image & video · Replicate", "3D · Replicate"],
  },
  {
    id: "fal",
    label: "fal",
    description: "fal API key for video and 3D models.",
    chatProvider: false,
    fields: [apiKeyField("API key", "fal API key")],
    usedBy: ["Video & 3D · fal"],
  },
  {
    id: "meshy",
    label: "Meshy",
    description: "Meshy API key for 3D models.",
    chatProvider: false,
    fields: [apiKeyField("API key", "Meshy API key")],
    usedBy: ["3D · Meshy"],
  },
  {
    id: "tripo",
    label: "Tripo",
    description: "Tripo API key for 3D models.",
    chatProvider: false,
    fields: [apiKeyField("API key", "Tripo API key")],
    usedBy: ["3D · Tripo"],
  },
  {
    id: "laya",
    label: "Laya",
    description:
      "Optional self-hosted Laya key and base URL for desktop navigation.",
    chatProvider: false,
    fields: [
      apiKeyField("API key", "Laya API key (optional)"),
      {
        id: "baseUrl",
        label: "Base URL",
        placeholder: "http://laya:8010 (optional)",
        required: false,
      },
    ],
    usedBy: ["Desktop navigation · Laya"],
  },
]

export function keyVaultSpecById(id: string) {
  return keyVault.find((item) => item.id === id)
}

export function keyVaultPublic() {
  return keyVault.map(
    ({ id, label, description, chatProvider, fields, usedBy }) => ({
      id,
      label,
      description,
      chatProvider,
      fields,
      usedBy,
    }),
  )
}

const imageKeySlugs: Record<string, string> = {
  "cloudflare-workers-ai": "cloudflare",
  "xai-gateway": "cloudflare",
  xai: "xai",
  openai: "openai",
  google: "google",
  stability: "stability",
  replicate: "replicate",
}

const videoKeySlugs: Record<string, string> = {
  "xai-gateway": "cloudflare",
  xai: "xai",
  openai: "openai",
  google: "google",
  replicate: "replicate",
  fal: "fal",
}

const model3dKeySlugs: Record<string, string> = {
  meshy: "meshy",
  tripo: "tripo",
  replicate: "replicate",
  fal: "fal",
}

const system1KeySlugs: Record<string, string> = {
  "cloudflare-jev": "cloudflare",
  "cloudflare-clef": "cloudflare",
  laya: "laya",
}

export function imageVaultSlug(providerId: string) {
  return imageKeySlugs[providerId] ?? ""
}

export function videoVaultSlug(providerId: string) {
  return videoKeySlugs[providerId] ?? ""
}

export function model3dVaultSlug(providerId: string) {
  return model3dKeySlugs[providerId] ?? ""
}

export function system1VaultSlug(providerId: string) {
  return system1KeySlugs[providerId] ?? ""
}

export function chatVaultSlugs() {
  return keyVault.filter((item) => item.chatProvider).map((item) => item.id)
}

export function fillImageFromVault(
  value: ImageProvider,
  vault: UserKey | null,
): ImageProvider {
  return {
    ...value,
    apiKey: value.apiKey || vault?.apiKey || "",
    accountId: value.accountId || vault?.accountId || "",
  }
}

export function fillVideoFromVault(
  value: VideoProvider,
  vault: UserKey | null,
): VideoProvider {
  return {
    ...value,
    apiKey: value.apiKey || vault?.apiKey || "",
    accountId: value.accountId || vault?.accountId || "",
  }
}

export function fillModel3dFromVault(
  value: Model3dProvider,
  vault: UserKey | null,
): Model3dProvider {
  return {
    ...value,
    apiKey: value.apiKey || vault?.apiKey || "",
    accountId: value.accountId || vault?.accountId || "",
  }
}

export function fillSystem1FromVault(
  value: System1Provider,
  vault: UserKey | null,
): System1Provider {
  return {
    ...value,
    apiKey: value.apiKey || vault?.apiKey || "",
    gatewayToken: value.gatewayToken || vault?.gatewayToken || "",
    accountId: value.accountId || vault?.accountId || "",
    gatewayId: value.gatewayId || vault?.gatewayId || "",
    slug: value.slug || vault?.gatewaySlug || "",
  }
}

export type KeySource = "setup" | "vault" | null
export type Resolved<T> = { value: T; keySource: KeySource }

function keySourceOf(setupKey: string, vault: UserKey | null): KeySource {
  if (setupKey) return "setup"
  return vault?.apiKey ? "vault" : null
}

export function resolveImageProvider(
  db: Db,
  userId: string,
): Resolved<ImageProvider> | null {
  const raw = db.getRawImageProvider(userId)
  if (!raw) return null
  const vault = db.getUserKey(userId, imageVaultSlug(raw.provider))
  return {
    value: fillImageFromVault(raw, vault),
    keySource: keySourceOf(raw.apiKey, vault),
  }
}

export function resolveVideoProvider(
  db: Db,
  userId: string,
): Resolved<VideoProvider> | null {
  const raw = db.getRawVideoProvider(userId)
  if (!raw) return null
  const vault = db.getUserKey(userId, videoVaultSlug(raw.provider))
  return {
    value: fillVideoFromVault(raw, vault),
    keySource: keySourceOf(raw.apiKey, vault),
  }
}

export function resolveModel3dProvider(
  db: Db,
  userId: string,
): Resolved<Model3dProvider> | null {
  const raw = db.getRawModel3dProvider(userId)
  if (!raw) return null
  const vault = db.getUserKey(userId, model3dVaultSlug(raw.provider))
  return {
    value: fillModel3dFromVault(raw, vault),
    keySource: keySourceOf(raw.apiKey, vault),
  }
}

export function resolveSystem1(
  db: Db,
  userId: string,
): Resolved<System1Provider> | null {
  const raw = db.getSystem1(userId)
  if (!raw) return null
  const vault = db.getUserKey(userId, system1VaultSlug(raw.provider))
  const hasOwn = Boolean(raw.apiKey)
  const filled = fillSystem1FromVault(raw, vault)
  return {
    value: filled,
    keySource: hasOwn ? "setup" : vault?.apiKey ? "vault" : null,
  }
}

export function resolveChatKeys(
  db: Db,
  userId: string,
): { slug: string; key: string }[] {
  return chatVaultSlugs()
    .map((slug) => ({ slug, key: db.getUserKey(userId, slug)?.apiKey ?? "" }))
    .filter((item) => item.key !== "")
}

export function resolveDesktopProviders(db: Db, userId: string) {
  return {
    viking: db.getVikingProvider(userId),
    image: resolveImageProvider(db, userId)?.value ?? null,
    system1: resolveSystem1(db, userId)?.value ?? null,
    video: resolveVideoProvider(db, userId)?.value ?? null,
    model3d: resolveModel3dProvider(db, userId)?.value ?? null,
    chatKeys: resolveChatKeys(db, userId),
  }
}

export function keyVaultFieldError(
  slug: string,
  field: string,
  value: string,
): string | null {
  if (
    (field === "gatewayId" || field === "gatewaySlug") &&
    slug === "cloudflare"
  ) {
    return system1FieldError(
      field === "gatewaySlug" ? "slug" : "gateway",
      value,
    )
  }
  return null
}
