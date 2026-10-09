export type SkillSummary = {
  name: string
  description: string
}

export type RefItemView = {
  id: string
  name: string
  description?: string
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

export function detectMention(
  text: string,
  caret: number,
  sectionKeys: string[],
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
  if (/\s/.test(token)) return null
  const slash = token.indexOf("/")
  if (slash < 0)
    return { stage: "section", section: "", query: token, start: anchor }
  const section = normalizeSectionKey(token.slice(0, slash).toLowerCase())
  if (!sectionKeys.includes(section)) return null
  return {
    stage: "name",
    section,
    query: token.slice(slash + 1),
    start: anchor,
  }
}

/** "@project/…" (singular) opens the same picker and resolves like "@projects/…". */
export function normalizeSectionKey(section: string): string {
  return section === "project" ? "projects" : section
}

export type ProjectRefItem = {
  name: string
  path?: string
}

export type ReferenceToken = {
  start: number
  end: number
  /** Matched project name; empty when nothing known matches. */
  name: string
  path?: string
}

const projectTokenPattern = /@(projects?)\/([^\n@]*)/gi
const nameBoundary = /[\s,.;:!?)\]}]/

/**
 * Locate `@projects/<name>` / `@project/<name>` tokens for highlighting.
 * Mirrors the control-plane matcher: longest known name wins (exact or
 * boundary-terminated prefix), else the first word (unique prefix match);
 * unmatched tokens still return a span ending at the first word so the UI
 * can flag them.
 */
export function findReferenceTokens(
  text: string,
  projects: ProjectRefItem[],
): ReferenceToken[] {
  const tokens: ReferenceToken[] = []
  for (const match of text.matchAll(
    new RegExp(projectTokenPattern.source, "gi"),
  )) {
    const start = match.index ?? 0
    const prev = start > 0 ? (text[start - 1] ?? "") : ""
    if (start > 0 && !/\s/.test(prev)) continue
    const remainder = match[2] ?? ""
    if (!remainder.trim()) continue
    const prefixLength = match[0].length - remainder.length
    const matched = matchProjectName(remainder, projects)
    tokens.push({
      start,
      end: start + prefixLength + matched.length,
      name: matched.name,
      path: matched.path,
    })
  }
  return tokens
}

function matchProjectName(
  remainder: string,
  projects: ProjectRefItem[],
): { name: string; length: number; path?: string } {
  const leading = remainder.length - remainder.trimStart().length
  const lower = remainder.toLowerCase()
  const sorted = [...projects].sort((a, b) => b.name.length - a.name.length)
  for (const project of sorted) {
    const nameLower = project.name.toLowerCase()
    if (lower === nameLower)
      return {
        name: project.name,
        length: leading + project.name.length,
        path: project.path,
      }
    if (lower.startsWith(nameLower)) {
      const next = remainder.slice(
        leading + nameLower.length,
        leading + nameLower.length + 1,
      )
      if (!next || nameBoundary.test(next))
        return {
          name: project.name,
          length: leading + nameLower.length,
          path: project.path,
        }
    }
  }
  const firstWord = remainder.trim().split(/\s+/)[0] ?? ""
  if (firstWord) {
    const wordLower = firstWord.toLowerCase()
    const partial = sorted.filter((project) =>
      project.name.toLowerCase().startsWith(wordLower),
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
