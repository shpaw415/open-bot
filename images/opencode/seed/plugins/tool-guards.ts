// Seed opencode plugin (copied by the entrypoint into
// ~/.config/opencode/plugins/ on every boot, where opencode auto-loads it).
// It enforces two tool contracts the built-in tools only document:
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
