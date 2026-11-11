// Sandbox threads (docs/sandbox-threads-spec.md) — shared web types and
// the pure helpers the Workspace (thread list, composer, sandbox bar) and
// the Config profile editor both use.

export type SandboxToolsState = {
  bash: boolean
  read: boolean
  write: boolean
  edit: boolean
  glob: boolean
  grep: boolean
  list: boolean
  webfetch: boolean
  task: boolean
}

export type SandboxProfile = {
  name: string
  instruction: string
  /** Broker model: "chat"/"small" (instance models) or
   * "<provider>/<model>" brokered keylessly through the user's vault
   * key. Absent = "chat". */
  model?: string
  skills: string[]
  mcp: string[]
  tools: SandboxToolsState
  network: "off" | "on"
  mcpSecrets: boolean
  ttlMinutes: number
  idleMinutes: number
  limits: { memoryMb: number; cpus: number; pids: number; steps: number }
}

/** Client mirrors of the control-side profile caps
 * (parseSandboxProfile) for immediate feedback in the editor. */
export const SANDBOX_EDIT_CAPS = {
  nameMax: 48,
  instructionMax: 2000,
  skillsMax: 64,
  mcpMax: 16,
  ttlMax: 1440,
  memoryMin: 128,
  memoryMax: 8192,
  cpusMin: 0.25,
  cpusMax: 4,
  pidsMin: 32,
  pidsMax: 2048,
  stepsMax: 2048,
} as const

export type SandboxProfileEntry = {
  id: string
  name: string
  profile: SandboxProfile
  builtin?: boolean
}

export type SandboxThreadInfo = {
  sessionId: string
  sandboxId: string
  title: string
  profile: string
  network: "off" | "on"
  bash: boolean
  state: string
  running: boolean
  createdAt: number
  expiresAt: number
  lastActiveAt: number
}

export const SANDBOX_TOOL_LABELS: { key: keyof SandboxToolsState; label: string; hint: string }[] = [
  { key: "bash", label: "Terminal (bash)", hint: "Commandes shell dans le conteneur jetable." },
  { key: "read", label: "Lecture de fichiers", hint: "Lire dans /workspace et les compétences autorisées." },
  { key: "write", label: "Écriture de fichiers", hint: "Créer des fichiers dans /workspace." },
  { key: "edit", label: "Modification de fichiers", hint: "Modifier des fichiers dans /workspace." },
  { key: "glob", label: "Recherche de fichiers", hint: "Lister les fichiers par motif." },
  { key: "grep", label: "Recherche de texte", hint: "Chercher du texte dans /workspace." },
  { key: "list", label: "Listage", hint: "Lister un dossier." },
  { key: "webfetch", label: "Récupération web", hint: "Lire une URL (réseau requis)." },
  { key: "task", label: "Sous-agents", hint: "Désactivé : non pris en charge dans un bac à sable." },
]

export function emptySandboxProfile(name = ""): SandboxProfile {
  return {
    name,
    instruction: "",
    model: "chat",
    skills: [],
    mcp: [],
    tools: {
      bash: false,
      read: true,
      write: true,
      edit: true,
      glob: true,
      grep: true,
      list: true,
      webfetch: false,
      task: false,
    },
    network: "off",
    mcpSecrets: false,
    ttlMinutes: 120,
    idleMinutes: 30,
    limits: { memoryMb: 1024, cpus: 1, pids: 256, steps: 128 },
  }
}

/** One-line French summary of what a profile grants, for cards/pickers. */
export function sandboxProfileSummary(profile: SandboxProfile): string {
  const parts: string[] = []
  parts.push(
    profile.skills.length
      ? `${profile.skills.length} compétence${profile.skills.length > 1 ? "s" : ""}`
      : "aucune compétence",
  )
  parts.push(
    profile.mcp.length ? `${profile.mcp.length} MCP` : "aucun MCP",
  )
  parts.push(profile.tools.bash ? "terminal" : "sans terminal")
  parts.push(profile.network === "on" ? "internet" : "hors ligne")
  return parts.join(" · ")
}

/** Short label for a profile's model ref ("Modèle de l'instance" for
 * chat/small, the ref itself when brokered). */
export function sandboxModelLabel(model: string | undefined): string {
  const ref = model?.trim() || "chat"
  if (ref === "chat") return "Modèle de l'instance (chat)"
  if (ref === "small") return "Modèle de l'instance (small)"
  return `Clé du coffre · ${ref}`
}

/** Remaining lifetime label ("expire dans 1 h 05"), or "expiré". */
export function sandboxExpiryLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now
  if (ms <= 0) return "expiré"
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `expire dans ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? `expire dans ${hours} h`
    : `expire dans ${hours} h ${String(rest).padStart(2, "0")}`
}

type MergeableSession = {
  id: string
  title?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}

/**
 * Merge live sandbox threads into the desktop session list. Desktop
 * sessions keep their place; sandbox-only sessions are synthesized from
 * the control rows; duplicates (same id on both sides) keep the desktop
 * entry. Returns the merged list plus the sessionId → sandbox map.
 */
export function mergeSandboxSessions<T extends MergeableSession>(
  sessions: T[],
  sandboxThreads: SandboxThreadInfo[],
): { sessions: T[]; bySession: Map<string, SandboxThreadInfo> } {
  const bySession = new Map<string, SandboxThreadInfo>()
  const known = new Set(sessions.map((session) => session.id))
  const extra: T[] = []
  for (const row of sandboxThreads) {
    if (!row.sessionId) continue
    bySession.set(row.sessionId, row)
    if (known.has(row.sessionId)) continue
    extra.push({
      id: row.sessionId,
      title: row.title,
      time: { created: row.createdAt, updated: row.lastActiveAt },
    } as T)
  }
  return { sessions: [...sessions, ...extra], bySession }
}
