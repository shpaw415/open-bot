import type { Db, PluginAppliedLog } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"

export type PluginOrigin = {
  id: string
  name: string
}

export type PluginOwnership = {
  personaById: Map<string, PluginOrigin>
  skillByName: Map<string, PluginOrigin>
  cronByPluginId: Map<string, PluginOrigin>
}

const CRON_PREFIX = /^plugin:([^:]+):/

// Cron jobs a plugin owns are named `plugin:<pluginId>:<job>` — including jobs
// created outside apply, like the publish guard cron.
export function cronOwnedPluginId(name: string): string | null {
  return CRON_PREFIX.exec(name)?.[1] ?? null
}

function origin(row: {
  pluginId: string
  manifest: Record<string, unknown>
}): PluginOrigin {
  const name = (row.manifest as PluginManifest).name
  return {
    id: row.pluginId,
    name: typeof name === "string" && name ? name : row.pluginId,
  }
}

// Computes plugin provenance for personas, skills, and cron jobs at read time
// from records that already exist — the installed_plugins applied logs and the
// `plugin:<id>:` cron name prefix — so nothing new is stored and an open-bot
// update cannot lose it.
export function pluginOwnership(db: Db, userId: string): PluginOwnership {
  const ownership: PluginOwnership = {
    personaById: new Map(),
    skillByName: new Map(),
    cronByPluginId: new Map(),
  }
  for (const row of db.installedPlugins(userId)) {
    const plugin = origin(row)
    const applied: PluginAppliedLog = row.applied
    for (const id of applied.personaIds) ownership.personaById.set(id, plugin)
    for (const name of applied.skills) ownership.skillByName.set(name, plugin)
    ownership.cronByPluginId.set(row.pluginId, plugin)
  }
  return ownership
}

// Only badge jobs whose prefix resolves to an installed plugin; uninstall
// sweeps prefixed jobs, so a miss means the job was created outside a plugin.
export function pluginOriginForCronJob(
  ownership: PluginOwnership,
  jobName: string,
): PluginOrigin | null {
  const pluginId = cronOwnedPluginId(jobName)
  if (!pluginId) return null
  return ownership.cronByPluginId.get(pluginId) ?? null
}
