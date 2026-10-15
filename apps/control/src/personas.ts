import type { Db, User } from "@open-bot/db"
import { type PluginOrigin, pluginOwnership } from "./plugin-ownership"

export const ASSISTANT_ID = "assistant"
export const NAME_MAX = 48
export const INSTRUCTION_MAX = 2000

export type PersonaView = {
  id: string
  name: string
  instruction: string
  builtin: boolean
  plugin?: PluginOrigin
}

export const builtins: PersonaView[] = [
  {
    id: ASSISTANT_ID,
    name: "Assistant",
    instruction: "",
    builtin: true,
  },
  {
    id: "designer",
    name: "Designer",
    instruction:
      "Talk about visual design, layout, typography, and how things should look and feel. Prefer concrete design choices. Write code only when asked.",
    builtin: true,
  },
  {
    id: "political-expert",
    name: "Political expert",
    instruction:
      "Explain institutions, incentives, and tradeoffs. Stay factual. Do not campaign, endorse a party, or invent polling.",
    builtin: true,
  },
  {
    id: "software-designer",
    name: "Software designer",
    instruction:
      "Talk about product shape, interfaces, and architecture in plain language. Write code only when asked.",
    builtin: true,
  },
]

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
    }
  })
  return [...builtins, ...custom]
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
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    builtin: false,
  }
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
  return `For this thread only, answer as ${persona.name}. ${persona.instruction} This does not replace desktop, memory, or safety rules. Do not announce this persona unless asked.`
}

export function mergeSystem(existing: unknown, line: string): string {
  if (typeof existing === "string" && existing.trim())
    return `${existing.trim()}\n\n${line}`
  return line
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
  } | null
  if (!body) return json({ error: "invalid json" }, 400)
  const parsed = parsePersonaInput(body.name, body.instruction)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  if (nameTaken(db, user.id, parsed.name))
    return json({ error: "a personality with that name already exists" }, 409)
  const persona = {
    id: crypto.randomUUID(),
    userId: user.id,
    name: parsed.name,
    instruction: parsed.instruction,
    createdAt: Date.now(),
  }
  db.createPersona(persona)
  return json({
    id: persona.id,
    name: persona.name,
    instruction: persona.instruction,
    builtin: false,
  })
}

async function updatePersona(req: Request, db: Db, user: User, id: string) {
  if (builtins.some((item) => item.id === id))
    return json({ error: "built-in personalities cannot be edited" }, 400)
  const body = (await req.json().catch(() => null)) as {
    name?: unknown
    instruction?: unknown
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
  const saved = db.updatePersona(id, user.id, parsed)
  if (!saved) return json({ error: "not found" }, 404)
  return json({
    id: saved.id,
    name: saved.name,
    instruction: saved.instruction,
    builtin: false,
  })
}

function removePersona(db: Db, user: User, id: string) {
  if (builtins.some((item) => item.id === id))
    return json({ error: "built-in personalities cannot be deleted" }, 400)
  if (!db.deletePersona(id, user.id)) return json({ error: "not found" }, 404)
  return json({ ok: true })
}
