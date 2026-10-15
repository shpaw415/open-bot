import type { CronJob, Db, InstalledPlugin, User } from "@open-bot/db"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { RESERVED_MENTION_SECTIONS, SLUG_PATTERN } from "@open-bot/plugin-kit"
import { endpoint } from "./docker"
import { listPersonas } from "./personas"
import { pluginPageJson } from "./plugin-pages"
import { slugifyName } from "./projects"
import { desktopReports, summarizeByPlugin } from "./reports"
import { createVikingSkills } from "./viking-skills"
import { vikingUserKey } from "./viking-user"

export type RefItem = {
  id: string
  name: string
  detail: string
  hint: string
  /** Extra names this item answers to (exact/partial/embedded like name). */
  aliases?: string[]
}

export type RefSection = {
  items: (db: Db, userId: string) => Promise<RefItem[]>
}

export type RefMatch =
  | { status: "found"; item: RefItem }
  | { status: "ambiguous"; names: string[] }
  | { status: "missing"; reportQuery?: string }

export type RefToken = { section: string; query: string }

export const refSectionLabels: Record<string, string> = {
  personas: "persona",
  cron: "cron job",
  skills: "skill",
  projects: "project",
  reports: "plugin report",
  report: "plugin report",
  plugins: "plugin",
  plugin: "plugin",
}
async function skillItems(db: Db, userId: string): Promise<RefItem[]> {
  const desktop = db.desktop(userId)
  if (!desktop) return []
  const base = await endpoint(userId, "viking", 1933)
  const client = createVikingSkills(base, vikingUserKey(desktop.vikingKey))
  const skills = await client.list()
  return skills.map((skill) => ({
    id: skill.name,
    name: skill.name,
    detail: `custom skill: ${skill.description}`,
    hint: `load with openviking_read on viking://user/skills/${skill.name}/SKILL.md; replace by DELETE http://viking:1933/api/v1/skills/${skill.name} then POST /api/v1/skills (PUT can hang)`,
  }))
}

export const refSections: Record<string, RefSection> = {
  personas: {
    items: async (db, userId) =>
      listPersonas(db, userId).map((persona) => ({
        id: persona.id,
        name: persona.name,
        detail: persona.builtin
          ? "built-in persona"
          : `custom persona: ${compact(persona.instruction)}`,
        hint: persona.builtin
          ? "reference only; built-in personas cannot be edited"
          : `edit with ob-persona update ${persona.id} [--name NAME] [--instruction TEXT], remove with ob-persona remove ${persona.id}`,
      })),
  },
  cron: {
    items: async (db, userId) =>
      db.cronJobs(userId).map((job) => ({
        id: job.id,
        name: job.name,
        detail: cronDetail(job),
        hint: `manage with ob-cron (job id ${job.id})`,
      })),
  },
  skills: { items: skillItems },
  projects: {
    items: projectItems,
  },
  // "@project/<name>" (singular) resolves the same list as "@projects/<name>"
  project: { items: projectItems },
  reports: { items: reportItems },
  // "@report/<name>" (singular) resolves the same list as "@reports/<name>"
  report: { items: reportItems },
  plugins: { items: pluginItems },
  // "@plugin/<name>" (singular) resolves the same list as "@plugins/<name>"
  plugin: { items: pluginItems },
}

async function projectItems(db: Db, userId: string): Promise<RefItem[]> {
  return db.projects(userId).map((project) => {
    const aliases = new Set<string>()
    const base = project.path.replace(/\/+$/g, "").split("/").pop() ?? ""
    if (base) aliases.add(base)
    const slug = slugifyName(project.name)
    if (slug) aliases.add(slug)
    aliases.delete(project.name)
    return {
      id: project.id,
      name: project.name,
      aliases: [...aliases],
      detail: `project directory ${project.path}`,
      hint: `the project root directory is ${project.path} in the desktop container; create, read and edit files there`,
    }
  })
}

function compact(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * One mention item per plugin slug that has reports on the desktop. Fails
 * (→ "list unavailable") when the desktop is down or its image predates
 * ob-report, so the agent is never told to run a CLI that does not exist.
 */
export async function reportItems(_db: Db, userId: string): Promise<RefItem[]> {
  const reports = await desktopReports(userId, { status: "all" })
  return summarizeByPlugin(reports).map((summary) => ({
    id: summary.plugin,
    name: summary.plugin,
    detail: `${summary.open} open plugin report${summary.open === 1 ? "" : "s"} (${summary.total} total) for ${summary.plugin} on this desktop`,
    hint: `list with ob-report list --plugin ${summary.plugin} --status open, read one with ob-report show ID, close a fixed one with ob-report done ID --note "..."; reports are the plugin development queue shared by every thread on this desktop`,
  }))
}

function cronDetail(job: CronJob): string {
  const schedule =
    job.kind === "cron"
      ? `cron "${job.cronExpr ?? ""}" (UTC)`
      : job.kind === "every"
        ? `every ${job.everySeconds ?? 0}s`
        : `one-off at ${job.atMs ? new Date(job.atMs).toISOString() : "?"}`
  return `${job.enabled ? "enabled" : "paused"}, ${schedule}`
}

/**
 * One mention item per installed plugin. Control-DB only, so it answers even
 * when the desktop is asleep; the stored manifest carries the friendly name
 * and description the agent matches against.
 */
export async function pluginItems(db: Db, userId: string): Promise<RefItem[]> {
  return db.installedPlugins(userId).map((row) => {
    const manifestName =
      typeof row.manifest.name === "string" ? row.manifest.name : ""
    const description =
      typeof row.manifest.description === "string"
        ? row.manifest.description
        : ""
    const name = manifestName || row.pluginId
    const aliases = new Set<string>([row.pluginId])
    const slug = slugifyName(name)
    if (slug) aliases.add(slug)
    aliases.delete(name)
    const source =
      row.source === "local"
        ? `local install${row.localPath ? ` from ${row.localPath}` : ""}`
        : "marketplace"
    const detail = `"${name}" v${row.version}, ${row.enabled ? "enabled" : "disabled"}, ${source}${description ? ` — ${compact(description)}` : ""}`
    const hint = row.enabled
      ? `update with ob-plugin update ${row.pluginId}, disable with ob-plugin disable ${row.pluginId}, remove with ob-plugin remove ${row.pluginId}; configure with ob-plugin settings ${row.pluginId} KEY=VALUE and read its setup guide with ob-plugin guide ${row.pluginId}`
      : `currently disabled — enable with ob-plugin enable ${row.pluginId}, remove with ob-plugin remove ${row.pluginId}; its setup guide is ob-plugin guide ${row.pluginId}`
    return {
      id: row.pluginId,
      name,
      aliases: [...aliases],
      detail,
      hint,
    }
  })
}

const referencePattern = /(?<=^|\s)@([a-z][a-z0-9_-]*)\/([^\n@]*)/gi

// --- Plugin-declared dynamic mention sections (@<section>/<name>) ---------
// A plugin's manifest declares dashboard.mentions entries; its page server
// (dashboard.pages.entry) serves the live entry list as JSON. The composer
// reads the same list through the /api/pages proxy; this side resolves
// @section/name into the "Message references:" line at send time.

export type PluginMentionBinding = {
  row: InstalledPlugin
  section: string
  label: string
  path: string
}

export type MentionClash = { section: string; owner: string }

type PluginMentionPayload = {
  items?: {
    name?: unknown
    description?: unknown
    aliases?: unknown
    hint?: unknown
  }[]
}

const MENTION_FETCH_TIMEOUT_MS = 3000
const MENTION_CACHE_TTL_MS = 5000
const MENTION_MAX_ITEMS = 100
const MENTION_MAX_NAME = 80
const MENTION_MAX_TEXT = 200
const MENTION_MAX_ALIASES = 5
const MENTION_MAX_ALIAS = 40

function mentionText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function mentionDecl(
  mention: { section?: string; label?: string; path?: string } | undefined,
): { section: string; label: string; path: string } | null {
  const section = typeof mention?.section === "string" ? mention.section : ""
  if (!section || !SLUG_PATTERN.test(section)) return null
  if (RESERVED_MENTION_SECTIONS.has(section) || refSections[section])
    return null
  const label =
    typeof mention?.label === "string" && mention.label.trim()
      ? mention.label
      : section
  const path =
    typeof mention?.path === "string" && mention.path.startsWith("/")
      ? mention.path
      : "/mentions"
  return { section, label, path }
}

/**
 * Enabled plugins' mention claims, plus the sections a later plugin lost to
 * an earlier one. First enabled install wins. Reserved slugs are ignored.
 * Control-DB only, so it answers while the desktop sleeps.
 */
export function pluginMentionClaims(
  db: Db,
  userId: string,
): { bindings: PluginMentionBinding[]; clashes: Map<string, MentionClash[]> } {
  const claimed = new Map<string, PluginMentionBinding>()
  const clashes = new Map<string, MentionClash[]>()
  for (const row of db.installedPlugins(userId)) {
    if (!clashes.has(row.pluginId)) clashes.set(row.pluginId, [])
    if (!row.enabled) continue
    const manifest = row.manifest as PluginManifest
    if (!manifest.dashboard?.pages) continue
    for (const mention of manifest.dashboard.mentions ?? []) {
      const decl = mentionDecl(mention)
      if (!decl) continue
      const owner = claimed.get(decl.section)
      if (owner) {
        if (owner.row.pluginId !== row.pluginId) {
          clashes.get(row.pluginId)?.push({
            section: decl.section,
            owner: owner.row.pluginId,
          })
        }
        continue
      }
      claimed.set(decl.section, { row, ...decl })
    }
  }
  return { bindings: [...claimed.values()], clashes }
}

export function pluginMentionBindings(
  db: Db,
  userId: string,
): PluginMentionBinding[] {
  return pluginMentionClaims(db, userId).bindings
}

/** Rewrite each installed row's clash warning so the Plugins tab stays current. */
export function refreshMentionClashes(db: Db, userId: string) {
  const { clashes } = pluginMentionClaims(db, userId)
  for (const row of db.installedPlugins(userId)) {
    const next = clashes.get(row.pluginId) ?? []
    const prev = row.applied.mentionClashes ?? []
    if (JSON.stringify(prev) === JSON.stringify(next)) continue
    db.setInstalledPluginApplied(userId, row.pluginId, {
      ...row.applied,
      mentionClashes: next.length ? next : undefined,
    })
  }
}

// Tiny TTL cache so keystroke bursts (popup open per @) and a busy turn with
// several mentions do not hammer the page server. Failures are not cached.
const mentionCache = new Map<string, { items: RefItem[]; at: number }>()

async function pluginMentionItems(
  userId: string,
  binding: PluginMentionBinding,
): Promise<RefItem[]> {
  const cacheKey = `${userId}\0${binding.row.pluginId}\0${binding.path}`
  const hit = mentionCache.get(cacheKey)
  const now = Date.now()
  if (hit && now - hit.at < MENTION_CACHE_TTL_MS) return hit.items
  const payload = await pluginPageJson<PluginMentionPayload>(
    userId,
    binding.row,
    binding.path,
    MENTION_FETCH_TIMEOUT_MS,
  )
  const raw = Array.isArray(payload?.items) ? payload.items : []
  const items: RefItem[] = []
  for (const entry of raw.slice(0, MENTION_MAX_ITEMS)) {
    const name = mentionText(entry?.name, MENTION_MAX_NAME)
    if (!name) continue
    const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
      .map((alias) => mentionText(alias, MENTION_MAX_ALIAS))
      .filter(Boolean)
      .slice(0, MENTION_MAX_ALIASES)
    const description = mentionText(entry?.description, MENTION_MAX_TEXT)
    items.push({
      id: name,
      name,
      aliases: aliases.length ? aliases : undefined,
      detail: description
        ? `${description} — served live by the ${binding.row.pluginId} plugin`
        : `entry served live by the ${binding.row.pluginId} plugin`,
      hint:
        mentionText(entry?.hint, MENTION_MAX_TEXT) ||
        `work with it through the ${binding.row.pluginId} plugin's tools, skills or dashboard page`,
    })
  }
  mentionCache.set(cacheKey, { items, at: now })
  return items
}

export function extractReferences(
  text: string,
  extraSections?: Set<string>,
): RefToken[] {
  const tokens: RefToken[] = []
  for (const match of text.matchAll(
    new RegExp(referencePattern.source, "gi"),
  )) {
    const section = (match[1] ?? "").toLowerCase()
    const query = (match[2] ?? "").trim()
    if (!query) continue
    if (!refSections[section] && !extraSections?.has(section)) continue
    tokens.push({ section, query })
  }
  return tokens
}

const nameBoundary = /[\s,.;:!?)\]}]/

function tryMatch(items: RefItem[], candidate: string): RefMatch | null {
  const lower = candidate.toLowerCase()
  if (!lower) return null
  const namesOf = (item: RefItem): string[] => [
    item.name,
    ...(item.aliases ?? []),
  ]
  const exact = items.find((item) =>
    namesOf(item).some((name) => name.toLowerCase() === lower),
  )
  if (exact) return { status: "found", item: exact }
  const matchesName = (item: RefItem, test: (name: string) => boolean) =>
    namesOf(item).some(test)
  const partial = items.filter((item) =>
    matchesName(item, (name) => name.toLowerCase().startsWith(lower)),
  )
  const only = partial.length === 1 ? partial[0] : undefined
  if (only) return { status: "found", item: only }
  if (partial.length > 1)
    return { status: "ambiguous", names: partial.map((item) => item.name) }
  const embedded = items
    .filter((item) =>
      matchesName(item, (name) => {
        const nameLower = name.toLowerCase()
        if (!lower.startsWith(nameLower)) return false
        const next = candidate.slice(nameLower.length, nameLower.length + 1)
        return next === "" || nameBoundary.test(next)
      }),
    )
    .sort((a, b) => b.name.length - a.name.length)
  const best = embedded[0]
  return best ? { status: "found", item: best } : null
}

export function matchRefItem(items: RefItem[], query: string): RefMatch {
  const trimmed = query.trim()
  if (!trimmed) return { status: "missing" }
  const full = tryMatch(items, trimmed)
  if (full) return full
  const first = trimmed.split(/\s+/)[0] ?? trimmed
  if (first !== trimmed) {
    const short = tryMatch(items, first)
    if (short) return short
    return { status: "missing", reportQuery: first }
  }
  return { status: "missing", reportQuery: trimmed }
}

export async function resolveReferenceLine(
  db: Db,
  user: User,
  text: string,
): Promise<string> {
  if (!text.includes("@")) return ""
  const bindings = pluginMentionBindings(db, user.id)
  const sections: Record<string, RefSection> = { ...refSections }
  const labels: Record<string, string> = { ...refSectionLabels }
  for (const binding of bindings) {
    sections[binding.section] = {
      items: () => pluginMentionItems(user.id, binding),
    }
    labels[binding.section] = binding.label
  }
  const tokens = extractReferences(text, new Set(Object.keys(sections)))
  if (!tokens.length) return ""
  const grouped = new Map<string, string[]>()
  for (const token of tokens) {
    const queries = grouped.get(token.section) ?? []
    if (
      !queries.some((item) => item.toLowerCase() === token.query.toLowerCase())
    )
      queries.push(token.query)
    grouped.set(token.section, queries)
  }
  const itemsBySection = new Map<string, RefItem[] | "error">()
  await Promise.all(
    [...grouped.keys()].map(async (section) => {
      const sectionDef = sections[section]
      if (!sectionDef) {
        itemsBySection.set(section, [])
        return
      }
      try {
        itemsBySection.set(section, await sectionDef.items(db, user.id))
      } catch {
        itemsBySection.set(section, "error")
      }
    }),
  )
  const seen = new Set<string>()
  const lines: string[] = []
  for (const [section, queries] of grouped) {
    const items = itemsBySection.get(section)
    const label = labels[section] ?? section
    for (const query of queries) {
      const token = `@${section}/${query}`
      if (items === "error") {
        lines.push(`- ${token} → the ${label} list is unavailable right now`)
        continue
      }
      if (!items) continue
      const match = matchRefItem(items, query)
      const dedupeKey =
        match.status === "found"
          ? `${section}:${match.item.id}`
          : `${section}:${query.toLowerCase()}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      if (match.status === "found") {
        lines.push(
          `- ${token} → ${label} "${match.item.name}" (id ${match.item.id}): ${compact(match.item.detail)}. ${match.item.hint}`,
        )
      } else if (match.status === "ambiguous") {
        const plural = /s$/i.test(label) ? label : `${label}s`
        lines.push(
          `- ${token} → ambiguous; several ${plural} match: ${match.names.join(", ")}. Ask which one.`,
        )
      } else {
        const reported =
          match.status === "missing" ? (match.reportQuery ?? query) : query
        lines.push(
          `- ${token} → no ${label} named "${reported}". Offer to create one if that seems intended.`,
        )
      }
    }
  }
  if (!lines.length) return ""
  return [
    "Message references:",
    ...lines,
    "The ids above are exact; use them instead of guessing by name. Leave the @section/name text in the user's message untouched.",
  ].join("\n")
}
