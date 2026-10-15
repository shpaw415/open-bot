export type SkillSummary = {
  name: string
  description: string
}

export type RefItemView = {
  id: string
  name: string
  description?: string
  /** Desktop path (projects); also feeds slug/path-basename alias matching. */
  path?: string
}

export type RefSectionView = {
  key: string
  label: string
  items: RefItemView[]
}

export type MentionState = {
  stage: "section" | "name"
  section: string
  query: string
  start: number
}

export type Suggestion = {
  key: string
  primary: string
  secondary: string
  complete: string
}

/** "@project/…" (singular) opens the same picker and resolves like "@projects/…". */
export function normalizeSectionKey(section: string): string {
  if (section === "project") return "projects"
  if (section === "report") return "reports"
  if (section === "plugin") return "plugins"
  return section
}

const singularKeys: Record<string, string> = {
  projects: "project",
  reports: "report",
  plugins: "plugin",
}

function sectionPattern(sections: RefSectionView[]): RegExp {
  const forms = new Set<string>()
  for (const section of sections) {
    forms.add(section.key)
    const singular = singularKeys[section.key]
    if (singular) forms.add(singular)
  }
  const alternation = [...forms].sort((a, b) => b.length - a.length).join("|")
  return new RegExp(`@(${alternation})/([^\\n@]*)`, "gi")
}

export function detectMention(
  text: string,
  caret: number,
  sections: RefSectionView[],
): MentionState | null {
  const end = Math.max(0, Math.min(caret, text.length))
  let anchor = -1
  for (let i = end - 1; i >= 0; i -= 1) {
    const char = text[i]
    if (char === "\n") return null
    if (char === "@") {
      const prev = i === 0 ? " " : text[i - 1]
      if (prev === " " || prev === "\t") anchor = i
      break
    }
  }
  if (anchor < 0) return null
  const token = text.slice(anchor + 1, end)
  const slash = token.indexOf("/")
  if (slash < 0) {
    if (/\s/.test(token)) return null
    return { stage: "section", section: "", query: token, start: anchor }
  }
  const section = normalizeSectionKey(token.slice(0, slash).toLowerCase())
  const def = sections.find((item) => item.key === section)
  if (!def) return null
  const query = token.slice(slash + 1)
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    // "@projects/" opens the picker; a stray trailing space closes it again
    return query ? null : { stage: "name", section, query, start: anchor }
  }
  // names stay matchable across spaces; only a finished mention (exact name
  // followed by whitespace) or a dead-end spaced query closes the flow
  const names = sectionItemNames(def)
  const spaced = /\s/.test(query)
  if (spaced && names.has(trimmed) && /\s$/.test(query)) return null
  let prefixMatch = false
  for (const name of names) {
    if (name.startsWith(trimmed)) {
      prefixMatch = true
      break
    }
  }
  if (!prefixMatch && spaced) return null
  return { stage: "name", section, query, start: anchor }
}

export function slugifyName(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
  return slug || null
}

/** Names an item answers to: display name, path basename and slugified name. */
function itemNames(item: RefItemView): string[] {
  const names = [item.name]
  const base = item.path?.replace(/\/+$/g, "").split("/").pop() ?? ""
  if (base && base.toLowerCase() !== item.name.toLowerCase()) names.push(base)
  const slug = slugifyName(item.name)
  if (slug && slug.toLowerCase() !== item.name.toLowerCase()) names.push(slug)
  return names
}

function sectionItemNames(section: RefSectionView): Set<string> {
  const names = new Set<string>()
  for (const item of section.items)
    for (const name of itemNames(item)) names.add(name.toLowerCase())
  return names
}

export type ProjectRefItem = {
  name: string
  path?: string
}

export type ReferenceToken = {
  section: string
  start: number
  end: number
  /** Matched item name; empty when nothing known matches. */
  name: string
  path?: string
}

const nameBoundary = /[\s,.;:!?)\]}]/

/**
 * Locate `@<section>/<name>` tokens across every known section for the
 * composer overlay. Mirrors the control-plane matcher: longest known name
 * (or slug/path-basename alias) wins (exact or boundary-terminated prefix),
 * else the first word (unique prefix match); unmatched tokens still return
 * a span ending at the first word so the UI can flag them.
 */
export function findReferenceTokens(
  text: string,
  sections: RefSectionView[],
): ReferenceToken[] {
  if (!sections.length) return []
  const tokens: ReferenceToken[] = []
  for (const match of text.matchAll(sectionPattern(sections))) {
    const start = match.index ?? 0
    const prev = start > 0 ? (text[start - 1] ?? "") : ""
    if (start > 0 && !/\s/.test(prev)) continue
    const section = normalizeSectionKey((match[1] ?? "").toLowerCase())
    const def = sections.find((item) => item.key === section)
    if (!def) continue
    const remainder = match[2] ?? ""
    if (!remainder.trim()) continue
    const prefixLength = match[0].length - remainder.length
    const matched = matchItemName(remainder, def.items)
    tokens.push({
      section,
      start,
      end: start + prefixLength + matched.length,
      name: matched.name,
      path: matched.path,
    })
  }
  return tokens
}

/** Bubble-renderer helper: only project tokens become `#project-ref/…` links. */
export function findProjectReferenceTokens(
  text: string,
  projects: ProjectRefItem[],
): ReferenceToken[] {
  return findReferenceTokens(text, [
    {
      key: "projects",
      label: "Projects",
      items: projects.map((project) => ({
        id: project.name,
        name: project.name,
        path: project.path,
      })),
    },
  ]).filter((token) => token.section === "projects")
}

function matchItemName(
  remainder: string,
  items: RefItemView[],
): { name: string; length: number; path?: string } {
  const leading = remainder.length - remainder.trimStart().length
  const lower = remainder.toLowerCase()
  const entries: { match: string; name: string; path?: string }[] = []
  for (const item of items) {
    for (const name of itemNames(item)) {
      entries.push({
        match: name.toLowerCase(),
        name: item.name,
        path: item.path,
      })
    }
  }
  entries.sort((a, b) => b.match.length - a.match.length)
  for (const entry of entries) {
    if (!entry.match) continue
    if (lower === entry.match)
      return {
        name: entry.name,
        length: leading + entry.match.length,
        path: entry.path,
      }
    if (lower.startsWith(entry.match)) {
      const next = remainder.slice(
        leading + entry.match.length,
        leading + entry.match.length + 1,
      )
      if (!next || nameBoundary.test(next))
        return {
          name: entry.name,
          length: leading + entry.match.length,
          path: entry.path,
        }
    }
  }
  const firstWord = remainder.trim().split(/\s+/)[0] ?? ""
  if (firstWord) {
    const wordLower = firstWord.toLowerCase()
    const partial = items.filter((item) =>
      itemNames(item).some((name) => name.toLowerCase().startsWith(wordLower)),
    )
    if (partial.length === 1)
      return {
        name: partial[0].name,
        length: leading + firstWord.length,
        path: partial[0].path,
      }
  }
  return { name: "", length: leading + firstWord.length }
}

function levenshteinWithin(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev: number[] = []
  for (let j = 0; j <= b.length; j += 1) prev.push(j)
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
      const deletion = (prev[j] ?? max + 1) + 1
      const insertion = (current[j - 1] ?? max + 1) + 1
      const substitution = (prev[j - 1] ?? max + 1) + cost
      const value = Math.min(deletion, insertion, substitution)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prev = current
  }
  return prev[b.length] ?? max + 1
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  if (t.includes(q)) return 600 - t.length
  const allowed = q.length <= 4 ? 1 : 2
  const prefixDistance = levenshteinWithin(q, t.slice(0, q.length), allowed)
  if (prefixDistance <= allowed) return 500 - prefixDistance * 100 - q.length
  const distance = levenshteinWithin(q, t, allowed)
  if (distance <= allowed) return 400 - distance * 100 - t.length
  return -1
}

export function matchSuggestions<T>(
  options: T[],
  query: string,
  text: (option: T) => string,
  limit = 8,
): T[] {
  const scored: { option: T; score: number }[] = []
  for (const option of options) {
    const score = fuzzyScore(query, text(option))
    if (score >= 0) scored.push({ option, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((entry) => entry.option)
}

export function mentionSuggestions(
  mention: MentionState,
  sections: RefSectionView[],
): Suggestion[] {
  if (mention.stage === "section") {
    const matches = matchSuggestions(
      sections,
      mention.query,
      (section) => section.key,
    )
    return matches.map((section) => ({
      key: `section:${section.key}`,
      primary: `@${section.key}/`,
      secondary:
        section.items.length === 1
          ? `${section.label} · 1 item`
          : `${section.label} · ${section.items.length} items`,
      complete: `@${section.key}/`,
    }))
  }
  const section = sections.find((item) => item.key === mention.section)
  if (!section) return []
  const matches = matchSuggestions(
    section.items,
    mention.query,
    (item) => item.name,
  )
  return matches.map((item) => ({
    key: `item:${section.key}:${item.id}`,
    primary: `@${section.key}/${item.name}`,
    secondary: item.description ?? "",
    complete: `@${section.key}/${item.name} `,
  }))
}
