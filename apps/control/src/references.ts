import type { CronJob, Db, User } from "@open-bot/db"
import { endpoint } from "./docker"
import { listPersonas } from "./personas"
import { slugifyName } from "./projects"
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
    hint: `load with openviking_read on viking://user/skills/${skill.name}/SKILL.md; replace with PUT http://viking:1933/api/v1/skills/${skill.name}`,
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

function cronDetail(job: CronJob): string {
  const schedule =
    job.kind === "cron"
      ? `cron "${job.cronExpr ?? ""}" (UTC)`
      : job.kind === "every"
        ? `every ${job.everySeconds ?? 0}s`
        : `one-off at ${job.atMs ? new Date(job.atMs).toISOString() : "?"}`
  return `${job.enabled ? "enabled" : "paused"}, ${schedule}`
}

const referencePattern = /(?<=^|\s)@([a-z][a-z0-9_-]*)\/([^\n@]*)/gi

export function extractReferences(text: string): RefToken[] {
  const tokens: RefToken[] = []
  for (const match of text.matchAll(
    new RegExp(referencePattern.source, "gi"),
  )) {
    const section = (match[1] ?? "").toLowerCase()
    const query = (match[2] ?? "").trim()
    if (!query || !refSections[section]) continue
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
  const tokens = extractReferences(text)
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
      const sectionDef = refSections[section]
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
    const label = refSectionLabels[section] ?? section
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
        lines.push(
          `- ${token} → ambiguous; several ${label}s match: ${match.names.join(", ")}. Ask which one.`,
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
