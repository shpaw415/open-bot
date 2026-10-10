import type {
  CronJob,
  Db,
  InstalledPlugin,
  PluginAppliedLog,
  User,
} from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { nextRunMs } from "./cron"
import {
  endpoint,
  ensurePluginAgentsMd,
  type PluginToolFile,
  pluginAgentsMdPath,
  removePluginTools,
  restartOpencode,
  runPluginInitCommands,
  syncOpencodePlugin,
  syncPluginAgentsMd,
  syncPluginAuth,
  syncPluginTools,
} from "./docker"
import { extractPluginFiles, fetchPluginArtifact } from "./plugin-artifact"
import { readLocalPluginFiles } from "./plugin-local"
import { createVikingSkills } from "./viking-skills"
import { vikingUserKey } from "./viking-user"

const INIT_OUTPUT_LIMIT = 8 * 1024

function initLogEntry(result: {
  ran: boolean
  ok: boolean
  output: string
}): PluginAppliedLog["init"] {
  if (!result.ran) return undefined
  return {
    ranAt: Date.now(),
    ok: result.ok,
    output: result.output.slice(0, INIT_OUTPUT_LIMIT),
  }
}

export type MarketplaceEntry = {
  id: string
  version: string
  status: "pending" | "approved" | "rejected"
  manifest: PluginManifest
  readme: string | null
  downloads: number
}

export type PluginInstallOptions = {
  settings?: Record<string, string>
  source?: "marketplace" | "local"
  localPath?: string | null
  files?: PluginToolFile[]
}

export async function ensureAgentDesktop(user: User, db: Db) {
  if (user.disabled) throw new Error("account disabled")
  const desktop = db.desktop(user.id)
  if (!desktop) throw new Error("desktop record missing")
  return desktop
}

async function vikingSkills(user: User, db: Db) {
  const desktop = await ensureAgentDesktop(user, db)
  const base = await endpoint(user.id, "viking", 1933)
  return createVikingSkills(base, vikingUserKey(desktop.vikingKey))
}

export function pluginSettingsFor(
  manifest: PluginManifest,
  existing: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const config of manifest.configs ?? []) {
    out[config.key] = existing[config.key] ?? config.def
  }
  return out
}

export function pluginConfigPayload(
  db: Db,
  userId: string,
  manifest: PluginManifest,
  settings: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { settings }
  const vaultRead = manifest.permissions?.vaultRead ?? []
  if (vaultRead.length > 0) {
    const vault: Record<string, unknown> = {}
    for (const slug of vaultRead) {
      const key = db.getUserKey(userId, slug)
      if (key?.apiKey) {
        vault[slug] = {
          apiKey: key.apiKey,
          accountId: key.accountId,
          baseUrl: key.baseUrl,
        }
      }
    }
    payload.vault = vault
  }
  return payload
}

// Resolves the manifest's payload files into installable binaries by pulling
// the reviewed release tarball from the marketplace.
async function resolvePluginFiles(
  db: Db,
  pluginId: string,
  version: string,
  manifest: PluginManifest,
): Promise<PluginToolFile[]> {
  const declared = manifest.files ?? []
  if (declared.length === 0) return []
  const artifact = await fetchPluginArtifact(db, pluginId, version)
  return extractPluginFiles(artifact.tarballPath, declared)
}

function inlineToolFiles(manifest: PluginManifest): PluginToolFile[] {
  return (manifest.tools ?? []).map((tool) => ({
    name: tool.name,
    content: tool.content,
    exec: tool.exec !== false,
  }))
}

// Creates personas, cron jobs, skills, vault entries, desktop tools, and
// OpenCode extensions declared by the manifest, and records what it created
// so uninstall can reverse every piece.
export async function applyPluginInstall(
  db: Db,
  user: User,
  entry: MarketplaceEntry,
  options: PluginInstallOptions = {},
): Promise<InstalledPlugin> {
  const { manifest } = entry
  const existing = db.installedPlugin(user.id, manifest.id)
  const previous = existing?.applied
  const reusedPersonaIds: string[] = []
  const source = options.source === "local" ? "local" : "marketplace"
  const localPath = source === "local" ? (options.localPath ?? null) : null
  if (source === "local" && !localPath) {
    throw new Error("local install is missing a path")
  }
  const applied: PluginAppliedLog = {
    personaIds: [],
    cronJobIds: [],
    skills: [],
    keys: [],
    tools: [],
    opencode: false,
  }

  try {
    // Saved settings survive an upgrade/reinstall: request-provided values
    // win, then everything the user configured keeps its value.
    const savedSettings: Record<string, string> = {}
    for (const setting of db.pluginSettings(user.id, manifest.id)) {
      savedSettings[setting.key] = setting.value
    }
    const wantedSettings = pluginSettingsFor(manifest, {
      ...savedSettings,
      ...(options.settings ?? {}),
    })
    for (const [key, value] of Object.entries(wantedSettings)) {
      db.setPluginSetting(user.id, manifest.id, key, value)
    }
    // Settings migration: keys the new manifest no longer declares are dead
    // weight (and keep surfacing in config payloads) — prune them.
    const manifestKeys = new Set(
      (manifest.configs ?? []).map((config) => config.key),
    )
    for (const setting of db.pluginSettings(user.id, manifest.id)) {
      if (!manifestKeys.has(setting.key)) {
        db.deletePluginSetting(user.id, manifest.id, setting.key)
      }
    }

    for (const slug of manifest.permissions?.vaultCreate ?? []) {
      if (!db.getUserKey(user.id, slug)) {
        db.setUserKey(user.id, slug, {
          apiKey: "",
          accountId: "",
          gatewayId: "",
          gatewayToken: "",
          gatewaySlug: "",
          baseUrl: "",
        })
      }
      applied.keys.push(slug)
    }

    for (const persona of manifest.personas ?? []) {
      const match = db
        .personas(user.id)
        .find((row) => row.name.toLowerCase() === persona.name.toLowerCase())
      if (match) {
        reusedPersonaIds.push(match.id)
        continue
      }
      const id = crypto.randomUUID()
      db.createPersona({
        id,
        userId: user.id,
        name: persona.name,
        instruction: persona.instruction,
        createdAt: Date.now(),
      })
      applied.personaIds.push(id)
    }

    for (const job of manifest.cron ?? []) {
      const name = `plugin:${manifest.id}:${job.name}`
      const previousOwned = previous?.cronJobIds.find(
        (id) => db.cronJobById(id, user.id)?.name === name,
      )
      if (previousOwned) {
        db.deleteCronJob(previousOwned, user.id)
      } else {
        const clash = db.cronJobs(user.id).find((row) => row.name === name)
        if (clash)
          throw new Error(`a scheduled job named ${name} already exists`)
      }
      const id = crypto.randomUUID()
      const row: CronJob = {
        id,
        userId: user.id,
        name,
        message: job.message,
        kind: job.cronExpr ? ("cron" as const) : ("every" as const),
        cronExpr: job.cronExpr ?? null,
        everySeconds: job.everySeconds ?? null,
        atMs: null,
        enabled: true,
        deleteAfterRun: false,
        sessionId: null,
        createdAt: Date.now(),
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        lastError: null,
        providerId: null,
        modelId: null,
        personaId: null,
        runKind: "prompt" as const,
        script: null,
      }
      row.nextRunAt = nextRunMs(row)
      db.createCronJob(row)
      applied.cronJobIds.push(id)
    }

    if ((manifest.skills?.length ?? 0) > 0) {
      const skills = await vikingSkills(user, db)
      const owned = new Set(previous?.skills ?? [])
      const existingNames = new Set((await skills.list()).map((s) => s.name))
      for (const skill of manifest.skills ?? []) {
        if (existingNames.has(skill.name) && !owned.has(skill.name)) {
          throw new Error(`a skill named ${skill.name} already exists`)
        }
        await skills.save({
          name: skill.name,
          description: skill.description,
          body: skill.body,
        })
        if (!applied.skills.includes(skill.name))
          applied.skills.push(skill.name)
      }
    }

    const payloadFiles =
      options.files !== undefined
        ? options.files
        : await resolvePluginFiles(db, manifest.id, entry.version, manifest)
    const toolFiles: PluginToolFile[] = [
      ...inlineToolFiles(manifest),
      ...payloadFiles,
    ]
    if (toolFiles.length > 0) {
      await syncPluginTools(user.id, manifest.id, toolFiles)
      for (const file of toolFiles) applied.tools.push(file.name)
    }

    const payload = pluginConfigPayload(db, user.id, manifest, wantedSettings)
    await syncPluginAuth(user.id, manifest.id, payload)

    const setupCommands = manifest.setup?.commands ?? []
    if (setupCommands.length > 0) {
      const result = await runPluginInitCommands(
        user.id,
        manifest.id,
        setupCommands,
      )
      applied.init = initLogEntry(result)
      if (!result.ok) {
        console.error(
          `plugin ${manifest.id} setup commands failed${
            result.timedOut ? " (timed out)" : ""
          }: ${result.output.slice(0, 500)}`,
        )
      }
    }

    const opencode = manifest.opencode
    if (opencode?.agentsMd) {
      await syncPluginAgentsMd(user.id, manifest.id, opencode.agentsMd)
      applied.agentsMd = true
    }
    if (
      opencode &&
      (opencode.plugin?.length ||
        opencode.mcp ||
        opencode.agents ||
        opencode.agentTools)
    ) {
      await syncOpencodePlugin(user.id, {
        addPlugins: opencode.plugin ?? [],
        removePlugins: [],
        addMcp: (opencode.mcp ?? {}) as Record<string, unknown>,
        removeMcp: [],
        addAgents: opencode.agents ?? {},
        removeAgents: [],
        addAgentTools: opencode.agentTools ?? {},
        removeAgentTools: {},
      })
      applied.opencode = true
    }
    if (applied.agentsMd || applied.opencode) {
      if (applied.agentsMd) {
        await syncOpencodePlugin(user.id, {
          addPlugins: [],
          removePlugins: [],
          addMcp: {},
          removeMcp: [],
          addInstructions: [pluginAgentsMdPath(manifest.id)],
          removeInstructions: [],
        })
      }
      await restartOpencode(user.id).catch(() => {})
    }
  } catch (error) {
    // A failed fresh install must leave nothing behind. A failed upgrade can
    // leave a partially upgraded state; uninstall still cleans everything.
    if (!existing) {
      try {
        await revertApplied(db, user, manifest.id, applied)
      } catch {
        // best effort
      }
    }
    throw error
  }

  const now = Date.now()
  applied.personaIds.push(...reusedPersonaIds)
  if (existing) {
    db.updateInstalledPlugin(user.id, manifest.id, {
      version: entry.version,
      manifest: JSON.stringify(manifest),
      readme: entry.readme ?? existing.readme,
      source,
      localPath,
    })
  } else {
    db.createInstalledPlugin({
      id: crypto.randomUUID(),
      userId: user.id,
      pluginId: manifest.id,
      version: entry.version,
      manifest: JSON.stringify(manifest),
      readme: entry.readme,
      enabled: true,
      source,
      localPath,
      applied: "{}",
      createdAt: now,
      updatedAt: now,
    })
  }
  db.setInstalledPluginApplied(user.id, manifest.id, applied)
  const row = db.installedPlugin(user.id, manifest.id)
  if (!row) throw new Error("plugin row disappeared after install")
  return row
}

async function revertApplied(
  db: Db,
  user: User,
  pluginId: string,
  applied: InstalledPlugin["applied"],
) {
  for (const id of applied.personaIds) {
    const persona = db.personaById(id, user.id)
    if (persona) db.deletePersona(id, user.id)
  }
  for (const id of applied.cronJobIds) db.deleteCronJob(id, user.id)
  if (applied.skills.length > 0) {
    const skills = await vikingSkills(user, db)
    for (const name of applied.skills) await skills.remove(name).catch(() => {})
  }
  for (const slug of applied.keys) {
    const key = db.getUserKey(user.id, slug)
    if (key && key.apiKey === "") db.clearUserKey(user.id, slug)
  }
  if (applied.tools.length > 0) {
    await removePluginTools(user.id, pluginId, applied.tools).catch(() => {})
  }
  if (applied.opencode) {
    const manifest = db.installedPlugin(user.id, pluginId)?.manifest as
      | PluginManifest
      | undefined
    await syncOpencodePlugin(user.id, {
      addPlugins: [],
      removePlugins: manifest?.opencode?.plugin ?? [],
      addMcp: {},
      removeMcp: Object.keys((manifest?.opencode?.mcp ?? {}) as object),
      addAgents: {},
      removeAgents: Object.keys(manifest?.opencode?.agents ?? {}),
      addAgentTools: {},
      removeAgentTools: manifest?.opencode?.agentTools ?? {},
    }).catch(() => {})
  }
  if (applied.agentsMd) {
    await syncOpencodePlugin(user.id, {
      addPlugins: [],
      removePlugins: [],
      addMcp: {},
      removeMcp: [],
      addInstructions: [],
      removeInstructions: [pluginAgentsMdPath(pluginId)],
    }).catch(() => {})
    await syncPluginAgentsMd(user.id, pluginId, null).catch(() => {})
  }
}

export async function applyPluginUninstall(
  db: Db,
  user: User,
  row: InstalledPlugin,
) {
  // Best-effort environment cleanup before the managed artifacts disappear.
  const cleanup = (row.manifest as PluginManifest).setup?.uninstall ?? []
  if (cleanup.length > 0) {
    await runPluginInitCommands(
      user.id,
      row.pluginId,
      cleanup,
      "uninstall",
    ).catch(() => {})
  }
  await revertApplied(db, user, row.pluginId, row.applied)
  await syncPluginAuth(user.id, row.pluginId, null).catch(() => {})
  db.deleteInstalledPlugin(user.id, row.pluginId)
}

// Re-runs the manifest's root setup commands (visible + retryable path for a
// failed install/boot setup). Updates the applied init log either way.
export async function retryPluginSetup(
  db: Db,
  user: User,
  row: InstalledPlugin,
): Promise<PluginAppliedLog["init"]> {
  const manifest = row.manifest as PluginManifest
  const commands = manifest.setup?.commands ?? []
  if (commands.length === 0) {
    throw new Error("this plugin declares no setup commands")
  }
  const result = await runPluginInitCommands(
    user.id,
    row.pluginId,
    commands,
    "retry",
  )
  const init = initLogEntry(result) ?? row.applied.init
  if (init) {
    db.setInstalledPluginApplied(user.id, row.pluginId, {
      ...row.applied,
      init,
    })
  }
  if (!result.ok) {
    throw new Error(
      `setup failed${result.timedOut ? " (timed out)" : ""}: ${result.output.slice(-500)}`,
    )
  }
  return init
}

// Deep enable/disable. Beyond the OpenCode surfaces, a disabled plugin also
// pauses its cron jobs, unloads its skills from OpenViking, and drops its
// config file (which holds vault secrets). Enable restores all of it from the
// manifest snapshot stored on the installed row.
export async function setPluginEnabled(
  db: Db,
  user: User,
  row: InstalledPlugin,
  enable: boolean,
): Promise<InstalledPlugin> {
  const updated = db.setInstalledPluginEnabled(user.id, row.pluginId, enable)
  const manifest = row.manifest as PluginManifest
  const pluginId = row.pluginId

  for (const jobId of row.applied.cronJobIds) {
    const job = db.cronJobById(jobId, user.id)
    if (!job) continue
    if (enable && !job.enabled) {
      db.updateCronJob(jobId, user.id, {
        enabled: true,
        nextRunAt: nextRunMs(job),
      })
    } else if (!enable && job.enabled) {
      db.updateCronJob(jobId, user.id, { enabled: false })
    }
  }

  if ((manifest.skills?.length ?? 0) > 0) {
    try {
      const skills = await vikingSkills(user, db)
      if (enable) {
        const owned = new Set(row.applied.skills)
        const existingNames = new Set(
          (await skills.list().catch(() => [])).map((s) => s.name),
        )
        for (const skill of manifest.skills ?? []) {
          // Only skills this install created come back. If the name is taken
          // at enable time it is either our own (disable failed to remove it
          // — already correct) or a foreign skill (never clobber it).
          if (!owned.has(skill.name) || existingNames.has(skill.name)) continue
          await skills
            .save({
              name: skill.name,
              description: skill.description,
              body: skill.body,
            })
            .catch(() => {})
        }
      } else {
        for (const name of row.applied.skills) {
          await skills.remove(name).catch(() => {})
        }
      }
    } catch (error) {
      console.error(
        `plugin ${pluginId} skill ${enable ? "reload" : "unload"} failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }

  // The config file carries vault secrets; a disabled plugin loses it and
  // gets a fresh copy (from current settings + vault values) on enable.
  if (enable) {
    await reapplyPluginConfig(db, user, row).catch((error) => {
      console.error(
        `plugin ${pluginId} config restore failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    })
  } else {
    await syncPluginAuth(user.id, pluginId, null).catch((error) => {
      console.error(
        `plugin ${pluginId} config removal failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    })
  }

  const oc = manifest.opencode
  if (
    oc &&
    (oc.plugin?.length || oc.mcp || oc.agents || oc.agentTools || oc.agentsMd)
  ) {
    if (oc.agentsMd) {
      const instructions = pluginAgentsMdPath(pluginId)
      if (enable) {
        await syncPluginAgentsMd(user.id, pluginId, oc.agentsMd)
      }
      await syncOpencodePlugin(
        user.id,
        enable
          ? {
              addPlugins: [],
              removePlugins: [],
              addMcp: {},
              removeMcp: [],
              addInstructions: [instructions],
              removeInstructions: [],
            }
          : {
              addPlugins: [],
              removePlugins: [],
              addMcp: {},
              removeMcp: [],
              addInstructions: [],
              removeInstructions: [instructions],
            },
      )
    }
    if (oc.plugin?.length || oc.mcp || oc.agents || oc.agentTools) {
      const patch = enable
        ? {
            addPlugins: oc.plugin ?? [],
            removePlugins: [],
            addMcp: (oc.mcp ?? {}) as Record<string, unknown>,
            removeMcp: [],
            addAgents: oc.agents ?? {},
            removeAgents: [],
            addAgentTools: oc.agentTools ?? {},
            removeAgentTools: {},
          }
        : {
            addPlugins: [],
            removePlugins: oc.plugin ?? [],
            addMcp: {},
            removeMcp: Object.keys((oc.mcp ?? {}) as object),
            addAgents: {},
            removeAgents: Object.keys(oc.agents ?? {}),
            addAgentTools: {},
            removeAgentTools: oc.agentTools ?? {},
          }
      await syncOpencodePlugin(user.id, patch)
    }
    await restartOpencode(user.id).catch(() => {})
  }

  return updated ?? db.installedPlugin(user.id, pluginId) ?? row
}

export async function reapplyPluginConfig(
  db: Db,
  user: User,
  row: InstalledPlugin,
) {
  const manifest = row.manifest as PluginManifest
  const saved: Record<string, string> = {}
  for (const setting of db.pluginSettings(user.id, row.pluginId)) {
    saved[setting.key] = setting.value
  }
  const settings = pluginSettingsFor(manifest, saved)
  await syncPluginAuth(
    user.id,
    row.pluginId,
    pluginConfigPayload(db, user.id, manifest, settings),
  )
}

// Re-apply every enabled plugin after a desktop recreate: setup commands,
// then binary tools and payload files (fixes installs that ran while the
// desktop was asleep). Registered as the docker onDesktopReady hook; never
// throws.
export async function reapplyPluginSetup(db: Db, userId: string) {
  for (const row of db.installedPlugins(userId)) {
    if (!row.enabled) continue
    const manifest = row.manifest as PluginManifest
    const commands = manifest.setup?.commands ?? []
    if (commands.length > 0) {
      try {
        const result = await runPluginInitCommands(
          userId,
          row.pluginId,
          commands,
          "boot",
        )
        db.setInstalledPluginApplied(userId, row.pluginId, {
          ...row.applied,
          init: initLogEntry(result) ?? row.applied.init,
        })
        if (!result.ok) {
          console.error(
            `plugin ${row.pluginId} boot setup failed: ${result.output.slice(0, 500)}`,
          )
        }
      } catch (error) {
        console.error(
          `plugin ${row.pluginId} boot setup errored: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    const toolFiles = inlineToolFiles(manifest)
    if (toolFiles.length > 0) {
      await syncPluginTools(userId, row.pluginId, toolFiles).catch((error) => {
        console.error(
          `plugin ${row.pluginId} boot tool sync failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      })
    }
    if ((manifest.files?.length ?? 0) > 0) {
      try {
        const files =
          row.source === "local" && row.localPath
            ? await readLocalPluginFiles(userId, row.localPath, manifest)
            : await resolvePluginFiles(db, row.pluginId, row.version, manifest)
        await syncPluginTools(userId, row.pluginId, files)
      } catch (error) {
        console.error(
          `plugin ${row.pluginId} boot file sync failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    const agentsMd = manifest.opencode?.agentsMd
    if (agentsMd) {
      try {
        const wrote = await ensurePluginAgentsMd(userId, row.pluginId, agentsMd)
        await syncOpencodePlugin(userId, {
          addPlugins: [],
          removePlugins: [],
          addMcp: {},
          removeMcp: [],
          addInstructions: [pluginAgentsMdPath(row.pluginId)],
          removeInstructions: [],
        })
        if (wrote) await restartOpencode(userId).catch(() => {})
      } catch (error) {
        console.error(
          `plugin ${row.pluginId} boot agentsMd sync failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
  }
}
