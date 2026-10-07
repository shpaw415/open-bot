import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  type ImprovementKind,
  type ImprovementSurface,
  openDatabase,
} from "../packages/db/src/index.ts"

const statuses = ["open", "done", "wontfix", "all"] as const
const kinds = ["bug", "friction", "feature"] as const
const surfaces = [
  "chat",
  "desktop",
  "nav",
  "cron",
  "persona",
  "config",
  "other",
] as const

export type ReportFilters = {
  status: (typeof statuses)[number]
  kind?: ImprovementKind
  surface?: ImprovementSurface
  user?: string
  q?: string
}

type ReportRow = {
  id: string
  kind: string
  surface: string
  title: string
  detail: string
  hits: number
  email: string | null
  lastSeenAt: number
  status: string
  sessionId: string | null
  note: string | null
}

function usage() {
  console.error(`usage:
  bun scripts/reports.ts [--filters key=value,key=value]
  bun scripts/reports.ts show ID
  bun scripts/reports.ts done ID [--note TEXT]
  bun scripts/reports.ts wontfix ID [--note TEXT]
  bun scripts/reports.ts open ID [--note TEXT]

filters: status=open|done|wontfix|all, kind=bug|friction|feature,
  surface=chat|desktop|nav|cron|persona|config|other, user=email, q=text
default status is open`)
}

function age(ts: number) {
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function printRow(row: ReportRow) {
  console.log(
    `- [${row.status} ${row.kind}/${row.surface}] ${row.title} (hits ${row.hits}, ${row.email ?? "unknown"}, ${age(row.lastSeenAt)}) id=${row.id}`,
  )
}

export function parseFilters(raw: string[]): ReportFilters | { error: string } {
  const filters: ReportFilters = { status: "open" }
  for (const part of raw) {
    const eq = part.indexOf("=")
    if (eq <= 0) return { error: `bad filter: ${part}` }
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (!value) return { error: `bad filter: ${part}` }
    if (key === "status") {
      if (!(statuses as readonly string[]).includes(value))
        return { error: `bad status: ${value}` }
      filters.status = value as ReportFilters["status"]
    } else if (key === "kind") {
      if (!(kinds as readonly string[]).includes(value))
        return { error: `bad kind: ${value}` }
      filters.kind = value as ImprovementKind
    } else if (key === "surface") {
      if (!(surfaces as readonly string[]).includes(value))
        return { error: `bad surface: ${value}` }
      filters.surface = value as ImprovementSurface
    } else if (key === "user") {
      filters.user = value.toLowerCase()
    } else if (key === "q") {
      filters.q = value.toLowerCase()
    } else {
      return { error: `unknown filter: ${key}` }
    }
  }
  return filters
}

export function filterValues(argv: string[]) {
  const raw: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--filters" && argv[i] !== "--status") continue
    const value = argv[i + 1]
    if (!value || value.startsWith("--"))
      return { error: `${argv[i]} needs a value` }
    if (argv[i] === "--status") raw.push(`status=${value}`)
    else raw.push(...value.split(",").filter(Boolean))
    i++
  }
  return parseFilters(raw)
}

export function applyFilters<T extends ReportRow>(
  rows: T[],
  filters: ReportFilters,
) {
  const query = filters.q
  const user = filters.user
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false
    if (filters.kind && row.kind !== filters.kind) return false
    if (filters.surface && row.surface !== filters.surface) return false
    if (user && !(row.email ?? "").toLowerCase().includes(user)) return false
    if (query) {
      const hay = `${row.title}\n${row.detail}`.toLowerCase()
      if (!hay.includes(query)) return false
    }
    return true
  })
}

function filterLabel(filters: ReportFilters) {
  const parts = [`status=${filters.status}`]
  if (filters.kind) parts.push(`kind=${filters.kind}`)
  if (filters.surface) parts.push(`surface=${filters.surface}`)
  if (filters.user) parts.push(`user=${filters.user}`)
  if (filters.q) parts.push(`q=${filters.q}`)
  return parts.join(" ")
}

async function insideContainer() {
  return (
    existsSync("/.dockerenv") ||
    process.env.OPEN_BOT_IN_DOCKER === "1" ||
    process.env.REPORTS_INNER === "1"
  )
}

async function reexec() {
  const probe = Bun.spawn(
    ["docker", "inspect", "-f", "{{.State.Running}}", "open-bot"],
    { stdout: "pipe", stderr: "pipe" },
  )
  const running = (await new Response(probe.stdout).text()).trim()
  const code = await probe.exited
  if (code !== 0 || running !== "true") {
    console.error("control container open-bot is not running")
    process.exit(1)
  }
  const proc = Bun.spawn(
    [
      "docker",
      "exec",
      "-e",
      "REPORTS_INNER=1",
      "open-bot",
      "bun",
      "/app/scripts/reports.ts",
      ...process.argv.slice(2),
    ],
    { stdout: "inherit", stderr: "inherit" },
  )
  process.exit(await proc.exited)
}

function databasePath() {
  if (process.env.OPEN_BOT_SQLITE) return process.env.OPEN_BOT_SQLITE
  if (process.env.DATA_DIR) return join(process.env.DATA_DIR, "open-bot.sqlite")
  return join(import.meta.dir, "../data/open-bot.sqlite")
}

function noteFrom(argv: string[]) {
  const index = argv.indexOf("--note")
  if (index === -1) return undefined
  const text = argv[index + 1]
  if (!text) {
    usage()
    process.exit(2)
  }
  return text
}

function isList(argv: string[]) {
  const command = argv[0]
  return (
    !command ||
    command === "list" ||
    command === "--filters" ||
    command === "--status"
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    usage()
    process.exit(0)
  }

  if (!(await insideContainer())) await reexec()

  const path = databasePath()
  if (!existsSync(path)) {
    console.error(`database not found: ${path}`)
    process.exit(1)
  }
  const db = openDatabase(path)

  if (isList(args)) {
    const parsed = filterValues(args)
    if ("error" in parsed) {
      console.error(parsed.error)
      usage()
      process.exit(2)
    }
    const rows = applyFilters(db.listImprovements(), parsed)
    console.log(`${filterLabel(parsed)} ${rows.length}`)
    for (const row of rows) printRow(row)
    process.exit(0)
  }

  const command = args[0]
  if (command === "show") {
    const id = args[1]
    if (!id) {
      usage()
      process.exit(2)
    }
    const row = db.listImprovements().find((item) => item.id === id)
    if (!row) {
      console.error("report not found")
      process.exit(1)
    }
    printRow(row)
    if (row.sessionId) console.log(`session ${row.sessionId}`)
    console.log(row.detail)
    if (row.note) console.log(`note ${row.note}`)
    process.exit(0)
  }

  if (command === "done" || command === "wontfix" || command === "open") {
    const id = args[1]
    if (!id) {
      usage()
      process.exit(2)
    }
    const note = noteFrom(args)
    const row = db.setImprovementStatus(id, command, note)
    if (!row) {
      console.error("report not found")
      process.exit(1)
    }
    console.log(`${row.status} ${row.id}`)
    process.exit(0)
  }

  usage()
  process.exit(2)
}

if (import.meta.main) {
  await main()
}
