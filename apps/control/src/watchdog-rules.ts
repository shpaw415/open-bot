// Watchdog detection rules — pure functions, no dependencies. This module is
// shared by the control plane (tests, redaction of stored findings) and the
// in-container watchdog daemon (copied into the image next to the daemon),
// so both sides agree on patterns, severity, and excerpt redaction.

export type WatchdogSeverity = "info" | "low" | "medium" | "high"

export type WatchdogCategory =
  | "prompt_injection"
  | "secret_exfiltration"
  | "dangerous_command"
  | "credential_access"
  | "malicious_content"
  | "other"

export type RuleMatch = {
  rule: string
  category: WatchdogCategory
  severity: WatchdogSeverity
  excerpt: string
}

export type ScanResult = {
  matches: RuleMatch[]
  severity: WatchdogSeverity | null
  categories: WatchdogCategory[]
}

type Rule = {
  name: string
  category: WatchdogCategory
  severity: WatchdogSeverity
  pattern: RegExp
  /** Only run against tool inputs (bash commands etc.). */
  toolOnly?: boolean
}

const SEVERITY_RANK: Record<WatchdogSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
}

export function maxSeverity(
  items: { severity: WatchdogSeverity }[],
): WatchdogSeverity | null {
  let best: WatchdogSeverity | null = null
  for (const item of items) {
    if (!best || SEVERITY_RANK[item.severity] > SEVERITY_RANK[best]) {
      best = item.severity
    }
  }
  return best
}

// Prompt-injection phrasing seen in web pages, tool output, cron payloads,
// plugin text, and (rarely) a compromised chat client. Patterns are
// deliberately conservative: the watchdog alerts, and only rules-level
// "high" evidence stops a turn, so a false positive must be egregious.
const RULES: Rule[] = [
  {
    name: "override_instructions",
    category: "prompt_injection",
    severity: "high",
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|original|initial)\s+(?:instructions|rules|prompts?|directions|constraints?)/i,
  },
  {
    name: "reveal_system_prompt",
    category: "prompt_injection",
    severity: "medium",
    pattern:
      /\b(?:reveal|print|repeat|show|output|dump|leak)\s+(?:me\s+)?(?:your|the|its)\s+(?:full\s+|complete\s+|exact\s+|initial\s+|original\s+)?(?:system\s+prompt|system\s+instructions|initial\s+prompt|hidden\s+instructions)/i,
  },
  {
    name: "system_tag_spoof",
    category: "prompt_injection",
    severity: "medium",
    pattern: /<\/?system>|\[?SYSTEM\]?:|<\|?(?:im_start|endoftext)\|?>/i,
  },
  {
    name: "role_hijack",
    category: "prompt_injection",
    severity: "medium",
    pattern:
      /\b(?:from\s+now\s+on[, ]+\s*)?you\s+are\s+now\s+(?:a|an|the)\s+(?!following)/i,
  },
  {
    name: "fake_authority",
    category: "prompt_injection",
    severity: "medium",
    pattern:
      /\b(?:developer|admin|administrator|maintenance|debug)\s+(?:mode|message|override)\s+(?:is\s+)?(?:enabled|activated|on)\b/i,
  },
  {
    name: "hide_from_user",
    category: "prompt_injection",
    severity: "medium",
    pattern:
      /\b(?:do\s+not|don'?t)\s+(?:tell|inform|notify|mention\s+(?:this|it)\s+to)\s+(?:the\s+)?(?:user|human|person|them)\b/i,
  },
  {
    name: "exfiltration_order",
    category: "prompt_injection",
    severity: "high",
    pattern:
      /\b(?:exfiltrate|send|post|upload|forward|copy)\b[^.;]{0,60}\b(?:secrets?|credentials?|tokens?|api[- ]?keys?|keys?)\b[^.;]{0,80}\b(?:to|at|via)\b/i,
  },
  {
    name: "encoded_execution",
    category: "prompt_injection",
    severity: "high",
    pattern:
      /\b(?:base64|openssl\s+enc)\s+(?:-[de]code|-\d)\b[^.;]{0,120}\b(?:then\s+)?(?:run|execute|eval|source|bash|sh)\b/i,
  },
  {
    name: "secret_key_material",
    category: "secret_exfiltration",
    severity: "high",
    pattern:
      /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "bearer_token",
    category: "secret_exfiltration",
    severity: "high",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
  },
  {
    name: "credential_assignment",
    category: "secret_exfiltration",
    severity: "medium",
    pattern:
      /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_+/.-]{20,}/i,
  },
  {
    name: "jwt",
    category: "secret_exfiltration",
    severity: "low",
    pattern: /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/g,
  },
  {
    // Pipe-to-shell is the classic web-page drive-by: the agent fetched a
    // page (or "instruction") that tells it to run an installer.
    name: "pipe_to_shell",
    category: "dangerous_command",
    severity: "high",
    pattern:
      /\b(?:curl|wget|fetch)\b[^|;&]{0,300}[|;]\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i,
    toolOnly: true,
  },
  {
    name: "docker_socket",
    category: "dangerous_command",
    severity: "high",
    pattern: /docker(?:-compose)?\.sock|\/var\/run\/docker\.sock/i,
    toolOnly: true,
  },
  {
    name: "ssh_key_write",
    category: "dangerous_command",
    severity: "high",
    pattern:
      />\s*~?\/?\.?\/?(?:home\/agent\/)?\.ssh\/(?:authorized_keys|known_hosts)\b|\bcat\s+[^|;]{0,80}>>?\s*~\/\.ssh\//i,
    toolOnly: true,
  },
  {
    name: "destructive_fs",
    category: "dangerous_command",
    severity: "high",
    pattern:
      /\brm\s+-rf\s+\/(?:\s|$)|\bmkfs\b|\bdd\s+if=\/dev\/(?:zero|random)\s+of=\/dev\/[sh]d/i,
    toolOnly: true,
  },
  {
    // The agent reading its own credential stores is normal (ob-api-key,
    // apply-chat-auth); flag it so a human sees the context it happened in.
    name: "credential_source_read",
    category: "credential_access",
    severity: "medium",
    pattern:
      /\b(?:ob-api-key|cat|less|grep|jq)\b[^|;&]{0,120}\b(?:auth\.json|user_keys|plugin-[\w.-]+\.json|system1-auth\.json|\.env\b)/i,
    toolOnly: true,
  },
  {
    name: "credential_egress",
    category: "secret_exfiltration",
    severity: "high",
    pattern:
      /\b(?:curl|wget|fetch|httpie|http)\b[^;&]{0,400}(?:--data(?:-raw|-binary)?|--form|-F|-d\b|--upload-file|-T\b)[^;&]{0,400}\b(?:ob-api-key|auth\.json|system1-auth\.json|\.env\b|\$\((?:ob-api-key|cat)\b)/i,
    toolOnly: true,
  },
  {
    name: "kill_supervisor",
    category: "dangerous_command",
    severity: "medium",
    pattern: /\bpkill\s+(?:-[a-zA-Z]+\s+)*["']?(?:opencode|watchdog)(?:\b|-)/i,
    toolOnly: true,
  },
  {
    name: "watchdog_tamper",
    category: "dangerous_command",
    severity: "high",
    pattern:
      /\b(?:rm|mv|truncate|chmod|chown)\b[^|;&]{0,120}\bwatchdog(?:-daemon)?\.(?:ts|log)\b|\bwatchdog\.json\b/i,
    toolOnly: true,
  },
]

const EXCERPT_WINDOW = 80
const MAX_EXCERPT = 240
const MAX_TEXT = 64_000

function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_WINDOW)
  const to = Math.min(text.length, end + EXCERPT_WINDOW)
  const prefix = from > 0 ? "…" : ""
  const suffix = to < text.length ? "…" : ""
  return `${prefix}${text.slice(from, to)}${suffix}`.slice(0, MAX_EXCERPT)
}

const SECRET_KINDS: {
  name: string
  pattern: RegExp
  /** Pattern keeps the scheme in group 1 ("Bearer [redacted:bearer]"). */
  keepPrefix?: boolean
}[] = [
  { name: "api_key", pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g },
  { name: "aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: "private_key",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // Keep the scheme prefix readable ("Bearer [redacted:bearer]").
  {
    name: "bearer",
    keepPrefix: true,
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{24,}/g,
  },
]

/** Replace secret-looking spans with stable markers before anything is
 * stored or reported. Rebuilt from scratch per call; never logs. */
export function redactSecrets(text: string): string {
  let out = text
  for (const kind of SECRET_KINDS) {
    if (kind.keepPrefix) {
      out = out.replace(kind.pattern, `$1[redacted:${kind.name}]`)
    } else {
      out = out.replace(kind.pattern, `[redacted:${kind.name}]`)
    }
  }
  return out
}

export type ScanOptions = {
  /** "text" scans prose (prompts, responses, page output); "tool" also runs
   * the tool-only command rules. */
  kind?: "text" | "tool"
  maxChars?: number
}

/** Triage a model-exchange snippet. Returns every rule hit with a redacted
 * excerpt; severity is the strongest hit (three or more distinct injection
 * hits escalate to high — scattered phrasing is a classic evasion). */
export function scanExchange(text: string, opts: ScanOptions = {}): ScanResult {
  const body =
    text.length > (opts.maxChars ?? MAX_TEXT)
      ? text.slice(0, opts.maxChars ?? MAX_TEXT)
      : text
  const matches: RuleMatch[] = []
  for (const rule of RULES) {
    if (rule.toolOnly && opts.kind !== "tool") continue
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes("g")
        ? rule.pattern.flags
        : `${rule.pattern.flags}g`,
    )
    let count = 0
    for (const match of body.matchAll(pattern)) {
      if (count >= 3) break
      count += 1
      const start = match.index ?? 0
      const end = start + (match[0]?.length ?? 0)
      const raw = excerptAround(body, start, end)
      matches.push({
        rule: rule.name,
        category: rule.category,
        severity: rule.severity,
        excerpt: redactSecrets(raw),
      })
    }
  }
  const categories = [...new Set(matches.map((match) => match.category))]
  let severity = maxSeverity(matches)
  const injectionHits = matches.filter(
    (match) => match.category === "prompt_injection",
  ).length
  if (severity && severity !== "high" && injectionHits >= 3) {
    severity = "high"
  }
  return { matches, severity, categories }
}

export function findingFingerprint(
  category: WatchdogCategory,
  source: string,
  title: string,
): string {
  // Stable identity of a finding class: same category, origin, and trimmed
  // title = same finding (hits bump instead of new rows). Not a secret.
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120)
  let hash = 5381
  for (const byte of new TextEncoder().encode(
    `${category}|${source}|${normalized}`,
  )) {
    hash = ((hash << 5) + hash + byte) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
