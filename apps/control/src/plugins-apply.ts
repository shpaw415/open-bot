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
  prunePluginTools,
  removeAllPluginTools,
  removePluginTools,
  restartOpencode,
  runPluginInitCommands,
  syncOpencodePlugin,
  syncPluginAgentsMd,
  syncPluginAuth,
  syncPluginConfigGuide,
  syncPluginTools,
} from "./docker"
import { HttpError } from "./http-error"
import { extractPluginFiles, fetchPluginArtifact } from "./plugin-artifact"
import {
  readLocalPluginConfigGuide,
  readLocalPluginFiles,
} from "./plugin-local"
import {
  ensurePluginPageServer,
  type PluginPageStartStatus,
  removePluginPageLog,
  stopPluginPageServer,
} from "./plugin-pages"
import { createVikingSkills } from "./viking-skills"
import { vikingUserKey } from "./viking-user"

const INIT_OUTPUT_LIMIT = 8 * 1024

// OpenViking pathlocks are held briefly by a previous op; an immediate
// follow-up (remove → reinstall) can hit "lock acquire timed out". Retry the
// transient failures with a small backoff instead of failing the whole apply.
const VIKING_RETRY_DELAYS_MS = [300, 900]

function isTransientVikingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /lock|timed out|not reachable|ECONNREFUSED|50[234]/i.test(message)
}

export async function withVikingRetries<T>(
  run: () => Promise<T>,
  delays: number[] = VIKING_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      const delay = delays[attempt - 1]
      if (delay === undefined) throw lastError
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (!isTransientVikingError(error)) throw error
    }
  }
}

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

// Resolves the plugin's optional repo-root CONFIG.md (the agent-facing
// configuration guide): local installs read it from the checkout,
// marketplace installs extract it from the reviewed release tarball.
// Returns null when the plugin ships none.
async function resolveConfigGuide(
  db: Db,
  userId: string,
  source: "marketplace" | "local",
  localPath: string | null,
  pluginId: string,
  version: string,
): Promise<string | null> {
  if (source === "local") {
    return localPath ? readLocalPluginConfigGuide(userId, localPath) : null
  }
  try {
    const artifact = await fetchPluginArtifact(db, pluginId, version)
    const [extracted] = extractPluginFiles(artifact.tarballPath, [
      { name: "CONFIG.md", source: "CONFIG.md", exec: false },
    ])
    return extracted?.content ?? null
  } catch (error) {
    // A tarball without CONFIG.md is the normal no-guide case, and an
    // unconfigured marketplace just means no guides on this instance —
    // neither should fail (or even log) the install.
    if (
      error instanceof HttpError &&
      (error.code === "artifact_file" ||
        error.code === "marketplace_unconfigured")
    ) {
      return null
    }
    throw error
  }
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
): Promise<InstalledPlugin & { page: PluginPageStartStatus }> {
  const { manifest } = entry
  const existing = db.installedPlugin(user.id, manifest.id)
  const previous = existing?.applied
  const reusedPersonaIds: string[] = []
  const source = options.source === "local" ? "local" : "marketplace"
  const localPath = source === "local" ? (options.localPath ?? null) : null
  if (source === "local" && !localPath) {
    throw new Error("local install is missing a path")
  }
  // A running page server would keep serving the previous release's code
  // after an upgrade — stop it; the proxy lazily restarts the new binary.
  await stopPluginPageServer(user.id, manifest.id).catch(() => {})
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
      // Everything named `plugin:<id>:*` belongs to this plugin (including
      // jobs created outside apply, like the publish guard cron) — replace
      // stale leftovers instead of refusing the install.
      if (previousOwned) {
        db.deleteCronJob(previousOwned, user.id)
      } else {
        const clash = db.cronJobs(user.id).find((row) => row.name === name)
        if (clash) db.deleteCronJob(clash.id, user.id)
      }
      const id = crypto.randomUUID()
      // Manifest validation already enforces the message/script pairing; a
      // missing run means the classic prompt job.
      const runKind =
        job.run === "script" || job.run === "both" || job.run === "auto"
          ? job.run
          : ("prompt" as const)
      const row: CronJob = {
        id,
        userId: user.id,
        name,
        message: job.message ?? "",
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
        runKind,
        script: job.script ?? null,
      }
      row.nextRunAt = nextRunMs(row)
      db.createCronJob(row)
      applied.cronJobIds.push(id)
    }
    // An upgrade that drops a cron entry leaves the previous job behind, and
    // the fresh applied log no longer records it — delete previous-owned jobs
    // the new manifest no longer declares. Jobs created outside apply (the
    // publish guard cron) survive; uninstall sweeps those.
    for (const id of previous?.cronJobIds ?? []) {
      if (!applied.cronJobIds.includes(id) && db.cronJobById(id, user.id)) {
        db.deleteCronJob(id, user.id)
      }
    }

    if ((manifest.skills?.length ?? 0) > 0) {
      const skills = await vikingSkills(user, db)
      const owned = new Set(previous?.skills ?? [])
      const existing = new Map(
        (await withVikingRetries(() => skills.list())).map((s) => [
          s.name,
          s.description,
        ]),
      )
      for (const skill of manifest.skills ?? []) {
        const existingDescription = existing.get(skill.name)
        // Adopt a skill this plugin left behind (an install aborted before
        // the row landed writes the skill but records nothing): the manifest
        // declares the exact description, so a match means the orphan is
        // ours to replace.
        const ours =
          owned.has(skill.name) || existingDescription === skill.description
        if (existingDescription !== undefined && !ours) {
          throw new Error(
            `a skill named ${skill.name} already exists and was not created by this install — clear it with DELETE /api/v1/skills/${skill.name} on the desktop OpenViking (or uninstall the plugin that owns it), then retry`,
          )
        }
        await withVikingRetries(() =>
          skills.save({
            name: skill.name,
            description: skill.description,
            body: skill.body,
          }),
        )
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
    // Prune runs even when the new manifest declares no files: a renamed or
    // dropped files[] entry must not leave the old binary behind.
    await prunePluginTools(
      user.id,
      manifest.id,
      toolFiles.map((file) => file.name),
    )
    if (toolFiles.length > 0) {
      await syncPluginTools(user.id, manifest.id, toolFiles)
      for (const file of toolFiles) applied.tools.push(file.name)
    }

    const payload = pluginConfigPayload(db, user.id, manifest, wantedSettings)
    await syncPluginAuth(user.id, manifest.id, payload)

    // The CONFIG.md guide is a best-effort surface: a missing guide is normal,
    // and extraction/sync failures never fail the install (the boot re-sync
    // retries when the marker is set).
    try {
      const guide = await resolveConfigGuide(
        db,
        user.id,
        source,
        localPath,
        manifest.id,
        entry.version,
      )
      if (guide) {
        await syncPluginConfigGuide(user.id, manifest.id, guide).catch(
          (error) => {
            console.error(
              `plugin ${manifest.id} config guide write failed: ${
                error instanceof Error ? error.message : error
              }`,
            )
          },
        )
        applied.configGuide = true
      }
    } catch (error) {
      console.error(
        `plugin ${manifest.id} config guide extraction failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }

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
      await restartOpencode(user.id, { db }).catch(() => {})
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
  // Fresh installs with a page server boot it right away when the desktop is
  // up. The outcome rides on the response (port + health) so install output
  // is diagnosable; the proxy still lazily restarts on the first request.
  let page: PluginPageStartStatus = { attempted: false, running: false, port: null }
  if (manifest.dashboard?.pages) {
    const row = db.installedPlugin(user.id, manifest.id)
    if (row?.enabled) {
      page = { attempted: true, running: false, port: null }
      try {
        page.port = await ensurePluginPageServer(user.id, row)
        page.running = true
      } catch (error) {
        page.error = error instanceof Error ? error.message : String(error)
      }
    }
  }
  const row = db.installedPlugin(user.id, manifest.id)
  if (!row) throw new Error("plugin row disappeared after install")
  return { ...row, page }
}

export type PluginRevertResult = {
  leftoverSkills: string[]
}

async function revertApplied(
  db: Db,
  user: User,
  pluginId: string,
  applied: InstalledPlugin["applied"],
): Promise<PluginRevertResult> {
  for (const id of applied.personaIds) {
    const persona = db.personaById(id, user.id)
    if (persona) db.deletePersona(id, user.id)
  }
  for (const id of applied.cronJobIds) db.deleteCronJob(id, user.id)
  // Best-effort becomes verified: retry transient viking failures and report
  // anything that survived so the uninstall result can name the leftovers.
  const leftoverSkills: string[] = []
  if (applied.skills.length > 0) {
    const skills = await vikingSkills(user, db).catch(() => null)
    if (!skills) {
      leftoverSkills.push(...applied.skills)
    } else {
      for (const name of applied.skills) {
        try {
          await withVikingRetries(() => skills.remove(name))
        } catch {
          leftoverSkills.push(name)
        }
      }
    }
  }
  for (const slug of applied.keys) {
    const key = db.getUserKey(user.id, slug)
    if (key && key.apiKey === "") db.clearUserKey(user.id, slug)
  }
  if (applied.tools.length > 0) {
    await removePluginTools(user.id, pluginId, applied.tools).catch(() => {})
  }
  // Sweep the whole prefix too: renamed files[] entries from earlier versions
  // are not in applied.tools and would otherwise leak.
  await removeAllPluginTools(user.id, pluginId).catch(() => {})
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
  if (applied.configGuide) {
    await syncPluginConfigGuide(user.id, pluginId, null).catch(() => {})
  }
  return { leftoverSkills }
}

export async function applyPluginUninstall(
  db: Db,
  user: User,
  row: InstalledPlugin,
): Promise<PluginRevertResult> {
  // Best-effort environment cleanup before the managed artifacts disappear.
  await stopPluginPageServer(user.id, row.pluginId).catch(() => {})
  await removePluginPageLog(user.id, row.pluginId).catch(() => {})
  const cleanup = (row.manifest as PluginManifest).setup?.uninstall ?? []
  if (cleanup.length > 0) {
    await runPluginInitCommands(
      user.id,
      row.pluginId,
      cleanup,
      "uninstall",
    ).catch(() => {})
  }
  const { leftoverSkills } = await revertApplied(
    db,
    user,
    row.pluginId,
    row.applied,
  )
  // Jobs created outside apply (the publish guard cron, plugin tooling) are
  // owned by the `plugin:<id>:` name prefix — sweep them so remove→reinstall
  // never hits a "scheduled job already exists" clash.
  for (const job of db.cronJobs(user.id)) {
    if (job.name.startsWith(`plugin:${row.pluginId}:`)) {
      db.deleteCronJob(job.id, user.id)
    }
  }
  await syncPluginAuth(user.id, row.pluginId, null).catch(() => {})
  // Sweep the guide even when the applied log lost its marker (upgrades from
  // versions before CONFIG.md, partially failed installs).
  await syncPluginConfigGuide(user.id, row.pluginId, null).catch(() => {})
  db.deleteInstalledPlugin(user.id, row.pluginId)
  return { leftoverSkills }
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
    if (row.applied.configGuide) {
      try {
        const guide = await resolveConfigGuide(
          db,
          user.id,
          row.source,
          row.localPath,
          pluginId,
          row.version,
        )
        if (guide) await syncPluginConfigGuide(user.id, pluginId, guide)
      } catch (error) {
        console.error(
          `plugin ${pluginId} config guide restore failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    if (manifest.dashboard?.pages) {
      await ensurePluginPageServer(user.id, updated ?? row).catch(() => {
        // The proxy lazily restarts on the first request.
      })
    }
  } else {
    await stopPluginPageServer(user.id, pluginId).catch(() => {})
    await syncPluginAuth(user.id, pluginId, null).catch((error) => {
      console.error(
        `plugin ${pluginId} config removal failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    })
    await syncPluginConfigGuide(user.id, pluginId, null).catch((error) => {
      console.error(
        `plugin ${pluginId} config guide removal failed: ${
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
    await restartOpencode(user.id, { db }).catch(() => {})
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
  try {
    const wrote = await syncPluginAuth(
      user.id,
      row.pluginId,
      pluginConfigPayload(db, user.id, manifest, settings),
    )
    // false = the desktop is not running: the write never happened, so the
    // pending queue must keep the plugin for the next desktop-up flush. A
    // silent skip here is how a freshly saved shared vault key got rolled
    // back to its stale on-disk copy.
    if (!wrote) {
      throw new Error("desktop is not running — config sync deferred")
    }
    pendingConfigSyncs.delete(configSyncKey(user.id, row.pluginId))
  } catch (error) {
    markPendingConfigSync(user.id, row.pluginId)
    throw error
  }
}

// Config syncs that could not reach the desktop (asleep mid-save, transient
// docker-exec failure), flushed when the desktop next comes up so a shared
// vault key saved while the desktop slept is never left stale on disk.
const pendingConfigSyncs = new Map<string, number>()

function configSyncKey(userId: string, pluginId: string) {
  return `${userId}\0${pluginId}`
}

function markPendingConfigSync(userId: string, pluginId: string) {
  pendingConfigSyncs.set(configSyncKey(userId, pluginId), Date.now())
}

export function pendingPluginConfigSyncCount() {
  return pendingConfigSyncs.size
}

export function clearPendingPluginConfigSyncs() {
  pendingConfigSyncs.clear()
}

export async function flushPendingPluginConfigs(db: Db, userId: string) {
  const user = db.userById(userId)
  if (!user) {
    for (const key of [...pendingConfigSyncs.keys()]) {
      if (key.startsWith(`${userId}\0`)) pendingConfigSyncs.delete(key)
    }
    return
  }
  for (const key of [...pendingConfigSyncs.keys()]) {
    if (!key.startsWith(`${userId}\0`)) continue
    const pluginId = key.slice(userId.length + 1)
    pendingConfigSyncs.delete(key)
    const row = db.installedPlugin(userId, pluginId)
    if (!row || !row.enabled) continue
    try {
      await reapplyPluginConfig(db, user, row)
    } catch (error) {
      markPendingConfigSync(userId, pluginId)
      console.error(
        `plugin ${pluginId} deferred config sync failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }
}

export function pluginsForVaultSlug(
  rows: InstalledPlugin[],
  slug: string,
): InstalledPlugin[] {
  return rows.filter((row) => {
    if (!row.enabled) return false
    const manifest = row.manifest as PluginManifest
    return (manifest.permissions?.vaultRead ?? []).includes(slug)
  })
}

export async function resyncPluginsForVaultSlug(
  db: Db,
  user: User,
  slug: string,
) {
  const failed: string[] = []
  for (const row of pluginsForVaultSlug(db.installedPlugins(user.id), slug)) {
    try {
      await reapplyPluginConfig(db, user, row)
    } catch (error) {
      failed.push(row.pluginId)
      console.error(
        `plugin ${row.pluginId} vault re-sync failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }
  return failed
}

// Re-apply every enabled plugin after a desktop recreate: setup commands,
// then binary tools and payload files (fixes installs that ran while the
// desktop was asleep). Registered as the docker onDesktopReady hook; never
// throws.
export async function reapplyPluginSetup(db: Db, userId: string) {
  const user = db.userById(userId)
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
    try {
      await prunePluginTools(userId, row.pluginId, [
        ...inlineToolFiles(manifest).map((file) => file.name),
        ...(manifest.files ?? []).map((file) => file.name),
      ])
    } catch (error) {
      console.error(
        `plugin ${row.pluginId} boot tool prune failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
    if (row.applied.configGuide) {
      // Covers installs that ran while the desktop was asleep; the guide file
      // itself lives on the persistent /home volume.
      try {
        const guide = await resolveConfigGuide(
          db,
          userId,
          row.source,
          row.localPath,
          row.pluginId,
          row.version,
        )
        if (guide) await syncPluginConfigGuide(userId, row.pluginId, guide)
      } catch (error) {
        console.error(
          `plugin ${row.pluginId} boot config guide sync failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    if (
      user &&
      ((manifest.permissions?.vaultRead?.length ?? 0) > 0 ||
        (manifest.configs?.length ?? 0) > 0)
    ) {
      // The config file is the regen source for every settings/vault value a
      // plugin reads — rewriting it from the DB at boot heals any write that
      // missed the desktop (saved while asleep, transient exec failure), so a
      // shared vault slug can never stay stale on disk.
      try {
        await reapplyPluginConfig(db, user, row)
      } catch (error) {
        console.error(
          `plugin ${row.pluginId} boot config sync failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    if (manifest.dashboard?.pages) {
      // The desktop just (re)started; bring the page server back. Lazy proxy
      // restarts cover anything missed here.
      await ensurePluginPageServer(userId, row).catch((error) => {
        console.error(
          `plugin ${row.pluginId} boot page server failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      })
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
        if (wrote) await restartOpencode(userId, { db }).catch(() => {})
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
