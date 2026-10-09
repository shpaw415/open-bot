export const MANIFEST_FILE = "open-bot.plugin.json"

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\dA-Za-z.-]+)?$/
// Development tags (beta-1, staging.2, rc) for stress-testing before a stable
// release; force-movable git tag v<version>, hidden from marketplace search.
export const DEV_VERSION_PATTERN = /^[a-z][a-z0-9._-]{0,31}$/
// Keep .source identical to the schema JSON version.pattern (schema.test.ts).
export const PLUGIN_VERSION_PATTERN = new RegExp(
  `${SEMVER_PATTERN.source}|${DEV_VERSION_PATTERN.source}`,
)
export function isDevVersion(version: string): boolean {
  if (SEMVER_PATTERN.test(version)) return version.includes("-")
  return DEV_VERSION_PATTERN.test(version)
}
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/
export const COMMAND_PATTERN = /^\/?[a-z0-9][a-z0-9-]{0,31}$/
export const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const TOOL_GLOB_PATTERN = /^[\w*_-]{1,64}$/
// Agent definitions shipped by the platform itself; plugins add new agents
// and must not shadow these (use agentTools to adjust their tools).
export const RESERVED_AGENT_NAMES = new Set([
  "build",
  "plan",
  "general",
  "title",
  "namer",
])

// Repo-relative path inside the release tarball: no leading slash, no "..",
// no backslashes, each segment a safe name.
export function isValidFileSource(source: string): boolean {
  if (!source || source.length > 200 || source.includes("\\")) return false
  if (source.startsWith("/")) return false
  const segments = source.split("/")
  return (
    segments.length > 0 &&
    segments.length <= 8 &&
    segments.every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        /^[\w.-]{1,64}$/.test(segment),
    )
  )
}
export const CARD_KINDS = [
  "markdown",
  "stat",
  "table",
  "list",
  "link",
  "iframe",
] as const

export type PluginCard = {
  kind: (typeof CARD_KINDS)[number]
  text?: string
  label?: string
  value?: string
  hint?: string
  columns?: string[]
  rows?: string[][] | string
  items?: string[] | string
  url?: string
  height?: number
}

export type PluginSkill = {
  name: string
  description: string
  body: string
}

export type PluginPersona = {
  name: string
  instruction: string
}

export type PluginCron = {
  name: string
  message: string
  everySeconds?: number
  cronExpr?: string
}

export type PluginTool = {
  name: string
  content: string
  exec?: boolean
}

// A payload file shipped in the plugin's release tarball (not inline in the
// manifest). Installed next to tools as /usr/local/bin/ob-plugin-<id>-<name>.
export type PluginFile = {
  name: string
  source: string
  exec?: boolean
}

export type PluginSetup = {
  commands?: string[]
  uninstall?: string[]
}

export type PluginConfig = {
  key: string
  label: string
  def: string
  secret?: boolean
}

export type PluginTab = {
  id: string
  title: string
  kind: "page" | "iframe"
  url?: string
  cards?: PluginCard[]
}

export type PluginTextbox = {
  renderers?: {
    type: string
    title: string
    spec: PluginCard[]
  }[]
  commands?: {
    command: string
    title: string
    template: string
  }[]
  buttons?: {
    id: string
    label: string
    template: string
  }[]
  validators?: {
    pattern: string
    message: string
  }[]
  attachments?: {
    accept: string[]
    maxFiles?: number
  }
}

export type PluginPermissions = {
  vaultRead?: string[]
  vaultCreate?: string[]
  desktopTools?: boolean
  opencode?: boolean
}

export type PluginManifest = {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string
  category: string
  tags: string[]
  permissions?: PluginPermissions
  skills?: PluginSkill[]
  personas?: PluginPersona[]
  cron?: PluginCron[]
  tools?: PluginTool[]
  files?: PluginFile[]
  configs?: PluginConfig[]
  setup?: PluginSetup
  dashboard?: {
    tabs?: PluginTab[]
  }
  textbox?: PluginTextbox
  opencode?: {
    plugin?: string[]
    mcp?: Record<string, unknown>
    // New agent definitions, deep-merged into opencode.json's agent map.
    // Built-in agent names are rejected — patch an existing agent's tools
    // with agentTools instead.
    agents?: Record<string, Record<string, unknown>>
    // Tool enable/disable globs patched into existing agents,
    // e.g. { "build": { "blender_*": false } }.
    agentTools?: Record<string, Record<string, boolean>>
    // Standing instructions injected into the agent's context (loaded next to
    // AGENTS.md via opencode.json's instructions array). Behavioral rules the
    // agent must always follow while the plugin is installed — never secrets.
    agentsMd?: string
  }
}

export type ManifestIssue = { path: string; message: string }

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ManifestIssue[] }

const MAX_TEXT = 64 * 1024
const MAX_AGENTS_MD = 4000
const MAX_MANIFEST = 512 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function strArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > max) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return null
    out.push(item)
  }
  return out
}

export function pluginPermissionSummary(manifest: PluginManifest): string[] {
  const summary: string[] = []
  const perms: PluginPermissions & { skills?: boolean; personas?: boolean } =
    manifest.permissions ?? {}
  if (perms.skills || (manifest.skills?.length ?? 0) > 0)
    summary.push("Installs agent skills")
  if (perms.personas || manifest.personas?.length)
    summary.push("Creates personalities")
  if (manifest.cron?.length) summary.push("Creates scheduled jobs")
  if (manifest.configs?.length) summary.push("Adds settings")
  if (perms.vaultRead?.length)
    summary.push(`Reads vault keys: ${perms.vaultRead.join(", ")}`)
  if (perms.vaultCreate?.length)
    summary.push(`Adds vault keys: ${perms.vaultCreate.join(", ")}`)
  if (perms.desktopTools || manifest.tools?.length)
    summary.push("Installs tools in the desktop container")
  if ((manifest.files?.length ?? 0) > 0)
    summary.push(
      `Installs ${manifest.files?.length} payload file${
        (manifest.files?.length ?? 0) === 1 ? "" : "s"
      } from the reviewed release into the desktop`,
    )
  const setupCommands = manifest.setup?.commands?.length ?? 0
  if (setupCommands > 0)
    summary.push(
      `Runs ${setupCommands} shell command${setupCommands === 1 ? "" : "s"} as root in the desktop at install and on every desktop start`,
    )
  if ((manifest.setup?.uninstall?.length ?? 0) > 0)
    summary.push("Runs shell commands on uninstall")
  if (manifest.dashboard?.tabs?.length) summary.push("Adds dashboard tabs")
  if (manifest.textbox) summary.push("Extends the chat composer")
  const agents = Object.keys(manifest.opencode?.agents ?? {})
  if (agents.length > 0)
    summary.push(`Adds agent workers: ${agents.join(", ")}`)
  const agentTools = Object.keys(manifest.opencode?.agentTools ?? {})
  if (agentTools.length > 0)
    summary.push(`Adjusts agent tools for: ${agentTools.join(", ")}`)
  if (manifest.opencode?.agentsMd)
    summary.push("Adds standing instructions to the agent (AGENTS.md)")
  if (perms.opencode || manifest.opencode)
    summary.push("Extends the agent (OpenCode plugins / MCP)")
  return summary
}

function validateCard(card: unknown, path: string, issues: ManifestIssue[]) {
  if (!isRecord(card)) {
    issues.push({ path, message: "card must be an object" })
    return
  }
  const kind = card.kind
  if (typeof kind !== "string" || !CARD_KINDS.includes(kind as never)) {
    issues.push({
      path,
      message: `card.kind must be one of ${CARD_KINDS.join(", ")}`,
    })
    return
  }
  const text = card.text ?? card.label ?? card.value
  if (typeof text === "string" && text.length > MAX_TEXT) {
    issues.push({ path, message: "card text is too long" })
  }
  if (kind === "iframe" || kind === "link") {
    const url = str(card.url)
    if (!url || !/^https?:\/\//.test(url)) {
      issues.push({ path, message: `${kind} card needs an http(s) url` })
    }
  }
  if (kind === "table") {
    if (!strArray(card.columns, 32)) {
      issues.push({ path, message: "table card needs columns" })
    }
  }
}

function validateTextbox(textbox: unknown, issues: ManifestIssue[]) {
  if (!isRecord(textbox)) {
    issues.push({ path: "textbox", message: "textbox must be an object" })
    return
  }
  const renderers = Array.isArray(textbox.renderers) ? textbox.renderers : []
  if (renderers.length > 32) {
    issues.push({ path: "textbox.renderers", message: "too many renderers" })
  }
  for (const [index, renderer] of renderers.entries()) {
    const path = `textbox.renderers[${index}]`
    if (!isRecord(renderer)) {
      issues.push({ path, message: "renderer must be an object" })
      continue
    }
    const type = str(renderer.type)
    if (!type || !SLUG_PATTERN.test(type)) {
      issues.push({ path, message: "renderer.type must be a slug" })
    }
    if (!str(renderer.title)) {
      issues.push({ path, message: "renderer.title is required" })
    }
    if (!Array.isArray(renderer.spec) || renderer.spec.length === 0) {
      issues.push({ path, message: "renderer.spec must be a card array" })
      continue
    }
    for (const [cardIndex, card] of renderer.spec.entries()) {
      validateCard(card, `${path}.spec[${cardIndex}]`, issues)
    }
  }
  const commands = Array.isArray(textbox.commands) ? textbox.commands : []
  if (commands.length > 32) {
    issues.push({ path: "textbox.commands", message: "too many commands" })
  }
  for (const [index, command] of commands.entries()) {
    const path = `textbox.commands[${index}]`
    const name = str(command?.command)
    if (!name || !COMMAND_PATTERN.test(name)) {
      issues.push({
        path,
        message:
          "command must match /name (lowercase letters, digits, hyphens)",
      })
    }
    if (!str(command?.title)) {
      issues.push({ path, message: "command.title is required" })
    }
    const template = str(command?.template)
    if (!template || template.length > 2000) {
      issues.push({ path, message: "command.template is required (max 2000)" })
    }
  }
  const buttons = Array.isArray(textbox.buttons) ? textbox.buttons : []
  if (buttons.length > 16) {
    issues.push({ path: "textbox.buttons", message: "too many buttons" })
  }
  for (const [index, button] of buttons.entries()) {
    const path = `textbox.buttons[${index}]`
    if (!str(button?.id) || !SLUG_PATTERN.test(str(button?.id) ?? "")) {
      issues.push({ path, message: "button.id must be a slug" })
    }
    if (!str(button?.label)) {
      issues.push({ path, message: "button.label is required" })
    }
    const template = str(button?.template)
    if (!template || template.length > 2000) {
      issues.push({ path, message: "button.template is required (max 2000)" })
    }
  }
  const validators = Array.isArray(textbox.validators) ? textbox.validators : []
  if (validators.length > 16) {
    issues.push({ path: "textbox.validators", message: "too many validators" })
  }
  for (const [index, validator] of validators.entries()) {
    const path = `textbox.validators[${index}]`
    const pattern = str(validator?.pattern)
    if (!pattern || pattern.length > 500) {
      issues.push({ path, message: "validator.pattern is required" })
      continue
    }
    try {
      new RegExp(pattern)
    } catch {
      issues.push({ path, message: "validator.pattern is not a valid regex" })
    }
    if (!str(validator?.message)) {
      issues.push({ path, message: "validator.message is required" })
    }
  }
  if (textbox.attachments !== undefined) {
    const attachments = textbox.attachments
    if (!isRecord(attachments)) {
      issues.push({ path: "textbox.attachments", message: "must be an object" })
    } else {
      const accept = strArray(attachments.accept, 16)
      if (!accept || accept.length === 0) {
        issues.push({
          path: "textbox.attachments.accept",
          message: "accept must be a list of mime types or extensions",
        })
      }
      const maxFiles = attachments.maxFiles
      if (
        maxFiles !== undefined &&
        (typeof maxFiles !== "number" || maxFiles < 1 || maxFiles > 10)
      ) {
        issues.push({
          path: "textbox.attachments.maxFiles",
          message: "maxFiles must be 1-10",
        })
      }
    }
  }
}

function validateSetupCommands(
  setup: unknown,
  key: "commands" | "uninstall",
  issues: ManifestIssue[],
): string[] {
  if (!isRecord(setup) || setup[key] === undefined) return []
  const list = strArray(setup[key], 16)
  if (!list || list.some((item) => !item.trim() || item.length > 500)) {
    issues.push({
      path: `setup.${key}`,
      message:
        "must be a list of shell commands (max 16, each 1-500 chars, non-empty)",
    })
    return []
  }
  return list
}

export function validatePluginManifest(input: unknown): ManifestValidation {
  const issues: ManifestIssue[] = []
  if (!isRecord(input))
    return {
      ok: false,
      issues: [{ path: "", message: "manifest must be an object" }],
    }
  if (JSON.stringify(input).length > MAX_MANIFEST) {
    return {
      ok: false,
      issues: [{ path: "", message: "manifest is too large" }],
    }
  }

  const id = str(input.id)
  if (!id || !PLUGIN_ID_PATTERN.test(id)) {
    issues.push({
      path: "id",
      message: "id must be 2-63 lowercase letters, digits, or hyphens",
    })
  }
  const name = str(input.name)
  if (!name || name.length > 64) {
    issues.push({ path: "name", message: "name is required (max 64)" })
  }
  const version = str(input.version)
  if (!version || !PLUGIN_VERSION_PATTERN.test(version)) {
    issues.push({
      path: "version",
      message: "version must be semver (X.Y.Z) or a dev tag (e.g. beta-1)",
    })
  }
  const description = str(input.description)
  if (!description || description.length > 500) {
    issues.push({
      path: "description",
      message: "description is required (max 500)",
    })
  }
  const author = str(input.author)
  if (!author || author.length > 64) {
    issues.push({ path: "author", message: "author is required (max 64)" })
  }
  const repo = str(input.repo)
  if (!repo || !GITHUB_REPO_PATTERN.test(repo)) {
    issues.push({ path: "repo", message: "repo must be owner/name" })
  }
  const category = str(input.category)
  if (!category || category.length > 32) {
    issues.push({ path: "category", message: "category is required (max 32)" })
  }
  const tags = input.tags === undefined ? [] : strArray(input.tags, 8)
  if (!tags) {
    issues.push({
      path: "tags",
      message: "tags must be a list of strings (max 8)",
    })
  }

  const permissions = input.permissions ?? {}
  if (!isRecord(permissions)) {
    issues.push({
      path: "permissions",
      message: "permissions must be an object",
    })
  }
  const vaultRead =
    isRecord(permissions) && permissions.vaultRead !== undefined
      ? strArray(permissions.vaultRead, 32)
      : []
  if (!vaultRead) {
    issues.push({
      path: "permissions.vaultRead",
      message: "must be a slug list",
    })
  }
  const vaultCreate =
    isRecord(permissions) && permissions.vaultCreate !== undefined
      ? strArray(permissions.vaultCreate, 32)
      : []
  if (!vaultCreate) {
    issues.push({
      path: "permissions.vaultCreate",
      message: "must be a slug list",
    })
  }

  const skills = input.skills === undefined ? [] : input.skills
  if (!Array.isArray(skills) || skills.length > 32) {
    issues.push({ path: "skills", message: "skills must be a list (max 32)" })
  } else {
    for (const [index, skill] of skills.entries()) {
      const path = `skills[${index}]`
      const skillName = str(skill?.name)
      if (!skillName || !SLUG_PATTERN.test(skillName)) {
        issues.push({ path, message: "skill.name must be a slug" })
      }
      const skillDescription = str(skill?.description)
      if (!skillDescription || skillDescription.length > 1024) {
        issues.push({
          path,
          message: "skill.description is required (max 1024, one line)",
        })
      } else if (skillDescription.includes("\n")) {
        issues.push({ path, message: "skill.description must be one line" })
      }
      const body = str(skill?.body)
      if (!body || !body.trim() || body.length > MAX_TEXT) {
        issues.push({ path, message: "skill.body is required (max 64k)" })
      }
    }
  }

  const personas = input.personas === undefined ? [] : input.personas
  if (!Array.isArray(personas) || personas.length > 32) {
    issues.push({
      path: "personas",
      message: "personas must be a list (max 32)",
    })
  } else {
    for (const [index, persona] of personas.entries()) {
      const personaName = str(persona?.name)
      if (!personaName || personaName.length > 48) {
        issues.push({
          path: `personas[${index}]`,
          message: "persona.name is required (max 48)",
        })
      }
      const instruction = str(persona?.instruction)
      if (!instruction || instruction.length > 2000) {
        issues.push({
          path: `personas[${index}]`,
          message: "persona.instruction is required (max 2000)",
        })
      }
    }
  }

  const cron = input.cron === undefined ? [] : input.cron
  if (!Array.isArray(cron) || cron.length > 32) {
    issues.push({ path: "cron", message: "cron must be a list (max 32)" })
  } else {
    for (const [index, job] of cron.entries()) {
      const path = `cron[${index}]`
      const jobName = str(job?.name)
      if (!jobName || jobName.length > 64) {
        issues.push({ path, message: "cron.name is required (max 64)" })
      }
      const message = str(job?.message)
      if (!message || message.length > 8000) {
        issues.push({ path, message: "cron.message is required (max 8000)" })
      }
      const hasEvery = typeof job?.everySeconds === "number"
      const hasCron = typeof job?.cronExpr === "string"
      if (hasEvery === hasCron) {
        issues.push({
          path,
          message: "cron needs exactly one of everySeconds or cronExpr",
        })
      }
      if (
        hasEvery &&
        (job.everySeconds < 60 || job.everySeconds > 31_536_000)
      ) {
        issues.push({
          path,
          message: "cron.everySeconds must be 60-31536000",
        })
      }
    }
  }

  const tools = input.tools === undefined ? [] : input.tools
  if (!Array.isArray(tools) || tools.length > 32) {
    issues.push({ path: "tools", message: "tools must be a list (max 32)" })
  } else {
    for (const [index, tool] of tools.entries()) {
      const path = `tools[${index}]`
      const toolName = str(tool?.name)
      if (!toolName || !SLUG_PATTERN.test(toolName)) {
        issues.push({ path, message: "tool.name must be a slug" })
      }
      const content = str(tool?.content)
      if (!content || content.length > MAX_TEXT) {
        issues.push({ path, message: "tool.content is required (max 64k)" })
      }
    }
  }

  const files = input.files === undefined ? [] : input.files
  if (!Array.isArray(files) || files.length > 32) {
    issues.push({ path: "files", message: "files must be a list (max 32)" })
  } else {
    const seenFiles = new Set<string>()
    for (const [index, file] of files.entries()) {
      const path = `files[${index}]`
      const fileName = str(file?.name)
      if (!fileName || !FILE_NAME_PATTERN.test(fileName)) {
        issues.push({
          path,
          message:
            "file.name must match a file name (lowercase letters, digits, dot, hyphen, underscore)",
        })
      } else if (seenFiles.has(fileName)) {
        issues.push({ path, message: "file.name must be unique" })
      } else {
        seenFiles.add(fileName)
      }
      const source = str(file?.source)
      if (!source || !isValidFileSource(source)) {
        issues.push({
          path,
          message:
            "file.source must be a repo-relative path inside the release tarball (no leading /, no ..)",
        })
      }
      if (file?.exec !== undefined && typeof file.exec !== "boolean") {
        issues.push({ path, message: "file.exec must be a boolean" })
      }
    }
  }

  const setupCommands = validateSetupCommands(input.setup, "commands", issues)
  const setupUninstall = validateSetupCommands(input.setup, "uninstall", issues)

  const configs = input.configs === undefined ? [] : input.configs
  if (!Array.isArray(configs) || configs.length > 64) {
    issues.push({ path: "configs", message: "configs must be a list (max 64)" })
  } else {
    for (const [index, config] of configs.entries()) {
      const path = `configs[${index}]`
      const key = str(config?.key)
      if (!key || !SLUG_PATTERN.test(key)) {
        issues.push({ path, message: "config.key must be a slug" })
      }
      const configLabel = str(config?.label)
      if (!configLabel || configLabel.length > 128) {
        issues.push({ path, message: "config.label is required (max 128)" })
      }
      if (typeof config?.def !== "string" || config.def.length > 2000) {
        issues.push({ path, message: "config.def must be a string (max 2000)" })
      }
    }
  }

  if (input.dashboard !== undefined) {
    const dashboard = input.dashboard
    if (!isRecord(dashboard)) {
      issues.push({ path: "dashboard", message: "dashboard must be an object" })
    } else {
      const tabs = dashboard.tabs ?? []
      if (!Array.isArray(tabs) || tabs.length > 8) {
        issues.push({
          path: "dashboard.tabs",
          message: "tabs must be a list (max 8)",
        })
      } else {
        const seen = new Set<string>()
        for (const [index, tab] of tabs.entries()) {
          const path = `dashboard.tabs[${index}]`
          const tabId = str(tab?.id)
          if (!tabId || !SLUG_PATTERN.test(tabId)) {
            issues.push({ path, message: "tab.id must be a slug" })
          } else if (seen.has(tabId)) {
            issues.push({ path, message: "tab.id must be unique" })
          } else {
            seen.add(tabId)
          }
          const tabTitle = str(tab?.title)
          if (!tabTitle || tabTitle.length > 48) {
            issues.push({ path, message: "tab.title is required (max 48)" })
          }
          const kind = str(tab?.kind)
          if (kind !== "page" && kind !== "iframe") {
            issues.push({ path, message: "tab.kind must be page or iframe" })
          } else if (
            kind === "iframe" &&
            !/^https?:\/\//.test(str(tab?.url) ?? "")
          ) {
            issues.push({ path, message: "iframe tab needs an http(s) url" })
          } else if (kind === "page") {
            const cards = tab.cards ?? []
            if (
              !Array.isArray(cards) ||
              cards.length === 0 ||
              cards.length > 64
            ) {
              issues.push({ path, message: "page tab needs 1-64 cards" })
            } else {
              for (const [cardIndex, card] of cards.entries()) {
                validateCard(card, `${path}.cards[${cardIndex}]`, issues)
              }
            }
          }
        }
      }
    }
  }

  if (input.textbox !== undefined) validateTextbox(input.textbox, issues)

  if (input.opencode !== undefined) {
    const opencode = input.opencode
    if (!isRecord(opencode)) {
      issues.push({ path: "opencode", message: "opencode must be an object" })
    } else {
      if (opencode.plugin !== undefined) {
        const plugins = strArray(opencode.plugin, 16)
        if (!plugins || plugins.some((item) => !/^[\w@/.-]+$/.test(item))) {
          issues.push({
            path: "opencode.plugin",
            message: "plugin must be a list of npm package specs",
          })
        }
      }
      if (opencode.mcp !== undefined && !isRecord(opencode.mcp)) {
        issues.push({ path: "opencode.mcp", message: "mcp must be an object" })
      } else if (
        isRecord(opencode.mcp) &&
        Object.keys(opencode.mcp).length > 16
      ) {
        issues.push({ path: "opencode.mcp", message: "too many mcp servers" })
      }
      if (opencode.agents !== undefined) {
        if (!isRecord(opencode.agents)) {
          issues.push({
            path: "opencode.agents",
            message: "agents must be an object",
          })
        } else {
          const names = Object.keys(opencode.agents)
          if (names.length > 8) {
            issues.push({
              path: "opencode.agents",
              message: "too many agents (max 8)",
            })
          }
          for (const agentName of names) {
            const path = `opencode.agents.${agentName}`
            if (!AGENT_NAME_PATTERN.test(agentName)) {
              issues.push({
                path,
                message:
                  "agent name must be 1-32 lowercase letters, digits, or hyphens",
              })
            } else if (RESERVED_AGENT_NAMES.has(agentName)) {
              issues.push({
                path,
                message: `agent name ${agentName} is reserved; use opencode.agentTools to adjust built-in agents`,
              })
            }
            const def = opencode.agents[agentName]
            if (!isRecord(def)) {
              issues.push({
                path,
                message: "agent definition must be an object",
              })
            } else if (JSON.stringify(def).length > 8 * 1024) {
              issues.push({ path, message: "agent definition is too large" })
            }
          }
        }
      }
      if (opencode.agentTools !== undefined) {
        if (!isRecord(opencode.agentTools)) {
          issues.push({
            path: "opencode.agentTools",
            message: "agentTools must be an object",
          })
        } else {
          const names = Object.keys(opencode.agentTools)
          if (names.length > 8) {
            issues.push({
              path: "opencode.agentTools",
              message: "too many agents (max 8)",
            })
          }
          for (const agentName of names) {
            const path = `opencode.agentTools.${agentName}`
            if (!AGENT_NAME_PATTERN.test(agentName)) {
              issues.push({
                path,
                message:
                  "agent name must be 1-32 lowercase letters, digits, or hyphens",
              })
            }
            const globs = opencode.agentTools[agentName]
            if (!isRecord(globs)) {
              issues.push({
                path,
                message:
                  "agentTools entry must be an object of glob -> boolean",
              })
              continue
            }
            const globKeys = Object.keys(globs)
            if (globKeys.length > 16) {
              issues.push({
                path,
                message: "too many tool globs (max 16 per agent)",
              })
            }
            for (const glob of globKeys) {
              if (!TOOL_GLOB_PATTERN.test(glob)) {
                issues.push({
                  path,
                  message:
                    "tool glob must be 1-64 letters, digits, underscore, hyphen, or *",
                })
              }
              if (typeof globs[glob] !== "boolean") {
                issues.push({
                  path,
                  message: "tool glob value must be a boolean",
                })
              }
            }
          }
        }
      }
      if (opencode.agentsMd !== undefined) {
        const text = opencode.agentsMd
        if (
          typeof text !== "string" ||
          !text.trim() ||
          text.length > MAX_AGENTS_MD
        ) {
          issues.push({
            path: "opencode.agentsMd",
            message: `agentsMd must be a non-empty string (max ${MAX_AGENTS_MD})`,
          })
        }
      }
    }
  }

  if (issues.length > 0 || !id || !name || !version || !description) {
    return { ok: false, issues }
  }
  if (!author || !repo || !category) {
    return { ok: false, issues }
  }
  const manifest: PluginManifest = {
    id,
    name,
    version,
    description,
    author,
    repo,
    category,
    tags: tags ?? [],
    permissions: {
      vaultRead: vaultRead ?? [],
      vaultCreate: vaultCreate ?? [],
      desktopTools: isRecord(permissions) && permissions.desktopTools === true,
      opencode: isRecord(permissions) && permissions.opencode === true,
    },
    skills: skills as PluginSkill[],
    personas: personas as PluginPersona[],
    cron: cron as PluginCron[],
    tools: tools as PluginTool[],
    files: files as PluginFile[],
    configs: configs as PluginConfig[],
    setup: isRecord(input.setup)
      ? {
          commands: setupCommands,
          uninstall: setupUninstall,
        }
      : undefined,
    dashboard: isRecord(input.dashboard)
      ? { tabs: (input.dashboard.tabs ?? []) as PluginTab[] }
      : undefined,
    textbox: (input.textbox ?? undefined) as PluginTextbox | undefined,
    opencode: (input.opencode ?? undefined) as
      | PluginManifest["opencode"]
      | undefined,
  }
  return { ok: true, manifest }
}

export function parsePluginManifest(raw: string): ManifestValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          message: `invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
        },
      ],
    }
  }
  return validatePluginManifest(parsed)
}

export function manifestIssuesText(issues: ManifestIssue[]): string {
  return issues
    .map((issue) => `${issue.path || "manifest"}: ${issue.message}`)
    .join("\n")
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : value
  })
}

export function resolveCardData(
  card: PluginCard,
  data: Record<string, unknown>,
): PluginCard {
  const resolved: PluginCard = { ...card }
  for (const field of ["text", "label", "value", "hint", "url"] as const) {
    const value = resolved[field]
    if (typeof value === "string" && value.startsWith("$.")) {
      const picked = pickPath(data, value.slice(2))
      if (picked !== undefined) {
        ;(resolved as Record<string, unknown>)[field] = String(picked)
      }
    }
  }
  if (typeof resolved.rows === "string" && resolved.rows.startsWith("$.")) {
    const picked = pickPath(data, resolved.rows.slice(2))
    resolved.rows = Array.isArray(picked)
      ? picked.map((row) =>
          Array.isArray(row) ? row.map((cell) => String(cell)) : [String(row)],
        )
      : []
  }
  if (typeof resolved.items === "string" && resolved.items.startsWith("$.")) {
    const picked = pickPath(data, resolved.items.slice(2))
    resolved.items = Array.isArray(picked)
      ? picked.map((item) => String(item))
      : []
  }
  return resolved
}

function pickPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}
