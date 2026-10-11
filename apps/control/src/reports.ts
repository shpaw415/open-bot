import { opencodeExec } from "./docker"
import { HttpError } from "./http-error"

export const REPORT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const PLUGIN_SLUG_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const NOTE_MAX = 2000

export const reportStatuses = ["open", "done", "wontfix"] as const
export type ReportStatus = (typeof reportStatuses)[number]
export const reportKinds = ["bug", "friction", "feature"] as const
export type ReportKind = (typeof reportKinds)[number]

export type PluginReport = {
  id: string
  plugin: string
  kind: string
  title: string
  detail: string
  session: string | null
  status: string
  note: string | null
  hits: number
  createdAt: number
  lastSeenAt: number
}

export type ReportSummary = {
  plugin: string
  open: number
  total: number
}

export function isReportStatus(value: string): value is ReportStatus {
  return (reportStatuses as readonly string[]).includes(value)
}

export function isReportKind(value: string): value is ReportKind {
  return (reportKinds as readonly string[]).includes(value)
}

/**
 * Parse the JSONL output of `ob-report list --json`. Tolerant like the app
 * catalog: malformed or incomplete lines are skipped, valid rows survive.
 */
export function parseReportList(text: string): PluginReport[] {
  const reports: PluginReport[] = []
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw !== "object" || raw === null) continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : ""
    const plugin = typeof row.plugin === "string" ? row.plugin : ""
    const kind = typeof row.kind === "string" ? row.kind : ""
    const title = typeof row.title === "string" ? row.title : ""
    if (!REPORT_ID_PATTERN.test(id) || !plugin || !kind || !title) continue
    if (!isReportKind(kind)) continue
    const status = typeof row.status === "string" ? row.status : ""
    if (!isReportStatus(status)) continue
    const detail = typeof row.detail === "string" ? row.detail : ""
    const note = typeof row.note === "string" ? row.note : null
    const session = typeof row.session === "string" ? row.session : null
    const hits = typeof row.hits === "number" ? row.hits : 1
    const createdAt = typeof row.createdAt === "number" ? row.createdAt : 0
    const lastSeenAt =
      typeof row.lastSeenAt === "number" ? row.lastSeenAt : createdAt
    if (seen.has(id)) continue
    seen.add(id)
    reports.push({
      id,
      plugin,
      kind,
      title,
      detail,
      session,
      status,
      note,
      hits,
      createdAt,
      lastSeenAt,
    })
  }
  return reports.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

/** One row per plugin with open and total counts, sorted by plugin name. */
export function summarizeByPlugin(reports: PluginReport[]): ReportSummary[] {
  const byPlugin = new Map<string, ReportSummary>()
  for (const report of reports) {
    const entry = byPlugin.get(report.plugin) ?? {
      plugin: report.plugin,
      open: 0,
      total: 0,
    }
    entry.total += 1
    if (report.status === "open") entry.open += 1
    byPlugin.set(report.plugin, entry)
  }
  return [...byPlugin.values()].sort((a, b) => a.plugin.localeCompare(b.plugin))
}

async function runObReport(userId: string, args: string[]) {
  const result = await opencodeExec(userId, [
    "/usr/local/bin/ob-report",
    ...args,
  ])
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new HttpError(
        502,
        "the desktop does not have ob-report yet; update the desktop image first",
        "report_command",
      )
    }
    throw new HttpError(
      502,
      detail || "the desktop report command failed",
      "report_command",
    )
  }
  return result.stdout
}

export async function desktopReports(
  userId: string,
  opts: { status?: string; plugin?: string } = {},
): Promise<PluginReport[]> {
  const args = ["list", "--json"]
  if (opts.status && opts.status !== "all") args.push("--status", opts.status)
  if (opts.plugin) args.push("--plugin", opts.plugin)
  return parseReportList(await runObReport(userId, args))
}

export async function setReportStatus(
  userId: string,
  id: string,
  status: ReportStatus,
  note?: string,
): Promise<void> {
  if (!REPORT_ID_PATTERN.test(id))
    throw new HttpError(400, "bad report id", "bad_report_id")
  const args = [status, id]
  if (note !== undefined) {
    if (note.length > NOTE_MAX)
      throw new HttpError(
        400,
        `note must be at most ${NOTE_MAX} characters`,
        "bad_note",
      )
    args.push("--note", note)
  }
  await runObReport(userId, args)
}
