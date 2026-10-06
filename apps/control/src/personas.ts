import type { Db, User } from "@open-bot/db"

export const ASSISTANT_ID = "assistant"
export const NAME_MAX = 48
export const INSTRUCTION_MAX = 2000

export type PersonaView = {
  id: string
  name: string
  instruction: string
  builtin: boolean
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
  const custom = db.personas(userId).map((row) => ({
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    builtin: false,
  }))
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
  if (!trimmedInstruction || trimmedInstruction.length > INSTRUCTION_MAX)
    return { error: `instruction must be 1–${INSTRUCTION_MAX} characters` }
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
