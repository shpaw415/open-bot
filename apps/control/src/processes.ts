import { opencodeExec } from "./docker"
import { HttpError } from "./http-error"

export const PROCESS_ID_PATTERN = /^p-[0-9a-f]{8}$/
const MAX_PROCESSES = 100

export type DesktopProcess = {
  id: string
  name: string
  session: string
  cmd: string
  pid: number
  startedAt: number
  uptimeSeconds: number
  cpuPercent: number | null
  rssBytes: number | null
}

async function runObProcess(userId: string, args: string[]) {
  const result = await opencodeExec(userId, [
    "/usr/local/bin/ob-process",
    ...args,
  ])
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new HttpError(
        502,
        "the desktop does not have ob-process yet; update the desktop image first",
        "process_command",
      )
    }
    throw new HttpError(
      502,
      detail || "the desktop process command failed",
      "process_command",
    )
  }
  return result.stdout
}

/**
 * Parse the JSON array `ob-process list --json` prints. Tolerant like the
 * report and app-catalog parsers: malformed or incomplete rows are skipped,
 * valid rows survive.
 */
export function parseProcessList(text: string): DesktopProcess[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const processes: DesktopProcess[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : ""
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const pid = typeof row.pid === "number" ? row.pid : Number.NaN
    if (
      !PROCESS_ID_PATTERN.test(id) ||
      !name ||
      !Number.isInteger(pid) ||
      pid <= 0
    )
      continue
    if (seen.has(id)) continue
    seen.add(id)
    const session = typeof row.session === "string" ? row.session : "unknown"
    const cmd = typeof row.cmd === "string" ? row.cmd : ""
    const startedAt = typeof row.startedAt === "number" ? row.startedAt : 0
    const uptimeSeconds =
      typeof row.uptimeSeconds === "number" && row.uptimeSeconds >= 0
        ? Math.round(row.uptimeSeconds)
        : 0
    const cpuPercent =
      typeof row.cpuPercent === "number" && Number.isFinite(row.cpuPercent)
        ? row.cpuPercent
        : null
    const rssBytes =
      typeof row.rssBytes === "number" && Number.isFinite(row.rssBytes)
        ? Math.max(0, Math.round(row.rssBytes))
        : null
    processes.push({
      id,
      name: name.slice(0, 64),
      session: session.slice(0, 128),
      cmd: cmd.slice(0, 256),
      pid,
      startedAt,
      uptimeSeconds,
      cpuPercent,
      rssBytes,
    })
    if (processes.length >= MAX_PROCESSES) break
  }
  return processes.sort((a, b) => a.startedAt - b.startedAt)
}

export async function desktopProcesses(
  userId: string,
): Promise<DesktopProcess[]> {
  return parseProcessList(await runObProcess(userId, ["list", "--json"]))
}

export async function killDesktopProcess(
  userId: string,
  id: string,
): Promise<void> {
  if (!PROCESS_ID_PATTERN.test(id)) {
    throw new HttpError(400, "bad process id", "bad_process_id")
  }
  await runObProcess(userId, ["kill", id])
}
