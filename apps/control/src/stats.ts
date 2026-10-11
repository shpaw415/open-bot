import { cpus } from "node:os"
import type { Db } from "@open-bot/db"
import { desktopExec, desktopPhase } from "./docker"
import { names } from "./env"
import { sh } from "./shell"

export const DISK_CAP_KEY = "desktop_disk_max_gb"
export const MAX_DISK_CAP_GB = 1_000_000

export type DesktopSample = {
  at: number
  diskUsed: number
  diskTotal: number
  memUsed: number
  memMax: number
  cpuPercent: number
  cpuMaxPercent: number
}

export type HardwareStats = {
  phase: Awaited<ReturnType<typeof desktopPhase>>
  sample: DesktopSample | null
  diskMaxBytes: number | null
  history: DesktopSample[]
}

const MAX_SAMPLES = 60
const SAMPLE_INTERVAL_MS = 30_000

const history = new Map<string, DesktopSample[]>()

export function desktopDiskMaxGb(db: Db) {
  const raw = db.getSetting(DISK_CAP_KEY)
  const value = raw === null ? 0 : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), MAX_DISK_CAP_GB)
}

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  tb: 1000 ** 4,
  pb: 1000 ** 5,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
}

export function parseSize(text: string) {
  const match = text.trim().match(/^([\d.]+)\s*([a-z]+)$/i)
  if (!match) return 0
  const unit = BYTE_UNITS[match[2]?.toLowerCase() ?? ""]
  return unit ? Math.round(Number(match[1]) * unit) : 0
}

export function parsePercent(text: string) {
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : 0
}

export function parseDuTotal(text: string) {
  let total = 0
  for (const line of text.trim().split("\n")) {
    const value = Number(line.split(/\s+/)[0])
    if (Number.isFinite(value) && value > 0) total += value
  }
  return total
}

async function sampleDesktop(userId: string): Promise<DesktopSample | null> {
  const n = names(userId)
  const [stats, inspect, disk, size, usage] = await Promise.all([
    sh([
      "docker",
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      n.opencode,
    ]),
    sh([
      "docker",
      "inspect",
      "-f",
      "{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}",
      n.opencode,
    ]),
    // df sees the host drive through the overlay; the desktop's own footprint
    // is its writable layer plus the volumes it writes to.
    desktopExec(userId, "opencode", ["df", "-PB1", "/"]),
    sh([
      "docker",
      "ps",
      "-as",
      "--filter",
      `name=${n.opencode}`,
      "--format",
      "{{.Size}}",
    ]),
    sh([
      "docker",
      "exec",
      "-u",
      "root",
      n.opencode,
      "du",
      "-sb",
      "/home/agent",
      "/usr/local",
    ]),
  ])
  if (
    stats.code !== 0 ||
    inspect.code !== 0 ||
    disk.code !== 0 ||
    size.code !== 0
  )
    return null
  let memUsed = 0
  let memLimit = 0
  let cpuPercent = 0
  try {
    const parsed = JSON.parse(stats.stdout.trim().split("\n").at(-1) ?? "") as {
      CPUPerc?: string
      MemUsage?: string
    }
    cpuPercent = parsePercent(parsed.CPUPerc ?? "")
    const [used, limit] = (parsed.MemUsage ?? "").split("/")
    memUsed = parseSize(used ?? "")
    memLimit = parseSize(limit ?? "")
  } catch {
    return null
  }
  const [memoryRaw, nanoCpusRaw] = inspect.stdout.trim().split(/\s+/)
  const memoryMax = Number(memoryRaw)
  const nanoCpus = Number(nanoCpusRaw)
  const memMax = memoryMax > 0 ? memoryMax : memLimit
  const cpuCores = nanoCpus > 0 ? nanoCpus / 1e9 : Math.max(1, cpus().length)
  const cols = (disk.stdout.trim().split("\n").at(-1) ?? "").split(/\s+/)
  const diskTotal = Number(cols[1])
  const diskUsed =
    parseSize(
      (size.stdout.trim().split("\n").at(-1) ?? "").split("(")[0] ?? "",
    ) + (usage.code === 0 ? parseDuTotal(usage.stdout) : 0)
  if (!(memMax > 0) || !(diskTotal > 0)) return null
  return {
    at: Date.now(),
    diskUsed,
    diskTotal,
    memUsed,
    memMax,
    cpuPercent,
    cpuMaxPercent: cpuCores * 100,
  }
}

function lastSample(userId: string) {
  const rows = history.get(userId)
  return rows && rows.length > 0 ? (rows[rows.length - 1] ?? null) : null
}

export async function hardwareStats(
  userId: string,
  db: Db,
): Promise<HardwareStats> {
  const phase = await desktopPhase(userId)
  let sample = phase === "running" ? await sampleDesktop(userId) : null
  if (!sample) sample = lastSample(userId)
  const maxGb = desktopDiskMaxGb(db)
  return {
    phase,
    sample,
    diskMaxBytes: maxGb > 0 ? maxGb * 1024 ** 3 : null,
    history: history.get(userId) ?? [],
  }
}

export function startStatsSampler(db: Db, intervalMs = SAMPLE_INTERVAL_MS) {
  return setInterval(() => {
    void (async () => {
      try {
        const active = new Set(
          db.activeDesktops(0).map((row) => row.userId as string),
        )
        for (const userId of [...history.keys()]) {
          if (!active.has(userId)) history.delete(userId)
        }
        for (const userId of active) {
          if ((await desktopPhase(userId)) !== "running") continue
          const sample = await sampleDesktop(userId)
          if (!sample) continue
          const rows = history.get(userId) ?? []
          rows.push(sample)
          while (rows.length > MAX_SAMPLES) rows.shift()
          history.set(userId, rows)
        }
      } catch {
        // sampling is best-effort
      }
    })()
  }, intervalMs)
}
