import type { Db } from "@open-bot/db"
import {
  type ChatKeyEntry,
  restartOpencode,
  syncChatAuth,
  syncImageAuth,
  syncModel3dAuth,
  syncSystem1,
  syncVideoAuth,
  syncWatchdogConfig,
} from "./docker"
import { basicOpencodeAuth as basic } from "./effort"
import type { EventHub } from "./events"
import {
  chatVaultSlugs,
  imageVaultSlug,
  model3dVaultSlug,
  resolveChatKeys,
  resolveImageProvider,
  resolveModel3dProvider,
  resolveSystem1,
  resolveVideoProvider,
  system1VaultSlug,
  videoVaultSlug,
} from "./key-vault"
import { system1ProviderById } from "./system1"
import {
  resolveWatchdogConfig,
  watchdogContainerPayload,
  watchdogProviderById,
} from "./watchdog"

export type TeamApplyOptions = {
  slugs?: string[]
  configChanged?: boolean
}

export type TeamApplyResult = {
  userId: string
  ok: boolean
  applied?: Record<string, unknown>
  error?: string
}

const softError = (message: string, marker: string) => message.includes(marker)

async function applyTeamChangeForUser(
  db: Db,
  userId: string,
  changed: Set<string>,
  all: boolean,
  hub: EventHub | undefined,
): Promise<Record<string, unknown>> {
  const applied: Record<string, unknown> = {}
  const touches = (slug: string) => all || changed.has(slug)
  const image = resolveImageProvider(db, userId)
  if (image && touches(imageVaultSlug(image.value.provider))) {
    try {
      applied.image = await syncImageAuth(
        userId,
        image.value.apiKey
          ? {
              provider: image.value.provider,
              accountId: image.value.accountId,
              token: image.value.apiKey,
              model: image.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!softError(message, "missing cf-ai setup")) {
        applied.imageError = message
        console.error(`team apply image ${userId}: ${message}`)
      }
    }
  }
  const video = resolveVideoProvider(db, userId)
  if (video && touches(videoVaultSlug(video.value.provider))) {
    try {
      applied.video = await syncVideoAuth(
        userId,
        video.value.apiKey
          ? {
              provider: video.value.provider,
              accountId: video.value.accountId,
              token: video.value.apiKey,
              model: video.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!softError(message, "missing video setup")) {
        applied.videoError = message
        console.error(`team apply video ${userId}: ${message}`)
      }
    }
  }
  const model3d = resolveModel3dProvider(db, userId)
  if (model3d && touches(model3dVaultSlug(model3d.value.provider))) {
    try {
      applied.model3d = await syncModel3dAuth(
        userId,
        model3d.value.apiKey
          ? {
              provider: model3d.value.provider,
              accountId: model3d.value.accountId,
              token: model3d.value.apiKey,
              model: model3d.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!softError(message, "missing model3d setup")) {
        applied.model3dError = message
        console.error(`team apply model3d ${userId}: ${message}`)
      }
    }
  }
  const system1 = resolveSystem1(db, userId)
  if (system1 && touches(system1VaultSlug(system1.value.provider))) {
    const spec = system1ProviderById(system1.value.provider)
    const usable = Boolean(system1.value.apiKey) || !spec?.keyRequired
    try {
      applied.system1 = await syncSystem1(userId, usable ? system1.value : null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!softError(message, "missing system1 setup")) {
        applied.system1Error = message
        console.error(`team apply system1 ${userId}: ${message}`)
      }
    }
  }
  const watchdog = resolveWatchdogConfig(db, userId)
  const watchdogSpec = watchdogProviderById(watchdog.value.provider)
  if (watchdogSpec && touches(watchdogSpec.vaultSlug)) {
    try {
      applied.watchdog = await syncWatchdogConfig(
        userId,
        watchdogContainerPayload(watchdog.value),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!softError(message, "missing watchdog setup")) {
        applied.watchdogError = message
        console.error(`team apply watchdog ${userId}: ${message}`)
      }
    }
  }
  const chatSlugs = chatVaultSlugs().filter((slug) => touches(slug))
  if (chatSlugs.length > 0) {
    const desktop = db.desktop(userId)
    if (desktop) {
      const keys = new Map(
        resolveChatKeys(db, userId).map((item) => [item.slug, item.key]),
      )
      const entries: ChatKeyEntry[] = []
      const revoke: ChatKeyEntry[] = []
      for (const slug of chatSlugs) {
        const key = keys.get(slug) ?? ""
        if (key) entries.push({ slug, key })
        else revoke.push({ slug, key: "" })
      }
      try {
        const chat = await syncChatAuth(
          userId,
          basic(desktop.opencodePassword).authorization,
          entries,
          revoke,
        )
        applied.chat = chat
        if (chat.applied) await restartOpencode(userId, { db, desktop, hub })
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (!softError(message, "missing chat setup")) {
          applied.chatError = message
          console.error(`team apply chat ${userId}: ${message}`)
        }
      }
    }
  }
  return applied
}

export async function applyTeamChange(
  db: Db,
  hub: EventHub | undefined,
  opts: TeamApplyOptions = {},
): Promise<TeamApplyResult[]> {
  const changed = new Set(opts.slugs ?? [])
  const all = opts.configChanged === true
  const targets = db
    .listUsers()
    .filter((user) => !user.disabled && db.desktop(user.id))
  return Promise.all(
    targets.map(async (user): Promise<TeamApplyResult> => {
      try {
        const applied = await applyTeamChangeForUser(
          db,
          user.id,
          changed,
          all,
          hub,
        )
        return { userId: user.id, ok: true, applied }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "team apply failed"
        console.error(`team apply ${user.id}: ${message}`)
        return { userId: user.id, ok: false, error: message }
      }
    }),
  )
}

export function teamKeysPublic(db: Db) {
  return db.getTeamKeys().map((key) => ({
    slug: key.slug,
    hasKey: key.apiKey !== "",
  }))
}
