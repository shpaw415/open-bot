// Seed opencode plugin (copied by the entrypoint into
// ~/.config/opencode/plugins/ on every boot, where opencode auto-loads it).
// It enforces tool contracts the built-in tools only document, plus the
// bash deny policy (see bashDenial below):
//
// - write is read-first: overwriting a file that already exists and was
//   never read (or written) by THIS session throws, so a blind overwrite
//   cannot silently destroy content nobody in the session has seen. It is
//   also optimistic: if the file changed on disk since this session read
//   it (a parallel teammate's write), the write throws until re-read, so
//   read-modify-write races surface instead of silently clobbering.
// - grep with a file `path` searches that file: the built-in grep treats
//   `path` as a directory and ignored a file path, returning matches from
//   neighboring files. A file path is rewritten to its directory plus an
//   `include` of its basename, which is the same search expressed the way
//   the tool honors.
import { existsSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"

type BeforeInput = { tool: string; sessionID: string; callID: string }
type BeforeOutput = { args: Record<string, unknown> }

// --- bash deny policy -------------------------------------------------------
// Field #5/#10/#55/#68/#69: the seed config's glob deny map matched the
// whole command string, so a SHA in an ob-thread message ("sha256:9224…"),
// a checksum argument, or prose concatenations ("prixselection" contains
// "xsel") were denied as if they were CDP/clipboard invocations. Globs
// cannot tell data from code; this guard tokenizes the command (quotes,
// substitutions, separators) and denies only real command words and real
// endpoint-shaped arguments. The config keeps only host-anchored port
// backstops in case this plugin ever fails to load.
const DENIED_COMMANDS = new Map<string, string>([
  ["xclip", "use ob-vnc paste instead"],
  ["xsel", "use ob-vnc paste instead"],
  ["google-chrome", "use ob-chrome or ob-app launch chrome instead"],
  ["google-chrome-stable", "use ob-chrome or ob-app launch chrome instead"],
  ["chromium", "use ob-chrome or ob-app launch chrome instead"],
  ["chromium-browser", "use ob-chrome or ob-app launch chrome instead"],
  ["vncdo", "use ob-vnc instead"],
  ["websockify", "the thread screen serves VNC already"],
  ["Xvfb", "the thread screen manages its own display"],
  ["x11vnc", "the thread screen manages its own display"],
])
const PREFIX_WORDS = new Set([
  "sudo",
  "env",
  "command",
  "builtin",
  "exec",
  "nohup",
  "nice",
  "time",
  "timeout",
])
const CDP_ENDPOINT =
  /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):(922[2-9]|923[01])(?:[/?#].*)?$/i

type Token = { word: string } | { sep: true }

// Minimal shell tokenizer: quote removal with adjacent concatenation,
// $(...) and `...` become separator-bounded fresh command contexts (they
// execute even inside double quotes), other separators end a command.
function shellTokens(command: string): Token[] {
  const tokens: Token[] = []
  let word = ""
  const flush = () => {
    if (word) tokens.push({ word })
    word = ""
  }
  const sep = () => {
    flush()
    tokens.push({ sep: true })
  }
  type Frame =
    | { kind: "code" }
    | { kind: "single" }
    | { kind: "double" }
    | { kind: "backtick" }
    | { kind: "subst"; depth: number }
  const stack: Frame[] = [{ kind: "code" }]
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    const top = stack[stack.length - 1] as Frame
    if (top.kind === "single") {
      if (ch === "'") stack.pop()
      else word += ch
      continue
    }
    if (top.kind === "double") {
      if (ch === '"') {
        stack.pop()
      } else if (ch === "\\" && '$`"\\\n'.includes(command[i + 1] ?? "")) {
        word += command[i + 1]
        i++
      } else if (ch === "$" && command[i + 1] === "(") {
        sep()
        stack.push({ kind: "subst", depth: 1 })
        i++
      } else if (ch === "`") {
        sep()
        stack.push({ kind: "backtick" })
      } else {
        word += ch
      }
      continue
    }
    // Code contexts: top level, $(...) substitution, `...` substitution.
    if (ch === "'") {
      stack.push({ kind: "single" })
    } else if (ch === '"') {
      stack.push({ kind: "double" })
    } else if (ch === "`") {
      sep()
      if (top.kind === "backtick") stack.pop()
      else stack.push({ kind: "backtick" })
    } else if (ch === "$" && command[i + 1] === "(") {
      sep()
      stack.push({ kind: "subst", depth: 1 })
      i++
    } else if (ch === "(") {
      if (top.kind === "subst") top.depth++
      sep()
    } else if (ch === ")") {
      sep()
      if (top.kind === "subst" && --top.depth <= 0) stack.pop()
    } else if (" \t\r".includes(ch)) {
      flush()
    } else if (";|&<>\n".includes(ch)) {
      sep()
    } else if (ch === "\\" && i + 1 < command.length) {
      word += command[i + 1]
      i++
    } else {
      word += ch
    }
  }
  flush()
  return tokens
}

// Returns a compact denial reason, or null when the command is allowed.
export function bashDenial(command: string): string | null {
  let commandPosition = true
  let skipNextWord = false
  for (const token of shellTokens(command)) {
    if ("sep" in token) {
      commandPosition = true
      skipNextWord = false
      continue
    }
    const value = token.word
    const cdp = CDP_ENDPOINT.exec(value)
    if (cdp)
      return `bash guard: direct CDP endpoint :${cdp[1]} is denied — use ob-chrome/ob-page instead`
    if (value.startsWith("--remote-debugging-port"))
      return "bash guard: --remote-debugging-port is denied — use ob-chrome/ob-page instead"
    if (value.includes("/devtools/") && /^[a-z][a-z0-9+.-]*:\/\//i.test(value))
      return "bash guard: direct DevTools websocket access is denied — use ob-chrome/ob-page instead"
    if (!commandPosition) continue
    if (skipNextWord) {
      skipNextWord = false
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue
    const base = value.slice(value.lastIndexOf("/") + 1)
    const hint = DENIED_COMMANDS.get(base)
    if (hint) return `bash guard: ${base} is denied — ${hint}`
    if (PREFIX_WORDS.has(base)) {
      // `timeout 5 xclip`: the duration word is not the command.
      if (base === "timeout") skipNextWord = true
      continue
    }
    commandPosition = false
  }
  return null
}

// #78: upstream apply_patch (opencode's built-in) applies each file section
// against the ORIGINAL file content, so two sections for one path silently
// keep only the last. Until upstream composes sections, reject repeated
// paths up front with the one-section-per-file workaround named.
export function patchRepeatDenial(patchText: string): string | null {
  if (!patchText) return null
  const seen = new Set<string>()
  for (const line of patchText.split("\n")) {
    const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line.trim())
    if (!m) continue
    const path = m[1].trim()
    if (seen.has(path)) {
      return `apply_patch: ${path} appears in more than one section — sections for the same file are applied against the original content, so only the last would survive and earlier edits are silently lost. Merge them into one section per file (or split into separate apply_patch calls).`
    }
    seen.add(path)
  }
  return null
}

export const ToolGuards = async (ctx?: { directory?: string }) => {
  const base = ctx?.directory ?? process.cwd()
  // Per session: path -> on-disk stamp when this session last saw the
  // contents (read, wrote, or edited — edit reads internally to match
  // oldString). The stamp is what turns a parallel teammate's intervening
  // write into a visible conflict instead of a silent clobber.
  const known = new Map<string, Map<string, string>>()
  const pending = new Map<string, { sessionID: string; path: string }>()
  const stampOf = (path: string): string | null => {
    try {
      const stat = statSync(path)
      return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    } catch {
      return null
    }
  }
  const seen = (sessionID: string, path: string) =>
    known.get(sessionID)?.has(path) ?? false
  const remember = (sessionID: string, path: string) => {
    let map = known.get(sessionID)
    if (!map) {
      map = new Map<string, string>()
      known.set(sessionID, map)
    }
    const stamp = stampOf(path)
    if (stamp) map.set(path, stamp)
    else map.delete(path)
  }
  const changedSinceSeen = (sessionID: string, path: string): boolean => {
    const stamp = known.get(sessionID)?.get(path)
    if (!stamp) return false
    const now = stampOf(path)
    return now !== null && now !== stamp
  }
  const filePathOf = (args: Record<string, unknown>): string | null =>
    typeof args.filePath === "string" && args.filePath
      ? resolve(base, args.filePath)
      : null
  const isFile = (path: string): boolean => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }

  return {
    "tool.execute.before": async (input: BeforeInput, output: BeforeOutput) => {
      const args = output?.args
      if (!args || typeof args !== "object") return
      if (input.tool === "apply_patch") {
        const text = typeof args.patchText === "string" ? args.patchText : ""
        const denial = text ? patchRepeatDenial(text) : null
        if (denial) throw new Error(denial)
        return
      }
      if (input.tool === "bash") {
        const command = typeof args.command === "string" ? args.command : ""
        const denial = command ? bashDenial(command) : null
        if (denial) throw new Error(denial)
        return
      }
      if (input.tool === "read" || input.tool === "edit") {
        const path = filePathOf(args)
        if (!path) return
        if (
          input.tool === "edit" &&
          seen(input.sessionID, path) &&
          changedSinceSeen(input.sessionID, path)
        ) {
          throw new Error(
            `changed on disk since you read it: ${path} was modified after this session last read it (a parallel thread may have written it). Re-read it, merge, then edit.`,
          )
        }
        pending.set(input.callID, { sessionID: input.sessionID, path })
        return
      }
      if (input.tool === "write") {
        const path = filePathOf(args)
        if (!path) return
        if (existsSync(path) && !seen(input.sessionID, path)) {
          throw new Error(
            `read-first: ${path} already exists and was not read in this session. Use the read tool on it first, then write — a blind overwrite destroys content nobody here has seen.`,
          )
        }
        if (changedSinceSeen(input.sessionID, path)) {
          throw new Error(
            `changed on disk since you read it: ${path} was modified after this session last read it (a parallel thread may have written it). Re-read it, merge its current content, then write.`,
          )
        }
        pending.set(input.callID, { sessionID: input.sessionID, path })
        return
      }
      if (input.tool === "grep") {
        const raw = typeof args.path === "string" ? args.path : ""
        if (!raw) return
        const path = resolve(base, raw)
        if (!isFile(path)) return
        args.path = dirname(path)
        if (typeof args.include !== "string" || !args.include)
          args.include = basename(path)
      }
    },
    "tool.execute.after": async (input: BeforeInput) => {
      const done = pending.get(input.callID)
      if (!done) return
      pending.delete(input.callID)
      remember(done.sessionID, done.path)
    },
  }
}
