import { createHash, randomBytes } from "node:crypto"
import type { Db, SandboxThreadRow, User } from "@open-bot/db"
import { MCP_NAME_PATTERN, SLUG_PATTERN } from "@open-bot/plugin-kit"
import { createSession } from "./cron"
import { containerIp, isRunning } from "./docker"
import {
  controlName,
  inDocker,
  maxSandboxesInstance,
  maxSandboxesPerUser,
  names,
  port,
  sandboxImage,
  userKey,
} from "./env"
import { createSseParser, type EventHub, type HubEvent } from "./events"
import { HttpError } from "./http-error"
import { type McpEntry, readMcpConfig } from "./mcp"
import { mcpDenyRules, type PersonaView, type ScopeRule } from "./personas"
import { docker, sh } from "./shell"

// Sandbox threads (docs/sandbox-threads-spec.md): an untrusted prompt runs
// in an ephemeral, capability-scoped container. The boundary is the
// container itself — no desktop volumes, no agent token, no provider
// credentials, no network unless the profile says so. Persona scopes only
// curate what a model is shown; nothing in this module may rely on them
// for containment.

export type SandboxTools = {
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

export type SandboxLimits = {
  memoryMb: number
  cpus: number
  pids: number
  steps: number
}

export type SandboxProfile = {
  name: string
  instruction: string
  /** Broker model: "chat"/"small" (instance models) or
   * "<provider>/<model>" brokered keylessly through the user's vault
   * key (sandbox-broker.ts). Absent = "chat". */
  model?: string
  skills: string[]
  mcp: string[]
  tools: SandboxTools
  network: "off" | "on"
  /** Copy MCP header/env credentials into the jail. Default false: any
   * secret inside the container is readable by the (untrusted) prompt. */
  mcpSecrets: boolean
  ttlMinutes: number
  idleMinutes: number
  limits: SandboxLimits
}

export const SANDBOX_SKILLS_MAX = 64
export const SANDBOX_MCP_MAX = 16
export const SANDBOX_NAME_MAX = 48
export const SANDBOX_INSTRUCTION_MAX = 2000
export const SANDBOX_TTL_MAX = 1440
export const SANDBOX_COPYIN_MAX_BYTES = 50 * 1024 * 1024
export const SANDBOX_BROKER_PROVIDER = "open-bot-sandbox"
export const SANDBOX_AGENT = "sandbox"

const TOOL_KEYS: (keyof SandboxTools)[] = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "list",
  "webfetch",
  "task",
]

function defaultTools(): SandboxTools {
  return {
    bash: false,
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    list: true,
    webfetch: false,
    task: false,
  }
}

function defaultLimits(): SandboxLimits {
  return { memoryMb: 1024, cpus: 1, pids: 256, steps: 128 }
}

export const LOCKED_SANDBOX_PROFILE: SandboxProfile = {
  name: "locked",
  instruction: "",
  skills: [],
  mcp: [],
  tools: defaultTools(),
  network: "off",
  mcpSecrets: false,
  ttlMinutes: 120,
  idleMinutes: 30,
  limits: defaultLimits(),
}

export const CODE_SANDBOX_PROFILE: SandboxProfile = {
  name: "code",
  instruction: "You run untrusted code and snippets. Work only in /workspace.",
  skills: [],
  mcp: [],
  tools: { ...defaultTools(), bash: true },
  network: "off",
  mcpSecrets: false,
  ttlMinutes: 120,
  idleMinutes: 30,
  limits: defaultLimits(),
}

export function builtinSandboxProfile(name: string): SandboxProfile | null {
  if (name === "locked") return structuredClone(LOCKED_SANDBOX_PROFILE)
  if (name === "code") return structuredClone(CODE_SANDBOX_PROFILE)
  return null
}

export type SandboxModelRef =
  | { kind: "instance"; id: "chat" | "small" }
  | { kind: "brokered"; providerId: string; modelId: string }

/** Parse a sandbox model ref: chat/small, or provider/model (the model
 * part may itself contain slashes, e.g. openrouter's openai/gpt-5). */
export function parseSandboxModelRef(value: unknown): SandboxModelRef | null {
  if (value === undefined || value === null || value === "")
    return { kind: "instance", id: "chat" }
  if (typeof value !== "string") return null
  const ref = value.trim()
  if (ref === "chat" || ref === "small") return { kind: "instance", id: ref }
  const slash = ref.indexOf("/")
  if (slash <= 0 || slash === ref.length - 1) return null
  const providerId = ref.slice(0, slash)
  const modelId = ref.slice(slash + 1)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(providerId)) return null
  if (/\s/.test(modelId) || modelId.length > 120) return null
  return { kind: "brokered", providerId, modelId }
}

/** The model key the generated opencode config advertises for a ref. */
export function sandboxModelKey(ref: SandboxModelRef): string {
  return ref.kind === "instance" ? ref.id : ref.modelId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseNameList(
  value: unknown,
  pattern: RegExp,
  max: number,
  field: string,
): { list: string[] } | { error: string } {
  if (value === undefined) return { list: [] }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return { error: `${field} must be an array of names` }
  const list = [...new Set((value as string[]).map((item) => item.trim()))]
  if (list.some((item) => !pattern.test(item)))
    return {
      error: `${field} names must be plain slugs (no globs): ${list
        .filter((item) => !pattern.test(item))
        .join(", ")}`,
    }
  if (list.length > max) return { error: `${field} is limited to ${max}` }
  return { list }
}

function intInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}

/** Validate an untrusted profile-shaped value. Reject, never sanitize —
 * same rule as persona allowlists. Unknown fields are refused so a typo
 * can never silently widen the grant. */
export function parseSandboxProfile(
  input: unknown,
): { profile: SandboxProfile } | { error: string } {
  if (!isRecord(input)) return { error: "sandbox profile must be an object" }
  const known = new Set([
    "name",
    "instruction",
    "model",
    "skills",
    "mcp",
    "tools",
    "network",
    "mcpSecrets",
    "ttlMinutes",
    "idleMinutes",
    "limits",
  ])
  for (const key of Object.keys(input))
    if (!known.has(key))
      return { error: `unknown sandbox profile field: ${key}` }
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (!name || name.length > SANDBOX_NAME_MAX)
    return { error: `name is required (max ${SANDBOX_NAME_MAX} characters)` }
  if (
    input.model !== undefined &&
    (typeof input.model !== "string" || !parseSandboxModelRef(input.model))
  )
    return {
      error: 'model must be "chat", "small", or "<provider>/<model>"',
    }
  const instruction = input.instruction === undefined ? "" : input.instruction
  if (
    typeof instruction !== "string" ||
    instruction.length > SANDBOX_INSTRUCTION_MAX
  )
    return {
      error: `instruction must be a string (max ${SANDBOX_INSTRUCTION_MAX} characters)`,
    }
  const skills = parseNameList(
    input.skills,
    SLUG_PATTERN,
    SANDBOX_SKILLS_MAX,
    "skills",
  )
  if ("error" in skills) return skills
  const mcp = parseNameList(input.mcp, MCP_NAME_PATTERN, SANDBOX_MCP_MAX, "mcp")
  if ("error" in mcp) return mcp
  const tools = defaultTools()
  if (input.tools !== undefined) {
    if (!isRecord(input.tools)) return { error: "tools must be an object" }
    for (const [key, value] of Object.entries(input.tools)) {
      if (!TOOL_KEYS.includes(key as keyof SandboxTools))
        return { error: `unknown sandbox tool: ${key}` }
      if (typeof value !== "boolean")
        return { error: `tools.${key} must be a boolean` }
      tools[key as keyof SandboxTools] = value
    }
  }
  const network = input.network === undefined ? "off" : input.network
  if (network !== "off" && network !== "on")
    return { error: 'network must be "off" or "on"' }
  if (input.mcpSecrets !== undefined && typeof input.mcpSecrets !== "boolean")
    return { error: "mcpSecrets must be a boolean" }
  const limitsRaw = isRecord(input.limits) ? input.limits : {}
  if (input.limits !== undefined && !isRecord(input.limits))
    return { error: "limits must be an object" }
  const memoryMb = intInRange(limitsRaw.memoryMb, 1024, 128, 8192)
  const cpus =
    limitsRaw.cpus === undefined
      ? 1
      : typeof limitsRaw.cpus === "number" &&
          limitsRaw.cpus >= 0.25 &&
          limitsRaw.cpus <= 4
        ? limitsRaw.cpus
        : null
  const pids = intInRange(limitsRaw.pids, 256, 32, 2048)
  const steps = intInRange(limitsRaw.steps, 128, 1, 2048)
  if (memoryMb === null || cpus === null || pids === null || steps === null)
    return { error: "limits out of range" }
  const ttlMinutes = intInRange(input.ttlMinutes, 120, 5, SANDBOX_TTL_MAX)
  const idleMinutes = intInRange(input.idleMinutes, 30, 5, SANDBOX_TTL_MAX)
  if (ttlMinutes === null || idleMinutes === null)
    return { error: "ttlMinutes/idleMinutes out of range" }
  return {
    profile: {
      name,
      instruction,
      ...(typeof input.model === "string" && input.model.trim()
        ? { model: input.model.trim() }
        : {}),
      skills: skills.list,
      mcp: mcp.list,
      tools,
      network,
      mcpSecrets: input.mcpSecrets === true,
      ttlMinutes,
      idleMinutes,
      limits: { memoryMb, cpus, pids, steps },
    },
  }
}

/** Parse a stored profile snapshot; a corrupt row degrades to locked. */
export function sandboxProfileFromJson(raw: string): SandboxProfile {
  try {
    const parsed = parseSandboxProfile(JSON.parse(raw))
    if ("profile" in parsed) return parsed.profile
  } catch {
    // fall through to locked
  }
  return structuredClone(LOCKED_SANDBOX_PROFILE)
}

/** A persona may only narrow a profile (intersection) and lend its
 * instruction when the profile has none. */
export function narrowProfileWithPersona(
  profile: SandboxProfile,
  persona: PersonaView | null,
): SandboxProfile {
  if (!persona) return profile
  const narrowed = structuredClone(profile)
  if (persona.skillsEffective)
    narrowed.skills = narrowed.skills.filter((skill) =>
      persona.skillsEffective?.includes(skill),
    )
  if (persona.mcpEffective)
    narrowed.mcp = narrowed.mcp.filter((server) =>
      persona.mcpEffective?.includes(server),
    )
  if (!narrowed.instruction && persona.instruction)
    narrowed.instruction = persona.instruction
  return narrowed
}

export type SkippedMcp = { name: string; reason: string }

/** Runtimes a local MCP command may start from inside the sandbox image,
 * plus plugin payload binaries copied in at launch. */
export const SANDBOX_MCP_RUNTIMES = new Set([
  "bun",
  "node",
  "python3",
  "python",
  "npx",
  "uvx",
  "sh",
])

function localCommandRunnable(entry: McpEntry): boolean {
  const head = entry.command?.[0] ?? ""
  if (!head) return false
  if (head.startsWith("/usr/local/bin/ob-plugin-")) return true
  const base = head.split("/").pop() ?? head
  return SANDBOX_MCP_RUNTIMES.has(base)
}

/**
 * Resolve the profile's MCP allowlist against the desktop's configured
 * servers. Remote servers need the network on (refused here so launch
 * validation fails loudly, per spec §6); unresolvable local servers are
 * reported in `skipped`, never dropped silently. Headers and environment
 * are stripped unless the profile opted into `mcpSecrets`.
 */
export function resolveSandboxMcp(
  profile: SandboxProfile,
  configured: Record<string, McpEntry>,
):
  | { mcp: Record<string, McpEntry>; included: string[]; skipped: SkippedMcp[] }
  | { error: string } {
  const mcp: Record<string, McpEntry> = {}
  const included: string[] = []
  const skipped: SkippedMcp[] = []
  for (const name of profile.mcp) {
    const entry = configured[name]
    if (!entry) {
      skipped.push({ name, reason: "not configured on the desktop" })
      continue
    }
    if (entry.enabled === false) {
      skipped.push({ name, reason: "disabled on the desktop" })
      continue
    }
    if (entry.type === "remote") {
      if (profile.network === "off")
        return {
          error: `MCP server "${name}" is remote but the profile has network off`,
        }
      mcp[name] = {
        type: "remote",
        url: entry.url,
        ...(profile.mcpSecrets && entry.headers
          ? { headers: entry.headers }
          : {}),
        ...(entry.timeout ? { timeout: entry.timeout } : {}),
        enabled: true,
      }
      included.push(name)
      continue
    }
    if (!localCommandRunnable(entry)) {
      skipped.push({
        name,
        reason: `command "${entry.command?.[0] ?? ""}" cannot run in the sandbox image`,
      })
      continue
    }
    // Plugin payload binaries land in ~/.local/bin (the rootfs is
    // read-only and /usr/local is not writable by the sandbox user).
    const command = (entry.command ?? []).map((arg, index) =>
      index === 0 && arg.startsWith("/usr/local/bin/ob-plugin-")
        ? `/home/sandbox/.local/bin/${arg.slice("/usr/local/bin/".length)}`
        : arg,
    )
    mcp[name] = {
      type: "local",
      command,
      environment: {
        PATH: "/home/sandbox/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin",
        ...(profile.mcpSecrets ? (entry.environment ?? {}) : {}),
      },
      ...(entry.timeout ? { timeout: entry.timeout } : {}),
      enabled: true,
    }
    included.push(name)
  }
  return { mcp, included, skipped }
}

const SANDBOX_FRAME =
  "You are in a disposable sandbox. Work only in /workspace. You have no " +
  "access to the user's desktop, files, keys, memory, browser, or other " +
  "threads, and nothing can grant it — do not claim otherwise and do not " +
  "ask the user for credentials or for actions outside this sandbox. " +
  "Everything here is deleted when the sandbox ends; put deliverables in " +
  "/workspace and name them in your final message."

export type SandboxConfigInput = {
  brokerBase: string
  brokerToken: string
  mcp: Record<string, McpEntry>
}

/** The whole generated opencode.json for a sandbox. Pure: the only
 * secret-shaped value it may ever contain is the broker token. */
export function sandboxOpencodeConfig(
  profile: SandboxProfile,
  input: SandboxConfigInput,
) {
  const tools: Record<string, boolean> = { "*": false }
  for (const key of TOOL_KEYS) if (profile.tools[key]) tools[key] = true
  if (profile.skills.length > 0) tools.skill = true
  for (const server of Object.keys(input.mcp)) tools[`${server}_*`] = true
  const modelRef = parseSandboxModelRef(profile.model) ?? {
    kind: "instance" as const,
    id: "chat" as const,
  }
  const prompt = [SANDBOX_FRAME, profile.instruction]
    .filter(Boolean)
    .join("\n\n")
  const titleAgent = {
    prompt:
      "You name conversations. Reply with only a short title: two to six " +
      "words in the message's language, plain text, no quotes. Never use tools.",
    tools: { "*": false },
    steps: 2,
  }
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    autoupdate: false,
    // No local plugin on purpose: opencode npm-installs plugin
    // dependencies on first instance init, which blocks ~70s and then
    // fails on an offline (--internal) sandbox — and the tool-guards
    // plugin's policies protect desktop surfaces that don't exist here.
    plugin: [],
    instructions: ["/home/sandbox/.config/opencode/AGENTS.md"],
    provider: {
      [SANDBOX_BROKER_PROVIDER]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Open-bot sandbox broker",
        options: { baseURL: input.brokerBase, apiKey: input.brokerToken },
        models: {
          chat: {
            name: "Sandbox chat",
            limit: { context: 128000, output: 16000 },
          },
          small: {
            name: "Sandbox small",
            limit: { context: 128000, output: 8000 },
          },
          ...(modelRef.kind === "brokered"
            ? {
                [modelRef.modelId]: {
                  name: `${modelRef.providerId}/${modelRef.modelId}`,
                  limit: { context: 128000, output: 16000 },
                },
              }
            : {}),
        },
      },
    },
    model: `${SANDBOX_BROKER_PROVIDER}/${sandboxModelKey(modelRef)}`,
    small_model: `${SANDBOX_BROKER_PROVIDER}/small`,
    agent: {
      [SANDBOX_AGENT]: {
        mode: "all",
        prompt,
        steps: profile.limits.steps,
        tools,
      },
      title: titleAgent,
      namer: { ...titleAgent, mode: "all" },
    },
    permission: {
      "*": "allow",
      external_directory: "deny",
      question: "deny",
      bash: profile.tools.bash ? "allow" : "deny",
      read: {
        "*": "deny",
        "/workspace/*": "allow",
        "/home/sandbox/.config/opencode/skills/*": "allow",
      },
      edit: { "*": "deny", "/workspace/*": "allow" },
    },
    mcp: input.mcp,
  }
}

export function sandboxAgentsMd(profile: SandboxProfile): string {
  const skills = profile.skills.length
    ? profile.skills.map((skill) => `- \`${skill}\``).join("\n")
    : "- (none)"
  return `# Sandbox

${SANDBOX_FRAME}

## Skills available in this sandbox

${skills}

Only the tools and MCP servers in this sandbox's profile exist here.
A missing tool or skill is the profile, not a malfunction.
`
}

/** Session ruleset (defense in depth beside the generated config):
 * skill catch-all deny + per-allowed allows, MCP per-server denies. */
export function sandboxScopeRules(
  profile: SandboxProfile,
  configuredMcp: string[],
): ScopeRule[] {
  const rules: ScopeRule[] = [
    { permission: "skill", pattern: "*", action: "deny" },
    ...profile.skills.map((name) => ({
      permission: "skill",
      pattern: name,
      action: "allow" as const,
    })),
  ]
  if (configuredMcp.length > 0)
    rules.push(...mcpDenyRules(profile.mcp, configuredMcp))
  return rules
}

export function sandboxId() {
  return randomBytes(6).toString("hex")
}

export function sandboxTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function sandboxNames(userId: string, id: string) {
  const key = userKey(userId)
  return {
    container: `ob-sbx-${key}-${id}`,
    network: `ob-sbx-${id}`,
    volume: `ob-sbxws-${id}`,
  }
}

/** `docker run` arguments (pure, so the boundary is unit-testable). */
export function sandboxRunArgs(args: {
  userId: string
  id: string
  profile: SandboxProfile
  opencodePassword: string
}) {
  const n = sandboxNames(args.userId, args.id)
  const { profile } = args
  return [
    "--name",
    n.container,
    "--network",
    n.network,
    "--label",
    "open-bot-role=sandbox",
    "--label",
    `open-bot-user=${userKey(args.userId)}`,
    "--label",
    `open-bot-sandbox=${args.id}`,
    "--memory",
    `${profile.limits.memoryMb}m`,
    "--cpus",
    String(profile.limits.cpus),
    "--pids-limit",
    String(profile.limits.pids),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    // mode=1777: a tmpfs mounts root-owned by default, and with
    // cap-drop ALL nothing inside can chown it for the sandbox user.
    "--tmpfs",
    "/home/sandbox:rw,size=256m,mode=1777",
    "--tmpfs",
    "/tmp:rw,size=256m,mode=1777",
    "-v",
    `${n.volume}:/workspace`,
    "-u",
    "sandbox",
    "-e",
    "HOME=/home/sandbox",
    "-e",
    `OPENCODE_SERVER_PASSWORD=${args.opencodePassword}`,
    "-e",
    "OPENCODE_SERVER_USERNAME=opencode",
    "-e",
    "OPENCODE_DISABLE_AUTOUPDATE=1",
    sandboxImage,
  ]
}

export function sandboxHeaders(password: string) {
  return {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    "content-type": "application/json",
  }
}

// The per-sandbox daemon password lives only in memory for routing; the
// persisted row carries the broker token hash, and the password is
// recoverable after a control restart from `docker inspect` (the env it
// was launched with) during reconcile.
const daemonPasswords = new Map<string, string>()

export function rememberSandboxPassword(id: string, password: string) {
  daemonPasswords.set(id, password)
}

export type SandboxDaemon = {
  row: SandboxThreadRow
  base: string
  headers: Record<string, string>
  password: string
}

/** Resolve a session id to its sandbox daemon, or null when the session
 * is not a live sandbox session owned by this user. */
export async function sandboxDaemon(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<SandboxDaemon | null> {
  const row = db.sandboxBySession?.(sessionId) ?? null
  if (!row || row.userId !== userId) return null
  if (row.state !== "running" && row.state !== "starting") return null
  const password = daemonPasswords.get(row.id)
  if (!password) return null
  try {
    const ip = await containerIp(row.container, row.network)
    return {
      row,
      base: `http://${ip}:4096`,
      headers: sandboxHeaders(password),
      password,
    }
  } catch {
    return null
  }
}

/** Same, but by sandbox id (export/extend routes). */
export async function sandboxDaemonById(
  db: Db,
  userId: string,
  id: string,
): Promise<SandboxDaemon | null> {
  const row = db.sandboxThread?.(userId, id) ?? null
  if (!row?.sessionId) return null
  return sandboxDaemon(db, userId, row.sessionId)
}

export function touchSandbox(db: Db, id: string) {
  db.updateSandboxThread(id, { lastActiveAt: Date.now() })
}

async function dockerQuiet(args: string[], input?: string, timeoutMs = 30_000) {
  try {
    return await docker(args, input, timeoutMs)
  } catch {
    return null
  }
}

/** Create the per-sandbox network and join the control plane to it (the
 * only reachable peer on an internal network). Returns the broker base
 * URL as seen from inside the sandbox. */
async function ensureSandboxNetwork(
  network: string,
  mode: "off" | "on",
): Promise<string> {
  const exists = await sh(
    ["docker", "network", "inspect", network],
    undefined,
    30_000,
  )
  if (exists.code !== 0) {
    await docker(
      ["network", "create", ...(mode === "off" ? ["--internal"] : []), network],
      undefined,
      30_000,
    )
  }
  const gateway = (
    await docker(
      [
        "network",
        "inspect",
        "-f",
        "{{(index .IPAM.Config 0).Gateway}}",
        network,
      ],
      undefined,
      30_000,
    )
  ).trim()
  if (inDocker && controlName) {
    const connected = await sh(
      [
        "docker",
        "network",
        "inspect",
        network,
        "-f",
        "{{range $k, $v := .Containers}}{{$v.Name}} {{end}}",
      ],
      undefined,
      30_000,
    )
    if (!connected.stdout.includes(controlName)) {
      await docker(
        ["network", "connect", "--alias", "open-bot", network, controlName],
        undefined,
        30_000,
      )
    }
    return "http://open-bot:8787/llm/v1"
  }
  return `http://${gateway || "127.0.0.1"}:${port}/llm/v1`
}

async function sandboxExecWrite(
  container: string,
  path: string,
  content: string,
) {
  const out = await dockerQuiet(
    ["exec", "-i", container, "sh", "-c", `cat > ${path}`],
    content,
    30_000,
  )
  if (out === null) throw new Error(`could not write ${path} in the sandbox`)
}

/** Tar (base64, text-safe) of paths from the desktop home, or null. */
async function desktopTarBase64(
  userId: string,
  paths: string[],
  cwd = "/home/agent",
): Promise<string | null> {
  if (paths.length === 0) return null
  const container = names(userId).opencode
  const out = await dockerQuiet(
    [
      "exec",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      container,
      "sh",
      "-c",
      `cd ${cwd} && tar -cf - -- ${paths.map(shellQuote).join(" ")} | base64 -w0`,
    ],
    undefined,
    120_000,
  )
  return out?.trim() || null
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function sandboxExtractBase64(
  container: string,
  destDir: string,
  b64: string,
) {
  const out = await dockerQuiet(
    [
      "exec",
      "-i",
      container,
      "sh",
      "-c",
      `base64 -d | tar -xf - -C ${destDir}`,
    ],
    b64,
    120_000,
  )
  if (out === null) throw new Error("could not extract files into the sandbox")
}

async function waitForSandboxHealth(
  base: string,
  headers: Record<string, string>,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/global/health`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null)
    if (res?.ok) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/** Copy-in path guard: absolute under /home/agent, never protected
 * segments or credential-shaped basenames (mirrors workspace-file). */
export function sandboxCopyInPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const path = raw.trim()
  if (!path.startsWith("/home/agent/") || path.includes("\0")) return null
  const segments = path.slice("/home/agent/".length).split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  if (segments.includes(".ssh") || segments.includes(".open-bot")) return null
  if (segments.includes(".openviking")) return null
  if (segments[0] === ".config" && segments[1] === "open-bot") return null
  if (segments[0] === ".local") return null
  const base = (segments[segments.length - 1] ?? "").toLowerCase()
  if (!base) return null
  if (base === ".env" || base.startsWith(".env.")) return null
  if (base === "auth.json" || base.endsWith("-auth.json")) return null
  if (/\.(pem|key|p12|pfx)$/.test(base)) return null
  return path
}

export function parseSandboxCopyIn(
  value: unknown,
): { paths: string[] } | { error: string } {
  if (value === undefined) return { paths: [] }
  if (!Array.isArray(value))
    return { error: "copyIn must be an array of paths" }
  if (value.length > 32) return { error: "copyIn is limited to 32 paths" }
  const paths: string[] = []
  for (const item of value) {
    const path = sandboxCopyInPath(item)
    if (!path) return { error: `copyIn path is not allowed: ${String(item)}` }
    paths.push(path)
  }
  return { paths: [...new Set(paths)] }
}

export type SandboxLaunchResult = {
  row: SandboxThreadRow
  base: string
  headers: Record<string, string>
  sessionId: string
  mcp: { included: string[]; skipped: SkippedMcp[] }
  skillsSkipped: string[]
}

export type SandboxLaunchInput = {
  profile: SandboxProfile
  profileId: string | null
  title: string
  copyIn: string[]
  hub?: EventHub
}

/**
 * Full launch: network, volume, container, generated config, skill and
 * plugin-MCP payload copies, health wait, session create. Throws
 * HttpError with a caller-facing message; any partial docker state is
 * torn down before the throw.
 */
export async function launchSandbox(
  db: Db,
  user: User,
  input: SandboxLaunchInput,
): Promise<SandboxLaunchResult> {
  const { profile } = input
  if (db.liveSandboxes(user.id).length >= maxSandboxesPerUser)
    throw new HttpError(
      429,
      "Too many sandboxes are running. Destroy one, then try again.",
      "sandbox_capacity",
    )
  if (db.liveSandboxes().length >= maxSandboxesInstance)
    throw new HttpError(
      429,
      "The instance sandbox limit is reached. Try again later.",
      "sandbox_capacity",
    )

  // MCP/config resolution. A sleeping desktop degrades to skipped
  // names instead of a wake (spec §10 phase 1).
  let configured: Record<string, McpEntry> = {}
  let desktopUp = false
  try {
    configured = await readMcpConfig(user.id)
    desktopUp = true
  } catch {
    configured = {}
  }
  const resolved = resolveSandboxMcp(profile, configured)
  if ("error" in resolved)
    throw new HttpError(400, resolved.error, "sandbox_profile")

  const id = sandboxId()
  const n = sandboxNames(user.id, id)
  const password = randomBytes(24).toString("hex")
  const brokerToken = randomBytes(32).toString("hex")
  const now = Date.now()
  const row: SandboxThreadRow = {
    id,
    userId: user.id,
    sessionId: null,
    profileId: input.profileId,
    profile: JSON.stringify(profile),
    container: n.container,
    network: n.network,
    tokenHash: sandboxTokenHash(brokerToken),
    state: "starting",
    createdAt: now,
    expiresAt: now + profile.ttlMinutes * 60_000,
    lastActiveAt: now,
  }
  db.createSandboxThread(row)
  rememberSandboxPassword(id, password)

  const skillsSkipped: string[] = []
  try {
    const brokerBase = await ensureSandboxNetwork(n.network, profile.network)
    await docker(["volume", "create", n.volume], undefined, 30_000)
    await docker(
      [
        "run",
        "-d",
        ...sandboxRunArgs({
          userId: user.id,
          id,
          profile,
          opencodePassword: password,
        }),
      ],
      undefined,
      60_000,
    )

    // Config + skills land before the entrypoint starts opencode.
    const config = sandboxOpencodeConfig(profile, {
      brokerBase,
      brokerToken,
      mcp: resolved.mcp,
    })
    await docker([
      "exec",
      n.container,
      "sh",
      "-c",
      "mkdir -p /home/sandbox/.config/opencode/skills /home/sandbox/.local/share/opencode /workspace",
    ])
    await sandboxExecWrite(
      n.container,
      "/home/sandbox/.config/opencode/opencode.json",
      JSON.stringify(config, null, 2),
    )
    await sandboxExecWrite(
      n.container,
      "/home/sandbox/.config/opencode/AGENTS.md",
      sandboxAgentsMd(profile),
    )
    // Seed skills ship in the image; copy only the allowed set in.
    if (profile.skills.length > 0) {
      const copySeed = await dockerQuiet([
        "exec",
        n.container,
        "sh",
        "-c",
        `for s in ${profile.skills.map(shellQuote).join(" ")}; do if [ -d "/opt/open-bot/seed/skills/$s" ]; then cp -a "/opt/open-bot/seed/skills/$s" "/home/sandbox/.config/opencode/skills/$s"; echo "seed:$s"; fi; done`,
      ])
      const seeded = new Set(
        (copySeed ?? "")
          .split("\n")
          .filter((line) => line.startsWith("seed:"))
          .map((line) => line.slice(5)),
      )
      const missing = profile.skills.filter((skill) => !seeded.has(skill))
      if (missing.length > 0 && desktopUp) {
        const rel = missing.map((skill) => `.config/opencode/skills/${skill}`)
        const b64 = await desktopTarBase64(user.id, rel)
        if (b64) {
          await sandboxExtractBase64(n.container, "/home/sandbox", b64)
          // Whatever still is not there was never on the desktop either.
          const check = await dockerQuiet([
            "exec",
            n.container,
            "sh",
            "-c",
            `for s in ${missing.map(shellQuote).join(" ")}; do [ -d "/home/sandbox/.config/opencode/skills/$s" ] && echo "have:$s"; done`,
          ])
          const have = new Set(
            (check ?? "")
              .split("\n")
              .filter((line) => line.startsWith("have:"))
              .map((line) => line.slice(5)),
          )
          skillsSkipped.push(...missing.filter((skill) => !have.has(skill)))
        } else {
          skillsSkipped.push(...missing)
        }
      } else {
        skillsSkipped.push(...missing)
      }
    }
    // Plugin MCP payload binaries (bounded: ob-plugin-* files only).
    const pluginBins = [
      ...new Set(
        resolved.included
          .map((name) => resolved.mcp[name]?.command?.[0] ?? "")
          .filter((head) => head.startsWith("/usr/local/bin/ob-plugin-")),
      ),
    ]
    if (pluginBins.length > 0 && desktopUp) {
      const b64 = await desktopTarBase64(
        user.id,
        pluginBins.map((bin) => bin.slice("/usr/local/".length)),
        "/usr/local",
      )
      if (b64)
        await sandboxExtractBase64(n.container, "/home/sandbox/.local", b64)
      // The entrypoint links ~/.local/bin/ob-plugin-* into place.
    }
    if (input.copyIn.length > 0) {
      if (!desktopUp)
        throw new HttpError(
          409,
          "desktop is not running for copyIn",
          "desktop_down",
        )
      const rel = input.copyIn.map((path) => path.slice("/home/agent/".length))
      const b64 = await desktopTarBase64(user.id, rel)
      if (!b64)
        throw new HttpError(
          502,
          "copyIn failed to read desktop files",
          "sandbox_copyin",
        )
      if (b64.length > Math.ceil((SANDBOX_COPYIN_MAX_BYTES * 4) / 3) + 8)
        throw new HttpError(413, "copyIn exceeds 50 MB", "sandbox_copyin")
      await sandboxExtractBase64(n.container, "/workspace", b64)
    }
    await docker([
      "exec",
      n.container,
      "sh",
      "-c",
      "mkdir -p /home/sandbox/.open-bot && touch /home/sandbox/.open-bot/ready",
    ])

    const ip = await containerIp(n.container, n.network)
    const base = `http://${ip}:4096`
    const headers = sandboxHeaders(password)
    if (!(await waitForSandboxHealth(base, headers))) {
      throw new HttpError(
        502,
        "sandbox did not become ready",
        "sandbox_unready",
      )
    }
    const sessionId = await createSession(
      base,
      headers,
      input.title,
      undefined,
      sandboxScopeRules(profile, Object.keys(configured)),
      SANDBOX_AGENT,
    )
    db.updateSandboxThread(id, { sessionId, state: "running" })
    const live = db.sandboxThread(user.id, id) ?? {
      ...row,
      sessionId,
      state: "running" as const,
    }
    if (input.hub)
      attachSandboxEvents(input.hub, db, user.id, live, { base, headers })
    return {
      row: live,
      base,
      headers,
      sessionId,
      mcp: { included: resolved.included, skipped: resolved.skipped },
      skillsSkipped,
    }
  } catch (error) {
    db.updateSandboxThread(id, { state: "error" })
    await destroySandbox(db, row, input.hub).catch(() => {})
    if (error instanceof HttpError) throw error
    throw new HttpError(
      502,
      error instanceof Error ? error.message : "sandbox launch failed",
      "sandbox_launch",
    )
  }
}

const sandboxStreams = new Map<string, AbortController>()

function handleSandboxEvent(
  hub: EventHub,
  db: Db,
  userId: string,
  row: SandboxThreadRow,
  daemon: { base: string; headers: Record<string, string> },
  event: HubEvent,
) {
  // Desktop observers (plugin hooks, delegation wakes, media capture,
  // queue flush) must never see sandbox events — they act on the
  // desktop. Only the dashboard fan-out, the idle clock, and the
  // headless permission auto-reject apply here.
  if (event.type === "session.idle" || event.type === "session.updated")
    touchSandbox(db, row.id)
  if (event.type === "permission.asked") {
    const props = (event.properties ?? {}) as { id?: unknown }
    if (typeof props.id === "string") {
      void fetch(`${daemon.base}/permission/${props.id}/reply`, {
        method: "POST",
        headers: daemon.headers,
        body: JSON.stringify({
          reply: "reject",
          message:
            "open-bot sandbox: this session is headless and cannot answer " +
            "permission requests. The sandbox profile defines what is " +
            "allowed; do not retry the call.",
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null)
    }
  }
  hub.emit(userId, event)
}

/** Stream the sandbox daemon's /event into the user's hub fan-out. */
export function attachSandboxEvents(
  hub: EventHub,
  db: Db,
  userId: string,
  row: SandboxThreadRow,
  daemon: { base: string; headers: Record<string, string> },
) {
  detachSandboxEvents(row.id)
  const abort = new AbortController()
  sandboxStreams.set(row.id, abort)
  void (async () => {
    const decoder = new TextDecoder()
    while (!abort.signal.aborted) {
      try {
        const response = await fetch(`${daemon.base}/event`, {
          headers: daemon.headers,
          signal: abort.signal,
        })
        if (response.ok && response.body) {
          const parser = createSseParser((event) =>
            handleSandboxEvent(hub, db, userId, row, daemon, event),
          )
          for await (const chunk of response.body) {
            parser.push(decoder.decode(chunk, { stream: true }))
          }
        }
      } catch {
        if (abort.signal.aborted) return
      }
      if (abort.signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  })()
}

export function detachSandboxEvents(id: string) {
  const abort = sandboxStreams.get(id)
  if (abort) {
    abort.abort()
    sandboxStreams.delete(id)
  }
}

/** Tear a sandbox fully down: abort, container, network, volume, hub
 * stream, password. Idempotent and best-effort on the docker side; the
 * row always lands in `destroyed` so the broker token dies with it. */
export async function destroySandbox(
  db: Db,
  row: SandboxThreadRow,
  hub?: EventHub,
) {
  detachSandboxEvents(row.id)
  const daemon = row.sessionId
    ? await sandboxDaemon(db, row.userId, row.sessionId).catch(() => null)
    : null
  if (daemon && row.sessionId) {
    await fetch(
      `${daemon.base}/session/${encodeURIComponent(row.sessionId)}/abort`,
      {
        method: "POST",
        headers: daemon.headers,
        signal: AbortSignal.timeout(5_000),
      },
    ).catch(() => null)
  }
  await dockerQuiet(["rm", "-f", row.container])
  const volume = sandboxNames(row.userId, row.id).volume
  await dockerQuiet(["volume", "rm", "-f", volume])
  if (inDocker && controlName)
    await dockerQuiet(["network", "disconnect", row.network, controlName])
  await dockerQuiet(["network", "rm", row.network])
  daemonPasswords.delete(row.id)
  db.updateSandboxThread(row.id, { state: "destroyed" })
  hub?.emit(row.userId, { type: "threads.changed" })
}

export async function destroySandboxBySession(
  db: Db,
  userId: string,
  sessionId: string,
  hub?: EventHub,
): Promise<boolean> {
  const row = db.sandboxBySession?.(sessionId) ?? null
  if (!row || row.userId !== userId) return false
  await destroySandbox(db, row, hub)
  return true
}

/** Destroy every live sandbox of a user (reset / user deletion). */
export async function destroyUserSandboxes(
  db: Db,
  userId: string,
  hub?: EventHub,
) {
  for (const row of db.liveSandboxes(userId))
    await destroySandbox(db, row, hub).catch(() => {})
}

const SWEEP_MS = 30_000
let sweeper: ReturnType<typeof setInterval> | null = null

/** TTL + idle expiry, plus dead-container detection. */
export function startSandboxSweeper(db: Db, hub?: EventHub) {
  if (sweeper) return
  sweeper = setInterval(() => {
    void (async () => {
      const now = Date.now()
      for (const row of db.liveSandboxes()) {
        const profile = sandboxProfileFromJson(row.profile)
        const idleDead = now - row.lastActiveAt > profile.idleMinutes * 60_000
        if (now >= row.expiresAt || idleDead) {
          await destroySandbox(db, row, hub).catch(() => {})
          continue
        }
        if (row.state === "running" && !(await isRunning(row.container)))
          db.updateSandboxThread(row.id, { state: "error" })
      }
    })()
  }, SWEEP_MS)
}

/** Boot reconcile: re-attach event streams for live rows (passwords are
 * recovered from the container env), destroy orphans and expired rows. */
export async function reconcileSandboxes(db: Db, hub?: EventHub) {
  const listed = await dockerQuiet([
    "ps",
    "-a",
    "--filter",
    "label=open-bot-role=sandbox",
    "--format",
    '{{.Names}} {{.Label "open-bot-sandbox"}}',
  ])
  const containers = new Map<string, string>()
  for (const line of (listed ?? "").split("\n")) {
    const [name, id] = line.trim().split(/\s+/)
    if (name && id) containers.set(id, name)
  }
  const liveIds = new Set<string>()
  for (const row of db.liveSandboxes()) {
    if (Date.now() >= row.expiresAt || !containers.has(row.id)) {
      await destroySandbox(db, row, hub).catch(() => {})
      continue
    }
    liveIds.add(row.id)
    const envOut = await dockerQuiet([
      "inspect",
      "-f",
      "{{range .Config.Env}}{{println .}}{{end}}",
      row.container,
    ])
    const password = (envOut ?? "")
      .split("\n")
      .find((line) => line.startsWith("OPENCODE_SERVER_PASSWORD="))
      ?.slice("OPENCODE_SERVER_PASSWORD=".length)
    if (!password || !row.sessionId) {
      await destroySandbox(db, row, hub).catch(() => {})
      continue
    }
    rememberSandboxPassword(row.id, password.trim())
    if (hub) {
      const daemon = await sandboxDaemon(db, row.userId, row.sessionId)
      if (daemon) attachSandboxEvents(hub, db, row.userId, row, daemon)
    }
  }
  for (const [id, name] of containers) {
    if (liveIds.has(id)) continue
    await dockerQuiet(["rm", "-f", name])
  }
}

/** Tar bytes of the sandbox /workspace. Works while running (exec) and
 * after the container died (throwaway reader over the volume); null
 * once destroyed. */
export async function exportSandboxWorkspace(
  row: SandboxThreadRow,
): Promise<Uint8Array | null> {
  if (row.state === "destroyed") return null
  const volume = sandboxNames(row.userId, row.id).volume
  let b64: string | null = null
  if (await isRunning(row.container)) {
    b64 = await dockerQuiet(
      [
        "exec",
        row.container,
        "sh",
        "-c",
        "tar -cf - -C /workspace . | base64 -w0",
      ],
      undefined,
      120_000,
    )
  }
  if (!b64) {
    b64 = await dockerQuiet(
      [
        "run",
        "--rm",
        "-v",
        `${volume}:/workspace`,
        "--entrypoint",
        "sh",
        sandboxImage,
        "-c",
        "tar -cf - -C /workspace . | base64 -w0",
      ],
      undefined,
      120_000,
    )
  }
  if (!b64) return null
  return new Uint8Array(Buffer.from(b64.trim(), "base64"))
}

async function exportSandboxToDesktop(
  row: SandboxThreadRow,
): Promise<string | null> {
  const bytes = await exportSandboxWorkspace(row)
  if (!bytes) return null
  const dest = `/home/agent/workspace/sandbox-${row.id}`
  const b64 = Buffer.from(bytes).toString("base64")
  const container = names(row.userId).opencode
  const out = await dockerQuiet(
    [
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      container,
      "sh",
      "-c",
      `mkdir -p ${shellQuote(dest)} && base64 -d | tar -xf - -C ${shellQuote(dest)}`,
    ],
    b64,
    120_000,
  )
  return out === null ? null : dest
}

/** Resolve a launch-time `sandbox` field: a profile name (built-in or
 * stored) or an inline profile object. */
export function resolveSandboxProfileRef(
  db: Db,
  userId: string,
  value: unknown,
): { profile: SandboxProfile; profileId: string | null } | { error: string } {
  if (typeof value === "string") {
    const builtin = builtinSandboxProfile(value.trim())
    if (builtin) return { profile: builtin, profileId: null }
    const row = db.sandboxProfileByName(userId, value.trim())
    if (!row) return { error: `unknown sandbox profile "${value}"` }
    return { profile: sandboxProfileFromJson(row.profile), profileId: row.id }
  }
  const parsed = parseSandboxProfile(value)
  if ("error" in parsed) return parsed
  return { profile: parsed.profile, profileId: null }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

/** GET /api/sandbox-threads — the dashboard thread list merge source:
 * live sandbox rows with their session titles and busy state read from
 * each daemon (fail-soft: an unreachable daemon lists by profile name). */
export async function listSandboxThreads(
  db: Db,
  user: User,
): Promise<Response> {
  const rows = (db.liveSandboxes?.(user.id) ?? []).filter(
    (row) => row.sessionId,
  )
  const threads = await Promise.all(
    rows.map(async (row) => {
      const profile = sandboxProfileFromJson(row.profile)
      let title = `Bac à sable · ${profile.name}`
      let running = false
      const daemon = row.sessionId
        ? await sandboxDaemon(db, user.id, row.sessionId)
        : null
      if (daemon && row.sessionId) {
        const sessionRes = await fetch(
          `${daemon.base}/session/${encodeURIComponent(row.sessionId)}`,
          { headers: daemon.headers, signal: AbortSignal.timeout(5_000) },
        ).catch(() => null)
        const info = (await sessionRes?.json().catch(() => null)) as {
          title?: unknown
        } | null
        if (typeof info?.title === "string" && info.title) title = info.title
        const statusRes = await fetch(`${daemon.base}/session/status`, {
          headers: daemon.headers,
          signal: AbortSignal.timeout(5_000),
        }).catch(() => null)
        const statusBody = (await statusRes?.json().catch(() => null)) as Record<
          string,
          { type?: unknown } | undefined
        > | null
        const entry = statusBody?.[row.sessionId]
        running = Boolean(entry && entry.type && entry.type !== "idle")
      }
      return {
        sessionId: row.sessionId,
        sandboxId: row.id,
        title,
        profile: profile.name,
        network: profile.network,
        bash: profile.tools.bash,
        state: row.state,
        running,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        lastActiveAt: row.lastActiveAt,
      }
    }),
  )
  return json({ threads })
}

export function isSandboxProfilesRequest(pathname: string): boolean {
  return (
    pathname === "/api/sandbox-profiles" ||
    pathname.startsWith("/api/sandbox-profiles/")
  )
}

export function isSandboxRequest(pathname: string): boolean {
  return pathname === "/api/sandbox" || pathname.startsWith("/api/sandbox/")
}

/** Profile CRUD — session-cookie only at dispatch: profiles are
 * capability grants, so the agent token may launch with one but never
 * define or widen one. Built-ins (`locked`, `code`) are listed with
 * `builtin: true` and have no row. */
export async function handleSandboxProfiles(
  req: Request,
  url: URL,
  db: Db,
  user: User,
): Promise<Response> {
  if (url.pathname === "/api/sandbox-profiles" && req.method === "GET") {
    const rows = db.sandboxProfiles(user.id).map((row) => ({
      id: row.id,
      name: row.name,
      profile: sandboxProfileFromJson(row.profile),
      builtin: false,
    }))
    return json({
      profiles: [
        {
          id: "locked",
          name: "locked",
          profile: LOCKED_SANDBOX_PROFILE,
          builtin: true,
        },
        {
          id: "code",
          name: "code",
          profile: CODE_SANDBOX_PROFILE,
          builtin: true,
        },
        ...rows,
      ],
    })
  }
  if (url.pathname === "/api/sandbox-profiles" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseSandboxProfile(body.profile ?? body)
    if ("error" in parsed) return json({ error: parsed.error }, 400)
    if (builtinSandboxProfile(parsed.profile.name))
      return json(
        { error: `"${parsed.profile.name}" is a built-in sandbox profile` },
        409,
      )
    if (db.sandboxProfileByName(user.id, parsed.profile.name))
      return json(
        { error: `a sandbox profile named "${parsed.profile.name}" exists` },
        409,
      )
    const now = Date.now()
    const row = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: parsed.profile.name,
      profile: JSON.stringify(parsed.profile),
      createdAt: now,
      updatedAt: now,
    }
    db.saveSandboxProfile(row)
    return json({ id: row.id, name: row.name, profile: parsed.profile }, 201)
  }
  const ref = url.pathname.match(/^\/api\/sandbox-profiles\/([^/]+)$/)
  if (ref) {
    const id = decodeURIComponent(ref[1] ?? "")
    const existing = db
      .sandboxProfiles(user.id)
      .find((row) => row.id === id || row.name === id)
    if (!existing) return json({ error: "sandbox profile not found" }, 404)
    if (req.method === "GET")
      return json({
        id: existing.id,
        name: existing.name,
        profile: sandboxProfileFromJson(existing.profile),
      })
    if (req.method === "PUT") {
      const body = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      const parsed = parseSandboxProfile(body.profile ?? body)
      if ("error" in parsed) return json({ error: parsed.error }, 400)
      const clash = db.sandboxProfileByName(user.id, parsed.profile.name)
      if (
        (clash && clash.id !== existing.id) ||
        builtinSandboxProfile(parsed.profile.name)
      )
        return json(
          { error: `a sandbox profile named "${parsed.profile.name}" exists` },
          409,
        )
      db.saveSandboxProfile({
        ...existing,
        name: parsed.profile.name,
        profile: JSON.stringify(parsed.profile),
        updatedAt: Date.now(),
      })
      return json({
        id: existing.id,
        name: parsed.profile.name,
        profile: parsed.profile,
      })
    }
    if (req.method === "DELETE") {
      db.deleteSandboxProfile(user.id, existing.id)
      return json({ deleted: true })
    }
  }
  return json({ error: "not found" }, 404)
}

/** /api/sandbox/:id/export[/export-to-desktop|/extend] + DELETE. */
export async function handleSandbox(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub?: EventHub,
): Promise<Response> {
  const ref = url.pathname.match(
    /^\/api\/sandbox\/([^/]+)(?:\/(export|export-to-desktop|extend))?$/,
  )
  if (!ref) return json({ error: "not found" }, 404)
  const id = decodeURIComponent(ref[1] ?? "")
  const row = db.sandboxThread(user.id, id)
  if (!row) return json({ error: "sandbox not found" }, 404)
  const action = ref[2]
  if (!action && req.method === "GET") {
    return json({
      id: row.id,
      sessionId: row.sessionId,
      profile: sandboxProfileFromJson(row.profile),
      state: row.state,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastActiveAt: row.lastActiveAt,
    })
  }
  if (!action && req.method === "DELETE") {
    await destroySandbox(db, row, hub)
    return json({ destroyed: true })
  }
  if (action === "extend" && req.method === "POST") {
    if (row.state !== "running" && row.state !== "starting")
      return json({ error: "sandbox is not running" }, 409)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const minutes = typeof body.minutes === "number" ? body.minutes : 60
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > SANDBOX_TTL_MAX)
      return json({ error: "minutes out of range" }, 400)
    const expiresAt = Math.max(row.expiresAt, Date.now()) + minutes * 60_000
    const capped = Math.min(expiresAt, row.createdAt + SANDBOX_TTL_MAX * 60_000)
    db.updateSandboxThread(id, { expiresAt: capped, lastActiveAt: Date.now() })
    return json({ expiresAt: capped })
  }
  if (action === "export" && req.method === "GET") {
    if (row.state === "destroyed")
      return json({ error: "sandbox destroyed", code: "sandbox_gone" }, 410)
    const bytes = await exportSandboxWorkspace(row)
    if (!bytes) return json({ error: "export failed" }, 502)
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="sandbox-${id}.tar"`,
      },
    })
  }
  if (action === "export-to-desktop" && req.method === "POST") {
    if (row.state === "destroyed")
      return json({ error: "sandbox destroyed", code: "sandbox_gone" }, 410)
    const dest = await exportSandboxToDesktop(row)
    if (!dest) return json({ error: "export to desktop failed" }, 502)
    hub?.emit(user.id, { type: "threads.changed" })
    return json({ path: dest })
  }
  return json({ error: "not found" }, 404)
}
