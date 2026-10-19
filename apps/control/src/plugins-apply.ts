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
import { keyVaultSpecById } from "./key-vault"
import {
  connectMcpServers,
  disconnectMcpServers,
  readMcpConfig,
  validateMcpMap,
} from "./mcp"
import { skillCatalog } from "./personas"
import {
  extractPluginFiles,
  fetchPluginArtifact,
  PLUGIN_UI_FILE_NAME,
} from "./plugin-artifact"
import {
  readLocalPluginConfigGuide,
  readLocalPluginFiles,
} from "./plugin-local"
import { pluginOwnership } from "./plugin-ownership"
import {
  type PluginPageStartStatus,
  pluginPageRuntime,
  removePluginPageLog,
  restartPluginPageServer,
  stopPluginPageServer,
} from "./plugin-pages"
import { refreshMentionClashes } from "./references"
import { createVikingSkills } from "./viking-skills"
import { vikingUserKey } from "./viking-user"

const INIT_OUTPUT_LIMIT = 8 * 1024

// Non-blocking apply-time check: a declared persona skill name that resolves
// nowhere (desktop seed dir, OpenViking, or a plugin-installed skill), or an
// MCP server name that is not configured on the desktop, lands in
// applied.warnings on the install log. Never blocks — the name may be meant
// for a skill or server the user installs later.
async function personaSkillScopeWarnings(
  db: Db,
  user: User,
  manifest: PluginManifest,
): Promise<string[]> {
  const declared = (manifest.personas ?? []).filter(
    (persona) => persona.skills?.length || persona.mcp?.length,
  )
  if (declared.length === 0) return []
  const catalog = await skillCatalog(db, user.id)
  const known = new Set(catalog.skills.map((skill) => skill.name))
  for (const name of pluginOwnership(db, user.id).skillByName.keys())
    known.add(name)
  const warnings: string[] = []
  for (const persona of declared) {
    for (const name of persona.skills ?? []) {
      if (!known.has(name))
        warnings.push(
          `persona "${persona.name}" allows unknown skill "${name}"`,
        )
    }
    if (persona.mcp?.length) {
      const servers = new Set(
        Object.keys(await readMcpConfig(user.id).catch(() => ({}))),
      )
      for (const name of persona.mcp) {
        if (!servers.has(name))
          warnings.push(
            `persona "${persona.name}" allows unknown MCP server "${name}"`,
          )
      }
    }
  }
  return warnings
}

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
  // Both access levels reach the desktop config: a vaultCreate-only plugin
  // (the common case — the agent fills its own keys) reads the same
  // vault.<slug> section the skill docs promise, not just vaultRead plugins.
  const slugs = new Set([
    ...(manifest.permissions?.vaultCreate ?? []),
    ...(manifest.permissions?.vaultRead ?? []),
  ])
  if (slugs.size > 0) {
    const vault: Record<string, unknown> = {}
    for (const slug of slugs) {
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
// the reviewed release tarball from the marketplace. `userId` selects whose
// marketplace key the fetch rides (paid-plugin licenses). A manifest with
// dashboard.pages.ui additionally gets the bundled standalone HTML appended
// (PLUGIN_UI_FILE_NAME) — the frozen install then serves one self-contained
// file instead of needing relative frontend structure.
async function resolvePluginFiles(
  db: Db,
  userId: string,
  pluginId: string,
  version: string,
  manifest: PluginManifest,
): Promise<PluginToolFile[]> {
  const declared = manifest.files ?? []
  const ui = manifest.dashboard?.pages?.ui ?? null
  if (declared.length === 0 && !ui) return []
  const artifact = await fetchPluginArtifact(db, pluginId, version, userId)
  return extractPluginFiles(artifact.tarballPath, declared, ui)
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
    const artifact = await fetchPluginArtifact(db, pluginId, version, userId)
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
  // after an upgrade — stop it, then restart below. The was-running sample
  // must come first: the stop deletes the pid/port files the runtime probe
  // reads, so checking after the fact always sees "not running" and the
  // upgrade silently left the tab dead until a manual restart.
  const wasPageRunning = manifest.dashboard?.pages
    ? await pluginPageRuntime(user.id, manifest.id).catch(() => null)
    : null
  await stopPluginPageServer(user.id, manifest.id, undefined, true).catch(
    () => {},
  )
  const applied: PluginAppliedLog = {
    personaIds: [],
    cronJobIds: [],
    skills: [],
    keys: [],
    tools: [],
    opencode: false,
  }

  try {
    // Verify the release artifact BEFORE any state mutation: a failed or
    // tampered payload fetch must leave no personas/cron/skills behind (an
    // upgrade used to keep the rejected content while the row stayed stale).
    const payloadFiles =
      options.files !== undefined
        ? options.files
        : await resolvePluginFiles(
            db,
            user.id,
            manifest.id,
            entry.version,
            manifest,
          )

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

    const personaSkillWarnings = await personaSkillScopeWarnings(
      db,
      user,
      manifest,
    ).catch(() => [] as string[])

    for (const persona of manifest.personas ?? []) {
      const match = db
        .personas(user.id)
        .find((row) => row.name.toLowerCase() === persona.name.toLowerCase())
      if (match) {
        // Refresh the base lists only when this install created the persona
        // row: a name match can adopt a foreign persona, and its allowlists
        // are not ours to rewrite. skillsExtra/mcpExtra are the user's —
        // never touched here in either path.
        const owned = previous?.personaIds.includes(match.id)
        if (owned) {
          const current = db.personaById(match.id, user.id)
          if (
            persona.skills &&
            JSON.stringify(current?.skills) !== JSON.stringify(persona.skills)
          )
            db.updatePersona(match.id, user.id, { skills: persona.skills })
          if (
            persona.mcp &&
            JSON.stringify(current?.mcp) !== JSON.stringify(persona.mcp)
          )
            db.updatePersona(match.id, user.id, { mcp: persona.mcp })
        }
        reusedPersonaIds.push(match.id)
        continue
      }
      const id = crypto.randomUUID()
      db.createPersona({
        id,
        userId: user.id,
        name: persona.name,
        instruction: persona.instruction,
        skills: persona.skills ?? null,
        skillsExtra: null,
        mcp: persona.mcp ?? null,
        mcpExtra: null,
        createdAt: Date.now(),
      })
      applied.personaIds.push(id)
    }
    if (personaSkillWarnings.length > 0) applied.warnings = personaSkillWarnings

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
      // A same-named skill nobody else declares is ours to replace: an
      // install aborted before the row landed, a workaround that installed
      // the skill by hand, or a description rewrite between versions would
      // all hard-fail forever otherwise (remove cannot reclaim a skill the
      // install record never owned).
      const otherDeclared = new Set<string>()
      for (const other of db.installedPlugins(user.id)) {
        if (other.pluginId === manifest.id) continue
        const otherManifest = other.manifest as PluginManifest
        for (const otherSkill of otherManifest.skills ?? [])
          otherDeclared.add(otherSkill.name)
      }
      for (const skill of manifest.skills ?? []) {
        const existingDescription = existing.get(skill.name)
        // Adopt a skill this plugin left behind (an install aborted before
        // the row landed writes the skill but records nothing): the manifest
        // declares the exact description, so a match means the orphan is
        // ours to replace.
        const ours =
          owned.has(skill.name) ||
          existingDescription === skill.description ||
          !otherDeclared.has(skill.name)
        if (existingDescription !== undefined && !ours) {
          const owner = db
            .installedPlugins(user.id)
            .find((other) =>
              ((other.manifest as PluginManifest).skills ?? []).some(
                (otherSkill) => otherSkill.name === skill.name,
              ),
            )
          throw new Error(
            `a skill named ${skill.name} is already owned by the installed plugin ${owner?.pluginId ?? "another plugin"} — uninstall that plugin first, or rename the skill in this manifest, then retry`,
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
    let mcpStatus: Record<string, string> = {}
    if (
      opencode &&
      (opencode.plugin?.length ||
        opencode.mcp ||
        opencode.agents ||
        opencode.agentTools)
    ) {
      // Same entry rules the dashboard's MCP tab enforces — a bad manifest
      // shape fails the install with a clear error instead of merging a dead
      // entry into opencode.json.
      const mcpServers = validateMcpMap(opencode.mcp)
      await syncOpencodePlugin(user.id, {
        addPlugins: opencode.plugin ?? [],
        removePlugins: [],
        addMcp: mcpServers,
        removeMcp: [],
        addAgents: opencode.agents ?? {},
        removeAgents: [],
        addAgentTools: opencode.agentTools ?? {},
        removeAgentTools: {},
      })
      applied.opencode = true
      // Hot-connect the new servers into the running daemon: tools go live in
      // new threads immediately, without waiting for a restart the installing
      // agent's own busy turn would keep deferred.
      mcpStatus = await connectMcpServers(db, user.id, mcpServers)
      if (Object.keys(mcpStatus).length > 0) applied.mcp = mcpStatus
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
      // An MCP-only patch that fully live-connected skips the restart — the
      // daemon already runs the new servers, and the deferred kill would only
      // risk aborting the installing agent's turn for nothing.
      const restartNeeded =
        applied.agentsMd ||
        (opencode?.plugin?.length ?? 0) > 0 ||
        Object.keys(opencode?.agents ?? {}).length > 0 ||
        Object.keys(opencode?.agentTools ?? {}).length > 0 ||
        Object.values(mcpStatus).some((status) => status !== "connected")
      if (restartNeeded) await restartOpencode(user.id, { db }).catch(() => {})
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
  // Lazy lifecycle: installs never boot the page server — the first
  // dashboard/webhook request does. Only a server that was already running
  // (sampled before the stop above) restarts here so an upgrade picks up its
  // new code; the outcome still rides on the response (port + health) so
  // upgrade output stays diagnosable.
  let page: PluginPageStartStatus = {
    attempted: false,
    running: false,
    port: null,
  }
  if (manifest.dashboard?.pages && wasPageRunning?.running) {
    const row = db.installedPlugin(user.id, manifest.id)
    if (row?.enabled) {
      page = { attempted: true, running: false, port: null }
      try {
        page.port = await restartPluginPageServer(user.id, row)
        page.running = true
      } catch (error) {
        page.error = error instanceof Error ? error.message : String(error)
      }
    }
  }
  refreshMentionClashes(db, user.id)
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
    const mcpNames = Object.keys((manifest?.opencode?.mcp ?? {}) as object)
    await syncOpencodePlugin(user.id, {
      addPlugins: [],
      removePlugins: manifest?.opencode?.plugin ?? [],
      addMcp: {},
      removeMcp: mcpNames,
      addAgents: {},
      removeAgents: Object.keys(manifest?.opencode?.agents ?? {}),
      addAgentTools: {},
      removeAgentTools: manifest?.opencode?.agentTools ?? {},
    }).catch(() => {})
    // A running daemon keeps removed MCP servers until its next restart —
    // drop them live so uninstall stops the tools immediately.
    await disconnectMcpServers(db, user.id, mcpNames).catch(() => {})
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
  refreshMentionClashes(db, user.id)
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
    // Lazy lifecycle: enabling never boots the page server — the first
    // dashboard/webhook request does (the proxy ensures on demand).
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
    let mcpStatus: Record<string, string> = {}
    if (oc.plugin?.length || oc.mcp || oc.agents || oc.agentTools) {
      if (enable) {
        const mcpServers = validateMcpMap(oc.mcp)
        await syncOpencodePlugin(user.id, {
          addPlugins: oc.plugin ?? [],
          removePlugins: [],
          addMcp: mcpServers,
          removeMcp: [],
          addAgents: oc.agents ?? {},
          removeAgents: [],
          addAgentTools: oc.agentTools ?? {},
          removeAgentTools: {},
        })
        mcpStatus = await connectMcpServers(db, user.id, mcpServers)
      } else {
        const mcpNames = Object.keys((oc.mcp ?? {}) as object)
        await syncOpencodePlugin(user.id, {
          addPlugins: [],
          removePlugins: oc.plugin ?? [],
          addMcp: {},
          removeMcp: mcpNames,
          addAgents: {},
          removeAgents: Object.keys(oc.agents ?? {}),
          addAgentTools: {},
          removeAgentTools: oc.agentTools ?? {},
        })
        // A running daemon keeps removed servers until its next restart —
        // drop them live so disable stops the tools immediately.
        await disconnectMcpServers(db, user.id, mcpNames).catch(() => {})
      }
    }
    if (Object.keys(mcpStatus).length > 0) {
      db.setInstalledPluginApplied(user.id, pluginId, {
        ...row.applied,
        mcp: mcpStatus,
      })
    }
    // Skip the restart only for a pure enable whose MCP entries all went live
    // through the runtime connect above; everything else still needs one.
    const mcpFullyLive =
      enable &&
      Object.keys(mcpStatus).length > 0 &&
      Object.values(mcpStatus).every((status) => status === "connected")
    const otherSurfaces =
      (oc.plugin?.length ?? 0) > 0 ||
      Object.keys(oc.agents ?? {}).length > 0 ||
      Object.keys(oc.agentTools ?? {}).length > 0
    if (oc.agentsMd || otherSurfaces || !mcpFullyLive) {
      await restartOpencode(user.id, { db }).catch(() => {})
    }
  }

  refreshMentionClashes(db, user.id)
  return db.installedPlugin(user.id, pluginId) ?? updated ?? row
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
    // Both access levels: the config payload ships vault.<slug> for
    // vaultCreate-only plugins too, so a vault write must re-sync them.
    return (
      (manifest.permissions?.vaultRead ?? []).includes(slug) ||
      (manifest.permissions?.vaultCreate ?? []).includes(slug)
    )
  })
}

// Plugin-declared vault keys that are not shared provider slugs, merged into
// the Keys tab so every key on the account is managed in one place. Slugs a
// shared provider already owns (keyVaultSpecById) stay on the static catalog;
// duplicate declarations across plugins collapse into one entry.
export type PluginVaultKey = {
  slug: string
  pluginIds: string[]
  pluginNames: string[]
  access: "create" | "read"
  enabled: boolean
}

export function pluginVaultKeys(rows: InstalledPlugin[]): PluginVaultKey[] {
  const merged = new Map<
    string,
    PluginVaultKey & { creatable: Set<string>; enabledCount: number }
  >()
  for (const row of rows) {
    const manifest = row.manifest as PluginManifest
    const creatable = new Set(manifest.permissions?.vaultCreate ?? [])
    const slugs = new Set([
      ...creatable,
      ...(manifest.permissions?.vaultRead ?? []),
    ])
    for (const slug of slugs) {
      if (keyVaultSpecById(slug)) continue
      let entry = merged.get(slug)
      if (!entry) {
        entry = {
          slug,
          pluginIds: [],
          pluginNames: [],
          access: "read",
          enabled: false,
          creatable: new Set(),
          enabledCount: 0,
        }
        merged.set(slug, entry)
      }
      if (!entry.pluginIds.includes(row.pluginId)) {
        entry.pluginIds.push(row.pluginId)
        entry.pluginNames.push(manifest.name || row.pluginId)
      }
      if (creatable.has(slug)) entry.creatable.add(row.pluginId)
      if (row.enabled) entry.enabledCount += 1
    }
  }
  return [...merged.values()].map(({ creatable, enabledCount, ...rest }) => ({
    ...rest,
    access: creatable.size > 0 ? ("create" as const) : ("read" as const),
    enabled: enabledCount > 0,
  }))
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
            : await resolvePluginFiles(
                db,
                userId,
                row.pluginId,
                row.version,
                manifest,
              )
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
        // The built dashboard UI is synced above for marketplace installs;
        // local checkouts import the HTML live and sync no ui.html (keeping
        // the name would be harmless, but pruning it is cleaner on flip).
        ...(row.source !== "local" && manifest.dashboard?.pages?.ui
          ? [PLUGIN_UI_FILE_NAME]
          : []),
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
    // Lazy lifecycle: boot never pre-starts page servers. Servers idle out
    // after five quiet minutes; the first dashboard/webhook request after a
    // desktop restart boots them again on demand.
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
