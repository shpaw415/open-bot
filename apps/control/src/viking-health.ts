// Health probe for the per-user OpenViking sidecar (port 1933). Passive by
// design: the caller checks the desktop phase first — OpenViking sleeps with
// the desktop, so an asleep desktop is a health answer, never something this
// module wakes. Against a running container it asks the observer aggregate
// (GET /api/v1/observer/system, root key auth) and falls back to the plain
// /health ping when the observer is unavailable (older image, degraded state).
//
// Each observer component reports its detail as a space-aligned TEXT TABLE
// (e.g. "Queue  Pending  In Progress  Processed  Errors  Total"). Those
// tables are parsed here into columns/rows so the dashboard renders real
// tables and charts; the raw status text always rides along, unclipped, as
// the fallback view.

const OBSERVER_TIMEOUT_MS = 8_000
const HEALTH_TIMEOUT_MS = 4_000
// Generous payload guard only — never a visible truncation. Observer tables
// are a few hundred bytes; 8 KB per component leaves room for a chatty
// models/lock detail without shipping megabytes on a broken instance.
const MAX_STATUS_TEXT = 8_000
const MAX_ERRORS = 20
const MAX_ERROR_TEXT = 300

export type VikingHealthStatus =
  | "healthy"
  | "unhealthy"
  | "up"
  | "down"
  | "asleep"
  | "starting"

export type VikingComponentHealth = {
  name: string
  healthy: boolean
  hasErrors: boolean
  /** Raw observer status text (usually the aligned table), unclipped. */
  status: string
  /** Parsed table header when the status text is a space-aligned table. */
  columns: string[]
  /** Parsed table rows (cells split on 2+ spaces); may be ragged. */
  rows: string[][]
}

export type VikingHealth = {
  status: VikingHealthStatus
  detail: string
  errors: string[]
  components: VikingComponentHealth[]
  checkedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function clip(value: string, max: number) {
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

function errorText(value: unknown): string {
  if (typeof value === "string") return clip(value, MAX_ERROR_TEXT)
  if (isRecord(value) && typeof value.message === "string")
    return clip(value.message, MAX_ERROR_TEXT)
  return ""
}

// Splits one line of an observer status table into cells. The live server
// draws ASCII BOX TABLES ("| Queue | Pending |…" between "+---+…" rules),
// while the docs' examples use space-aligned columns — both are supported:
// 1. A line whose first non-blank character is "|" splits on the pipes
//    (leading/trailing empties dropped); "+---+" rule lines yield nothing.
// 2. Anything else splits on runs of 2+ spaces (single spaces stay inside a
//    "In Progress"-style header or detail value).
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (trimmed.startsWith("|")) {
    return trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell && !/^[+-]{2,}$/.test(cell))
  }
  if (/^[+][-+]*[+]$/.test(trimmed)) return []
  return trimmed
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean)
}

function isRuleLine(line: string) {
  const trimmed = line.trim()
  return /^[+][-+]*[+]$/.test(trimmed) || /^={3,}$/.test(trimmed)
}

function parseTableSection(lines: string[]): VikingStatusTable | null {
  let headerIndex = -1
  let columns: string[] = []
  for (const [index, line] of lines.entries()) {
    if (isRuleLine(line)) continue
    const cells = splitTableRow(line)
    if (cells.length >= 2) {
      headerIndex = index
      columns = cells
      break
    }
  }
  if (headerIndex < 0) return null
  const rows: string[][] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (isRuleLine(line)) continue
    const cells = splitTableRow(line)
    if (cells.length < 2) continue
    // A repeated header opens a new section (the filesystem observer stacks
    // several per-mount tables under one status) — the first table wins.
    if (sameCells(cells, columns)) break
    rows.push(cells)
  }
  if (!rows.length) return null
  return { columns, rows }
}

function sameCells(a: string[], b: string[]) {
  return a.length === b.length && a.every((cell, i) => cell === b[i])
}

// vikingdb and lock report plain "Key: value" lines. A block qualifies when
// at least two non-empty lines and every one of them matches the shape.
function parseKeyValueSection(lines: string[]): VikingStatusTable | null {
  const meaningful = lines.filter((line) => line.trim())
  if (meaningful.length < 2) return null
  const kv = /^[^:\s][^:]{0,56}:\s*\S/
  if (!meaningful.every((line) => kv.test(line.trim()))) return null
  return {
    columns: ["Setting", "Value"],
    rows: meaningful.map((line) => {
      const [key, ...rest] = line.trim().split(":")
      return [key.trim(), rest.join(":").trim()]
    }),
  }
}

export type VikingStatusTable = {
  columns: string[]
  rows: string[][]
}

// Parses an observer status detail. The status can be a space-aligned table
// (docs), an ASCII box table (live server), a "Key: value" block (vikingdb,
// lock), or free-form text. Sections are blank-line separated; the first
// section that parses wins (the filesystem observer stacks several tables —
// the first is the primary one). Null when nothing parses — callers then
// show the raw text.
export function parseStatusTable(status: string): VikingStatusTable | null {
  const sections = status
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .reduce<string[][]>(
      (acc, line) => {
        if (!line.trim()) acc.push([])
        else acc[acc.length - 1]?.push(line)
        return acc
      },
      [[]],
    )
  for (const section of sections) {
    if (!section.length) continue
    const table = parseTableSection(section)
    if (table) return table
    const kv = parseKeyValueSection(section)
    if (kv) return kv
  }
  return null
}

function componentFromEntry(
  name: string,
  value: unknown,
): VikingComponentHealth | null {
  if (!isRecord(value)) return null
  const status =
    typeof value.status === "string" ? clip(value.status, MAX_STATUS_TEXT) : ""
  const table = parseStatusTable(status)
  return {
    name: typeof value.name === "string" && value.name ? value.name : name,
    healthy: value.is_healthy === true,
    hasErrors: value.has_errors === true,
    status,
    columns: table?.columns ?? [],
    rows: table?.rows ?? [],
  }
}

export type VikingObserverReport = {
  healthy: boolean
  errors: string[]
  components: VikingComponentHealth[]
}

// Parses the observer aggregate. Accepts the documented envelope
// ({status, result:{is_healthy, errors, components}}) and the bare result
// shape. Null when the body carries nothing recognizable.
export function parseVikingObserver(
  body: unknown,
): VikingObserverReport | null {
  const inner = isRecord(body) && "result" in body ? body.result : body
  if (!isRecord(inner) || typeof inner.is_healthy !== "boolean") return null
  const errors = Array.isArray(inner.errors)
    ? [
        ...new Set(inner.errors.map(errorText).filter(Boolean) as string[]),
      ].slice(0, MAX_ERRORS)
    : []
  const components: VikingComponentHealth[] = []
  if (isRecord(inner.components)) {
    for (const [name, value] of Object.entries(inner.components)) {
      const component = componentFromEntry(name, value)
      if (component) components.push(component)
    }
  }
  return { healthy: inner.is_healthy, errors, components }
}

type FetchLike = typeof fetch

function failureDetail(error: unknown) {
  return error instanceof Error ? clip(error.message, MAX_ERROR_TEXT) : ""
}

export async function probeVikingHealth(
  baseUrl: string,
  rootKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<VikingHealth> {
  const base = baseUrl.replace(/\/$/, "")
  const checkedAt = Date.now()
  try {
    const res = await fetchImpl(`${base}/api/v1/observer/system`, {
      headers: { "x-api-key": rootKey },
      signal: AbortSignal.timeout(OBSERVER_TIMEOUT_MS),
    })
    const body: unknown = await res.json().catch(() => null)
    const report = res.ok ? parseVikingObserver(body) : null
    if (report) {
      return {
        status: report.healthy ? "healthy" : "unhealthy",
        detail: "",
        errors: report.errors,
        components: report.components,
        checkedAt,
      }
    }
    // Observer unavailable (older image, auth change, degraded server) — a
    // plain liveness ping still separates "up" from "down".
    const detail = `observer unavailable (${res.status})`
    return await pingFallback(base, detail, checkedAt, fetchImpl)
  } catch (error) {
    return await pingFallback(
      base,
      failureDetail(error) || "observer request failed",
      checkedAt,
      fetchImpl,
    )
  }
}

async function pingFallback(
  base: string,
  detail: string,
  checkedAt: number,
  fetchImpl: FetchLike,
): Promise<VikingHealth> {
  try {
    const res = await fetchImpl(`${base}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (res.ok) {
      return {
        status: "up",
        detail: `${detail} — the server answers /health, so it is running; detailed component health needs a newer OpenViking image or a look at the container logs`,
        errors: [],
        components: [],
        checkedAt,
      }
    }
    return {
      status: "down",
      detail: `${detail} — /health answered ${res.status}`,
      errors: [],
      components: [],
      checkedAt,
    }
  } catch (error) {
    const ping = failureDetail(error)
    return {
      status: "down",
      detail: ping ? `${detail} — ${ping}` : detail,
      errors: [],
      components: [],
      checkedAt,
    }
  }
}
