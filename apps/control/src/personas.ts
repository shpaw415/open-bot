import type { Db, User } from "@open-bot/db"
import { MCP_NAME_PATTERN, SLUG_PATTERN } from "@open-bot/plugin-kit"
import { type CatalogDirView, catalogDirView } from "./catalog-dirs"
import { endpoint, isRunning, opencodeExec } from "./docker"
import { names } from "./env"
import { pluginMcpOwners, readMcpConfig } from "./mcp"
import {
  type PluginOrigin,
  pluginOwnership,
  pluginSkillGroups,
} from "./plugin-ownership"
import { vikingSkillList } from "./viking-skills"
import { vikingUserKey } from "./viking-user"

export const ASSISTANT_ID = "assistant"
export const NAME_MAX = 48
export const INSTRUCTION_MAX = 2000
export const SKILLS_MAX = 64
export const MCP_MAX = 16

// One opencode session permission rule (wire shape:
// {permission, pattern, action}; the internal {action,resource,effect} v2
// shape must never be sent). Rulesets evaluate find-last-match-wins, so the
// trailing allow rules beat the leading catch-all deny. A tool disappears
// from the model's tool map when the last rule matching its id is a
// pattern-"*" deny — which is why MCP denies are per-server `<server>_*`
// globs (a "*" permission would disable every builtin tool too).
export type ScopeRule = {
  permission: string
  pattern: string
  action: "allow" | "deny"
}

export type PersonaView = {
  id: string
  name: string
  instruction: string
  builtin: boolean
  plugin?: PluginOrigin
  // Base allowlists (null = all). The Extra fields extend a plugin-owned
  // base list; the Effective fields are the pre-merged restrictions (null =
  // unrestricted) so UI and CLI never re-derive the merge.
  skills: string[] | null
  skillsExtra: string[] | null
  skillsEffective: string[] | null
  mcp: string[] | null
  mcpExtra: string[] | null
  mcpEffective: string[] | null
}

export const builtins: PersonaView[] = [
  {
    id: ASSISTANT_ID,
    name: "Assistant",
    instruction: "",
    builtin: true,
    skills: null,
    skillsExtra: null,
    skillsEffective: null,
    mcp: null,
    mcpExtra: null,
    mcpEffective: null,
  },
  {
    id: "designer",
    name: "Designer",
    instruction:
      "Talk about visual design, layout, typography, and how things should look and feel. Prefer concrete design choices. Write code only when asked.",
    builtin: true,
    skills: null,
    skillsExtra: null,
    skillsEffective: null,
    mcp: null,
    mcpExtra: null,
    mcpEffective: null,
  },
  {
    id: "political-expert",
    name: "Political expert",
    instruction:
      "Explain institutions, incentives, and tradeoffs. Stay factual. Do not campaign, endorse a party, or invent polling.",
    builtin: true,
    skills: null,
    skillsExtra: null,
    skillsEffective: null,
    mcp: null,
    mcpExtra: null,
    mcpEffective: null,
  },
  {
    id: "software-designer",
    name: "Software designer",
    instruction:
      "Talk about product shape, interfaces, and architecture in plain language. Write code only when asked.",
    builtin: true,
    skills: null,
    skillsExtra: null,
    skillsEffective: null,
    mcp: null,
    mcpExtra: null,
    mcpEffective: null,
  },
]

// The pre-merged skill allowlist: only a non-empty base restricts; extras
// extend it.
export function skillsEffective(
  skills: string[] | null,
  skillsExtra: string[] | null,
): string[] | null {
  if (!skills || skills.length === 0) return null
  const merged = [...skills]
  for (const name of skillsExtra ?? [])
    if (!merged.includes(name)) merged.push(name)
  return merged
}

// The pre-merged MCP allowlist is three-state: null = all servers, [] =
// every server blocked, [names] = only those. Extras extend a non-empty
// base; an explicit block-all base stays block-all (extras cannot
// resurrect servers the plugin blocked).
export function mcpEffective(
  mcp: string[] | null,
  mcpExtra: string[] | null,
): string[] | null {
  if (mcp === null) return null
  const merged = [...mcp]
  if (merged.length === 0) return merged
  for (const name of mcpExtra ?? [])
    if (!merged.includes(name)) merged.push(name)
  return merged
}

// Validates a persona allowlist from an API body: strings matching the given
// pattern (which must reject every glob metacharacter — a stray "*" would
// re-open everything under opencode's minimatch), capped, trimmed, deduped.
// Rejects with an error instead of sanitizing. An empty list reads as "all"
// and normalizes to null.
// emptyMeans: what an explicitly empty list means. Skills: all (the
// two-state model). MCP servers: none — an empty allowlist is a real
// "block every server" state, distinct from null (all servers).
export function parseNameList(
  input: unknown,
  opts: {
    label: string
    pattern: RegExp
    invalid: (name: string) => string
    max: number
    emptyMeans: "all" | "none"
  },
): { list: string[] | null } | { error: string } {
  if (input === null) return { list: null }
  if (!Array.isArray(input))
    return { error: `${opts.label} must be a list of names` }
  if (input.length > opts.max)
    return { error: `${opts.label} is limited to ${opts.max} entries` }
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== "string")
      return { error: `${opts.label} must be a list of names` }
    const name = raw.trim()
    if (!name || !opts.pattern.test(name)) return { error: opts.invalid(name) }
    if (!out.includes(name)) out.push(name)
  }
  if (out.length === 0) return { list: opts.emptyMeans === "none" ? [] : null }
  return { list: out }
}

export function parseSkillList(
  input: unknown,
): { skills: string[] | null } | { error: string } {
  const parsed = parseNameList(input, {
    label: "skills",
    pattern: SLUG_PATTERN,
    max: SKILLS_MAX,
    emptyMeans: "all",
    invalid: (name) =>
      `"${name}" is not a skill name — use lowercase letters, digits, hyphens, or underscores`,
  })
  return "error" in parsed ? parsed : { skills: parsed.list }
}

export function parseMcpList(
  input: unknown,
): { mcp: string[] | null } | { error: string } {
  const parsed = parseNameList(input, {
    label: "mcp servers",
    pattern: MCP_NAME_PATTERN,
    max: MCP_MAX,
    emptyMeans: "none",
    invalid: (name) =>
      `"${name}" is not an MCP server name — use letters, digits, dots, hyphens, or underscores`,
  })
  return "error" in parsed ? parsed : { mcp: parsed.list }
}

// The session permission ruleset for a persona: null when unrestricted
// (never send rules — the session keeps whatever it had), else a catch-all
// skill deny followed by one allow per allowed skill. Skill denies must
// carry allow rules after them: a trailing pattern-"*" deny would disable
// the skill tool itself (and the whole listing with it).
export function skillRuleset(persona: PersonaView | null): ScopeRule[] | null {
  const effective = persona?.skillsEffective
  if (!persona || !effective || effective.length === 0) return null
  return [
    { permission: "skill", pattern: "*", action: "deny" },
    ...effective.map((name) => ({
      permission: "skill",
      pattern: name,
      action: "allow" as const,
    })),
  ]
}

// MCP denies are enumerated per configured server — there is no deny-all
// here, because a pattern-"*" deny matching every tool id would remove the
// builtin tools (read, bash, …) from the model's tool map as well. A server
// not in the allowlist gets one `<server>_*` deny; listed servers get
// nothing and stay visible.
export function mcpDenyRules(
  effective: string[],
  configured: string[],
): ScopeRule[] {
  const allowed = new Set(effective)
  return configured
    .filter((server) => !allowed.has(server))
    .map((server) => ({
      permission: `${server}_*`,
      pattern: "*",
      action: "deny" as const,
    }))
}

// The full scope ruleset for a persona: skill rules plus — when the persona
// restricts MCP — a `<server>_*` deny per configured server outside the
// allowlist (an empty allowlist denies every configured server). The
// configured-server read is an opencode exec, so it only happens for
// MCP-restricted personas and degrades to skills-only scoping when the
// desktop cannot answer.
export async function personaScope(
  userId: string,
  persona: PersonaView | null,
): Promise<ScopeRule[] | null> {
  if (!persona) return skillRuleset(persona)
  const effectiveMcp = persona.mcpEffective
  if (effectiveMcp === null) return skillRuleset(persona)
  let configured: string[]
  try {
    configured = Object.keys(await readMcpConfig(userId))
  } catch {
    return skillRuleset(persona)
  }
  const ruleset = skillRuleset(persona)
  const mcpRules = mcpDenyRules(effectiveMcp, configured)
  if (mcpRules.length === 0) return ruleset
  return [...(ruleset ?? []), ...mcpRules]
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export function listPersonas(db: Db, userId: string): PersonaView[] {
  const ownership = pluginOwnership(db, userId)
  const custom = db.personas(userId).map((row) => {
    const plugin = ownership.personaById.get(row.id)
    return {
      id: row.id,
      name: row.name,
      instruction: row.instruction,
      builtin: false,
      plugin,
      skills: row.skills,
      skillsExtra: row.skillsExtra,
      skillsEffective: skillsEffective(row.skills, row.skillsExtra),
      mcp: row.mcp,
      mcpExtra: row.mcpExtra,
      mcpEffective: mcpEffective(row.mcp, row.mcpExtra),
    }
  })
  return [...builtins, ...custom]
}

function personaView(row: {
  id: string
  name: string
  instruction: string
  skills: string[] | null
  skillsExtra: string[] | null
  mcp: string[] | null
  mcpExtra: string[] | null
}): PersonaView {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    builtin: false,
    skills: row.skills,
    skillsExtra: row.skillsExtra,
    skillsEffective: skillsEffective(row.skills, row.skillsExtra),
    mcp: row.mcp,
    mcpExtra: row.mcpExtra,
    mcpEffective: mcpEffective(row.mcp, row.mcpExtra),
  }
}

export function resolvePersona(
  db: Db,
  userId: string,
  id: string,
): PersonaView | null {
  const builtin = builtins.find((item) => item.id === id)
  if (builtin) return builtin
  const row = db.personaById(id, userId)
  if (!row) return null
  return personaView(row)
}

export type PersonaMatch =
  | { persona: PersonaView; matched: "exact" | "fuzzy" }
  | { persona: null; suggestions: string[] }

const FUZZY_THRESHOLD = 0.85
const FUZZY_MARGIN = 0.05
const SUGGESTION_COUNT = 3

// Optimal string alignment distance: Levenshtein plus adjacent transpositions,
// so common typos like "mananger" or "softwaer" cost one edit.
function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length
  const cols = b.length
  if (rows === 0) return cols
  if (cols === 0) return rows
  const d: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )
  for (let j = 0; j <= cols; j++) d[0][j] = j
  for (let i = 1; i <= rows; i++) d[i][0] = i
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, d[i - 2][j - 2] + 1)
      d[i][j] = v
    }
  }
  return d[rows][cols]
}

export function nameSimilarity(a: string, b: string): number {
  const span = Math.max(a.length, b.length)
  if (span === 0) return 1
  return 1 - damerauLevenshtein(a, b) / span
}

// Resolves a persona by id or name for delegation. Exact (case-insensitive)
// first; then a typo-tolerant fuzzy match that only fires when one candidate is
// clearly closest, so ambiguous queries come back as suggestions instead.
export function findPersona(
  db: Db,
  userId: string,
  query: string,
): PersonaMatch {
  const q = query.trim().toLowerCase()
  const candidates = listPersonas(db, userId)
  const exact = candidates.find(
    (item) => item.id === q || item.name.toLowerCase() === q,
  )
  if (exact) return { persona: exact, matched: "exact" }
  const scored = candidates
    .map((persona, index) => ({
      index,
      persona,
      score: nameSimilarity(q, persona.name.toLowerCase()),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const best = scored[0]
  const second = scored[1]
  if (
    best &&
    best.score >= FUZZY_THRESHOLD &&
    (!second || best.score - second.score >= FUZZY_MARGIN)
  )
    return { persona: best.persona, matched: "fuzzy" }
  return {
    persona: null,
    suggestions: scored.slice(0, SUGGESTION_COUNT).map((s) => s.persona.name),
  }
}

export function personaSystem(persona: PersonaView | null): string | null {
  if (!persona || persona.id === ASSISTANT_ID) return null
  const effective = persona.skillsEffective
  const effectiveMcp = persona.mcpEffective
  const scope =
    effective && effective.length > 0
      ? ` Only these skills load in this thread: ${effective.join(", ")}. If the request needs another skill, say this personality does not include it instead of improvising.`
      : ""
  const mcpScope =
    effectiveMcp === null
      ? ""
      : effectiveMcp.length > 0
        ? ` Only these MCP servers load in this thread: ${effectiveMcp.join(", ")}. If the request needs another server's tools, say this personality does not include them.`
        : " No MCP server loads in this thread. If the request needs one, say this personality does not include MCP instead of improvising."
  return `For this thread only, answer as ${persona.name}. ${persona.instruction} This does not replace desktop, memory, or safety rules. Do not announce this persona unless asked.${scope}${mcpScope}`
}

export function mergeSystem(existing: unknown, line: string): string {
  if (typeof existing === "string" && existing.trim())
    return `${existing.trim()}\n\n${line}`
  return line
}

// Applies a persona's scope (skills + MCP servers) to one opencode session:
// PATCHes the session permission ruleset (array replaces, null clears).
// Rules persist in opencode.db, so this survives restarts; the per-prompt
// re-apply on persona-bound threads covers edits and binding moves anyway.
// Fire-and-forget: a failure degrades to unrestricted, never blocks the
// prompt.
export async function applyPersonaScope(
  userId: string,
  base: string,
  headers: Record<string, string>,
  sessionId: string,
  persona: PersonaView | null,
): Promise<void> {
  const ruleset = await personaScope(userId, persona)
  if (!ruleset || ruleset.length === 0) return
  try {
    const res = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ permission: ruleset }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok)
      console.error(
        `persona scope failed (${res.status}) for session ${sessionId}`,
      )
  } catch (error) {
    console.error(`persona scope failed for session ${sessionId}:`, error)
  }
}

// Merged scope catalog for persona pickers: skill names (seed skills on the
// desktop disk plus every OpenViking skill, deduped) and the configured MCP
// server names with their plugin owners. Follows the MCP tab down-pattern —
// a sleeping desktop answers empty lists with live: false instead of
// throwing. Entries carry what the grouped picker needs: description (search),
// plugin owner + manifest group label ("From <plugin>" sections), and the
// user directory membership (batch-allow by directory).
export type ScopeCatalog = {
  skills: {
    name: string
    description: string
    plugin: PluginOrigin | null
    group: string | null
    dirId: string | null
    /** Desktop seed skill (read-only on disk, fileable into directories). */
    seed: boolean
  }[]
  mcp: { name: string; plugin: string | null; dirId: string | null }[]
  dirs: {
    skill: CatalogDirView[]
    mcp: CatalogDirView[]
  }
  live: boolean
}

// Seed skills living on the desktop disk (~/.config/opencode/skills), with
// folded frontmatter descriptions. Shared by the persona picker's catalog
// and the Skills tab (where they are listed read-only so every picker entry
// can be organized into a directory).
export async function seedSkillDescriptions(
  userId: string,
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  try {
    // The description probe folds multi-line YAML values (seed skills write
    // `description: >-` blocks) — name-only search would hide exactly the
    // text the grouped picker's search box is for. Best-effort: a skill
    // whose frontmatter defeats the awk still lists with an empty
    // description.
    const disk = await opencodeExec(userId, [
      "sh",
      "-c",
      `for f in "$HOME"/.config/opencode/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  n=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n 1)
  d=$(awk '/^---[[:space:]]*$/ { fm = !fm; if (seen && fm) exit; next }
    !fm { next }
    seen && /^[A-Za-z_-]+:/ { exit }
    /^description:/ { sub(/^description:[[:space:]]*/, ""); buf = $0; seen = 1; next }
    seen && /^[ \\t]/ { gsub(/^[ \\t]+/, ""); buf = buf " " $0 }
    END { if (seen) { sub(/^[|>]+-?[ \\t]*/, "", buf); gsub(/^"+|"+$/, "", buf); print buf } }' "$f")
  printf '%s\\t%s\\n' "$n" "$d"
done`,
    ])
    if (disk.code === 0) {
      for (const line of disk.stdout.split("\n")) {
        const tab = line.indexOf("\t")
        const name = (tab === -1 ? line : line.slice(0, tab)).trim()
        if (!name) continue
        const description =
          tab === -1
            ? ""
            : line
                .slice(tab + 1)
                .trim()
                .slice(0, 300)
        found.set(name, description)
      }
    }
  } catch {
    // the disk listing is best-effort
  }
  return found
}

export async function skillCatalog(
  db: Db,
  userId: string,
): Promise<ScopeCatalog> {
  const dirLists = {
    skill: db.catalogDirs(userId, "skill").map(catalogDirView),
    mcp: db.catalogDirs(userId, "mcp").map(catalogDirView),
  }
  const dirOf = (kind: "skill" | "mcp") =>
    new Map(
      db.catalogDirItems(userId, kind).map((row) => [row.name, row.dirId]),
    )
  const skillDirs = dirOf("skill")
  const mcpDirs = dirOf("mcp")
  if (!(await isRunning(names(userId).opencode)))
    return { skills: [], mcp: [], dirs: dirLists, live: false }
  const ownership = pluginOwnership(db, userId)
  const skillGroups = pluginSkillGroups(db, userId)
  const found = await seedSkillDescriptions(userId)
  // Names from the disk probe are seed skills; the OpenViking merge below
  // only adds user/plugin skills, so the seed set is exactly what was on
  // disk before it runs.
  const seedNames = new Set(found.keys())
  try {
    const desktop = db.desktop(userId)
    if (desktop?.vikingKey) {
      const base = await endpoint(userId, "viking", 1933)
      const res = await fetch(`${base.replace(/\/$/, "")}/api/v1/skills`, {
        headers: { "x-api-key": vikingUserKey(desktop.vikingKey) },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        // The list rides the {status:"ok", result:{skills:[...]}} envelope —
        // parse it through the shared unwrap or the merge silently reads
        // nothing and the picker shows seed skills only.
        const list = vikingSkillList(await res.json().catch(() => null))
        for (const item of list) {
          if (!(item && typeof item === "object")) continue
          const name = (item as { name?: unknown }).name
          if (typeof name !== "string" || !name.trim()) continue
          if (!found.has(name.trim()))
            found.set(
              name.trim(),
              typeof (item as { description?: unknown }).description ===
                "string"
                ? (item as { description: string }).description
                    .split("\n")[0]
                    .trim()
                    .slice(0, 300)
                : "",
            )
        }
      }
    }
  } catch {
    // the OpenViking listing is best-effort
  }
  const owners = pluginMcpOwners(db, userId)
  const mcp: { name: string; plugin: string | null; dirId: string | null }[] =
    []
  try {
    for (const name of Object.keys(await readMcpConfig(userId)))
      mcp.push({
        name,
        plugin: owners.get(name)?.name ?? null,
        dirId: mcpDirs.get(name) ?? null,
      })
  } catch {
    // the mcp config read is best-effort; the picker still works for skills
  }
  return {
    skills: [...found.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, description]) => ({
        name,
        description,
        plugin: ownership.skillByName.get(name) ?? null,
        group: skillGroups.get(name) ?? null,
        dirId: skillDirs.get(name) ?? null,
        seed: seedNames.has(name),
      })),
    mcp: mcp.sort((a, b) => a.name.localeCompare(b.name)),
    dirs: dirLists,
    live: true,
  }
}

export function parsePersonaInput(
  name: unknown,
  instruction: unknown,
): { name: string; instruction: string } | { error: string } {
  if (typeof name !== "string" || typeof instruction !== "string")
    return { error: "name and instruction are required" }
  const trimmedName = name.trim()
  const trimmedInstruction = instruction.trim()
  if (!trimmedName || trimmedName.length > NAME_MAX)
    return { error: `name must be 1–${NAME_MAX} characters` }
  if (!trimmedInstruction || trimmedInstruction.length > INSTRUCTION_MAX) {
    const over = trimmedInstruction.length - INSTRUCTION_MAX
    return {
      error:
        `instruction must be 1–${INSTRUCTION_MAX} characters` +
        (over > 0 ? ` (got ${trimmedInstruction.length}, ${over} over)` : ""),
    }
  }
  if (
    builtins.some(
      (item) => item.name.toLowerCase() === trimmedName.toLowerCase(),
    )
  )
    return { error: "that name is reserved" }
  return { name: trimmedName, instruction: trimmedInstruction }
}

function nameTaken(
  db: Db,
  userId: string,
  name: string,
  exceptId?: string,
): boolean {
  return db
    .personas(userId)
    .some(
      (row) =>
        row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
    )
}

export function handlePersonas(
  req: Request,
  url: URL,
  db: Db,
  user: User,
): Response | Promise<Response> | null {
  if (url.pathname === "/api/personas" && req.method === "GET")
    return json({ personas: listPersonas(db, user.id) })

  if (url.pathname === "/api/personas/threads" && req.method === "GET") {
    return json({
      threads: db.threadPersonas(user.id).map((row) => ({
        sessionId: row.sessionId,
        personaId: row.personaId,
      })),
    })
  }

  if (url.pathname === "/api/personas" && req.method === "POST")
    return createPersona(req, db, user)

  // Registered before the id regex below — otherwise the path falls into the
  // `^/api/personas/([^/]+)$` match and 404s forever.
  if (url.pathname === "/api/personas/skill-catalog" && req.method === "GET")
    return skillCatalog(db, user.id).then(json)

  const match = url.pathname.match(/^\/api\/personas\/([^/]+)$/)
  if (!match) return null
  const id = decodeURIComponent(match[1] ?? "")
  if (req.method === "PUT") return updatePersona(req, db, user, id)
  if (req.method === "DELETE") return removePersona(db, user, id)
  return null
}

async function createPersona(req: Request, db: Db, user: User) {
  const body = (await req.json().catch(() => null)) as {
    name?: unknown
    instruction?: unknown
    skills?: unknown
    mcp?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const parsed = parsePersonaInput(body.name, body.instruction)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  let skills: string[] | null = null
  if (body.skills !== undefined) {
    const list = parseSkillList(body.skills)
    if ("error" in list) return json({ error: list.error }, 400)
    skills = list.skills
  }
  let mcp: string[] | null = null
  if (body.mcp !== undefined) {
    const list = parseMcpList(body.mcp)
    if ("error" in list) return json({ error: list.error }, 400)
    mcp = list.mcp
  }
  if (nameTaken(db, user.id, parsed.name))
    return json({ error: "a personality with that name already exists" }, 409)
  const persona = {
    id: crypto.randomUUID(),
    userId: user.id,
    name: parsed.name,
    instruction: parsed.instruction,
    skills,
    skillsExtra: null,
    mcp,
    mcpExtra: null,
    createdAt: Date.now(),
  }
  db.createPersona(persona)
  return json(personaView(persona))
}

async function updatePersona(req: Request, db: Db, user: User, id: string) {
  if (builtins.some((item) => item.id === id))
    return json({ error: "built-in personalities cannot be edited" }, 400)
  const body = (await req.json().catch(() => null)) as {
    name?: unknown
    instruction?: unknown
    skills?: unknown
    skillsExtra?: unknown
    mcp?: unknown
    mcpExtra?: unknown
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const current = db.personaById(id, user.id)
  if (!current) return json({ error: "not found" }, 404)
  const parsed = parsePersonaInput(
    body.name ?? current.name,
    body.instruction ?? current.instruction,
  )
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  if (nameTaken(db, user.id, parsed.name, id))
    return json({ error: "a personality with that name already exists" }, 409)
  const changes: {
    name: string
    instruction: string
    skills?: string[] | null
    skillsExtra?: string[] | null
    mcp?: string[] | null
    mcpExtra?: string[] | null
  } = { name: parsed.name, instruction: parsed.instruction }
  // A plugin owns its persona's base allowlists; users extend them with
  // skillsExtra/mcpExtra instead. Name/instruction keep their existing
  // behavior (editable either way).
  const pluginOwner = () => pluginOwnership(db, user.id).personaById.get(id)
  if (body.skills !== undefined) {
    const plugin = pluginOwner()
    if (plugin)
      return json(
        {
          error: `skills are managed by ${plugin.name} — extend with skillsExtra instead`,
        },
        409,
      )
    const list = parseSkillList(body.skills)
    if ("error" in list) return json({ error: list.error }, 400)
    changes.skills = list.skills
  }
  if (body.skillsExtra !== undefined) {
    const list = parseSkillList(body.skillsExtra)
    if ("error" in list) return json({ error: list.error }, 400)
    changes.skillsExtra = list.skills
  }
  if (body.mcp !== undefined) {
    const plugin = pluginOwner()
    if (plugin)
      return json(
        {
          error: `MCP servers are managed by ${plugin.name} — extend with mcpExtra instead`,
        },
        409,
      )
    const list = parseMcpList(body.mcp)
    if ("error" in list) return json({ error: list.error }, 400)
    changes.mcp = list.mcp
  }
  if (body.mcpExtra !== undefined) {
    const list = parseMcpList(body.mcpExtra)
    if ("error" in list) return json({ error: list.error }, 400)
    changes.mcpExtra = list.mcp
  }
  const saved = db.updatePersona(id, user.id, changes)
  if (!saved) return json({ error: "not found" }, 404)
  return json(personaView(saved))
}

function removePersona(db: Db, user: User, id: string) {
  if (builtins.some((item) => item.id === id))
    return json({ error: "built-in personalities cannot be deleted" }, 400)
  if (!db.deletePersona(id, user.id)) return json({ error: "not found" }, 404)
  return json({ ok: true })
}
