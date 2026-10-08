import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import type { Db } from "@open-bot/db"
import { nextCronTime, parseCron } from "./cron"
import { dataDir, names, opencodeImage } from "./env"
import { docker, sh } from "./shell"

export const BACKUP_CONFIG_KEY = "backup_config"
export const BACKUP_STATUS_KEY = "backup_status"
export const BACKUP_NEXT_RUN_KEY = "backup_next_run_at"

const RCLONE_IMAGE = process.env.RCLONE_IMAGE ?? "rclone/rclone:1.69.3"
const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000
const VOLUME_FILES = [
  { volume: "home", file: "home.tar.gz" },
  { volume: "usrLocal", file: "usr-local.tar.gz" },
  { volume: "vikingData", file: "viking.tar.gz" },
] as const

export type BackupBucket = {
  endpoint: string
  region: string
  provider: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  prefix: string
}

export type BackupConfig = {
  enabled: boolean
  schedule: string | null
  keepLocal: number
  keepRemote: number
  bucket: BackupBucket | null
}

export type BackupUserEntry = {
  userId: string
  email: string
  key: string
  volumes: { name: string; file: string; bytes: number }[]
}

export type BackupManifest = {
  id: string
  startedAt: number
  finishedAt: number
  trigger: "manual" | "schedule" | "pre-reset"
  label: string | null
  controlDb: { bytes: number } | null
  users: BackupUserEntry[]
  totalBytes: number
}

export type BackupSummary = {
  id: string
  startedAt: number
  finishedAt: number
  trigger: string
  label: string | null
  totalBytes: number
  hasControlDb: boolean
  users: { userId: string; email: string; files: number }[]
}

export type BackupRunState = {
  id: string
  state: "running" | "done" | "failed"
  error: string | null
  manifest: BackupManifest | null
  userIds: string[]
  includeControlDb: boolean
}

export type BackupStatus = {
  running: boolean
  lastRunAt: number | null
  lastError: string | null
}

export function backupRoot() {
  return join(dataDir, "backups")
}

export function defaultBackupConfig(): BackupConfig {
  return {
    enabled: false,
    schedule: "0 4 * * *",
    keepLocal: 5,
    keepRemote: 20,
    bucket: null,
  }
}

export function parseBackupConfig(raw: unknown): {
  error?: string
  value?: BackupConfig
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "config must be an object" }
  const body = raw as Record<string, unknown>
  const enabled = Boolean(body.enabled)
  let schedule: string | null = null
  if (typeof body.schedule === "string" && body.schedule.trim()) {
    schedule = body.schedule.trim()
    try {
      parseCron(schedule)
    } catch (error) {
      return {
        error: `invalid schedule: ${error instanceof Error ? error.message : "bad cron"}`,
      }
    }
  } else if (body.schedule != null) {
    return { error: "schedule must be a cron string or null" }
  }
  const keepLocal = Math.floor(Number(body.keepLocal ?? 5))
  if (!Number.isFinite(keepLocal) || keepLocal < 1 || keepLocal > 100)
    return { error: "keepLocal must be between 1 and 100" }
  const keepRemote = Math.floor(Number(body.keepRemote ?? 20))
  if (!Number.isFinite(keepRemote) || keepRemote < 1 || keepRemote > 1000)
    return { error: "keepRemote must be between 1 and 1000" }
  let bucket: BackupBucket | null = null
  if (body.bucket != null) {
    if (typeof body.bucket !== "object" || Array.isArray(body.bucket))
      return { error: "bucket must be an object" }
    const rawBucket = body.bucket as Record<string, unknown>
    const endpoint = String(rawBucket.endpoint ?? "").trim()
    const accessKeyId = String(rawBucket.accessKeyId ?? "").trim()
    const secretAccessKey = String(rawBucket.secretAccessKey ?? "").trim()
    const name = String(rawBucket.bucket ?? "").trim()
    if (!accessKeyId || !secretAccessKey || !name)
      return { error: "bucket needs accessKeyId, secretAccessKey, and bucket" }
    if (endpoint && !/^https?:\/\//.test(endpoint))
      return { error: "bucket endpoint must be an http(s) URL" }
    bucket = {
      endpoint,
      region: String(rawBucket.region ?? "").trim(),
      provider: String(rawBucket.provider ?? "").trim() || "Other",
      accessKeyId,
      secretAccessKey,
      bucket: name,
      prefix: String(rawBucket.prefix ?? "")
        .trim()
        .replace(/^\/+|\/+$/g, ""),
    }
  }
  return { value: { enabled, schedule, keepLocal, keepRemote, bucket } }
}

export function publicBackupConfig(config: BackupConfig) {
  return {
    ...config,
    bucket: config.bucket
      ? {
          ...config.bucket,
          secretAccessKey: config.bucket.secretAccessKey ? "••••••••" : "",
        }
      : null,
  }
}

export function loadBackupConfig(db: Db): BackupConfig {
  const raw = db.getSetting(BACKUP_CONFIG_KEY)
  if (!raw) return defaultBackupConfig()
  const parsed = parseBackupConfig(JSON.parse(raw))
  return parsed.value ?? defaultBackupConfig()
}

export function saveBackupConfig(db: Db, config: BackupConfig) {
  db.setSetting(BACKUP_CONFIG_KEY, JSON.stringify(config))
}

export function backupStatus(db: Db): BackupStatus {
  const raw = db.getSetting(BACKUP_STATUS_KEY)
  if (!raw) return { running: false, lastRunAt: null, lastError: null }
  try {
    const parsed = JSON.parse(raw) as {
      lastRunAt?: number | null
      lastError?: string | null
    }
    return {
      running: inFlight !== null,
      lastRunAt: parsed.lastRunAt ?? null,
      lastError: parsed.lastError ?? null,
    }
  } catch {
    return { running: inFlight !== null, lastRunAt: null, lastError: null }
  }
}

function recordStatus(db: Db, error: string | null) {
  db.setSetting(
    BACKUP_STATUS_KEY,
    JSON.stringify({ lastRunAt: Date.now(), lastError: error }),
  )
}

/** Next fire time (ms) for a 5-field UTC cron expression, minute resolution. */
export function nextBackupRunMs(
  expr: string,
  fromMs = Date.now(),
): number | null {
  return nextCronTime(expr, fromMs)
}

/** Stream a docker/rclone process's binary stdout to a file. */
async function streamToFile(args: string[], filePath: string) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [bytes, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    throw new Error(stderr.trim() || `${args[0]} archive failed (${code})`)
  }
  writeFileSync(filePath, Buffer.from(bytes))
  return bytes.byteLength
}

/** Stream a local file into a process's stdin. */
async function streamFromFile(args: string[], filePath: string) {
  const proc = Bun.spawn(args, {
    stdin: Bun.file(filePath).stream(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    const lines = [...stdout.trim(), stderr.trim()]
      .join("\n")
      .split(/\r?\n/)
      .filter((line) => line.trim())
    throw new Error(
      lines[lines.length - 1] || `${args[0]} failed (${code})`,
    )
  }
}

/** Shared rclone hardening: no config file, short retries. */
const RCLONE_GLOBAL = [
  "--config",
  "/dev/null",
  "--retries",
  "2",
  "--low-level-retries",
  "3",
]

// These only parse after the subcommand in rclone.
const RCLONE_AFTER = ["--s3-no-check-bucket"]

async function ensureRcloneImage() {
  const inspect = await sh(["docker", "image", "inspect", RCLONE_IMAGE])
  if (inspect.code !== 0) await docker(["pull", RCLONE_IMAGE])
}

function rcloneEnv(bucket: BackupBucket): string[] {
  const env = [
    "-e",
    "RCLONE_CONFIG_OB_TYPE=s3",
    "-e",
    `RCLONE_CONFIG_OB_PROVIDER=${bucket.provider || "Other"}`,
    "-e",
    `RCLONE_CONFIG_OB_ACCESS_KEY_ID=${bucket.accessKeyId}`,
    "-e",
    `RCLONE_CONFIG_OB_SECRET_ACCESS_KEY=${bucket.secretAccessKey}`,
  ]
  if (bucket.endpoint) {
    env.push("-e", `RCLONE_CONFIG_OB_ENDPOINT=${bucket.endpoint}`)
  }
  if (bucket.region) {
    env.push("-e", `RCLONE_CONFIG_OB_REGION=${bucket.region}`)
  }
  return env
}

function remotePath(bucket: BackupBucket, rest: string) {
  return `ob:${bucket.bucket}${bucket.prefix ? `/${bucket.prefix}` : ""}/${rest}`
}

export async function testBucket(bucket: BackupBucket): Promise<string | null> {
  try {
    await ensureRcloneImage()
    await docker([
      "run",
      "--rm",
      ...rcloneEnv(bucket),
      RCLONE_IMAGE,
      ...RCLONE_GLOBAL,
      "lsf",
      "--max-depth",
      "1",
      remotePath(bucket, ""),
      ...RCLONE_AFTER,
    ])
    return null
  } catch (error) {
    return error instanceof Error ? error.message : "bucket test failed"
  }
}

async function uploadToBucket(bucket: BackupBucket, id: string, dir: string) {
  await ensureRcloneImage()
  const files: { name: string; path: string }[] = []
  if (existsSync(join(dir, "control.sqlite.gz")))
    files.push({
      name: "control.sqlite.gz",
      path: join(dir, "control.sqlite.gz"),
    })
  const usersDir = join(dir, "users")
  if (existsSync(usersDir)) {
    for (const key of readdirSync(usersDir)) {
      const userDir = join(usersDir, key)
      for (const file of readdirSync(userDir)) {
        files.push({ name: `users/${key}/${file}`, path: join(userDir, file) })
      }
    }
  }
  files.push({ name: "manifest.json", path: join(dir, "manifest.json") })
  for (const file of files) {
    await streamFromFile(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        ...rcloneEnv(bucket),
        RCLONE_IMAGE,
        ...RCLONE_GLOBAL,
        "rcat",
        remotePath(bucket, `${id}/${file.name}`),
        ...RCLONE_AFTER,
      ],
      file.path,
    )
  }
}

export async function pruneRemoteBackups(
  bucket: BackupBucket,
  keep: number,
): Promise<string[]> {
  await ensureRcloneImage()
  const listing = await sh([
    "docker",
    "run",
    "--rm",
    ...rcloneEnv(bucket),
    RCLONE_IMAGE,
    ...RCLONE_GLOBAL,
    "lsf",
    "--dirs-only",
    "--recursive",
    "--max-depth",
    "1",
    remotePath(bucket, ""),
    ...RCLONE_AFTER,
  ])
  if (listing.code !== 0) return []
  const ids = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/\/$/, "").trim())
    .filter((line) => line && !line.includes("/"))
    .sort()
    .reverse()
  const removed: string[] = []
  for (const id of ids.slice(keep)) {
    try {
      await docker([
        "run",
        "--rm",
        ...rcloneEnv(bucket),
        RCLONE_IMAGE,
        ...RCLONE_GLOBAL,
        "purge",
        remotePath(bucket, id),
        ...RCLONE_AFTER,
      ])
      removed.push(id)
    } catch {
      // keep pruning the rest
    }
  }
  return removed
}

function backupId(at = Date.now()) {
  const stamp = new Date(at)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const rand = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${rand}`
}

export function pruneStaleStaging() {
  const root = backupRoot()
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith(".staging-")) continue
    const full = join(root, entry)
    try {
      if (Date.now() - statSync(full).mtimeMs > STAGING_MAX_AGE_MS)
        rmSync(full, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

export function pruneLocalBackups(keep: number, root = backupRoot()): string[] {
  if (!existsSync(root)) return []
  const ids = readdirSync(root)
    .filter((entry) => !entry.startsWith("."))
    .sort()
    .reverse()
  const removed: string[] = []
  for (const id of ids.slice(keep)) {
    try {
      rmSync(join(root, id), { recursive: true, force: true })
      removed.push(id)
    } catch {
      // keep pruning the rest
    }
  }
  return removed
}

export function listBackups(): BackupSummary[] {
  const root = backupRoot()
  if (!existsSync(root)) return []
  const out: BackupSummary[] = []
  for (const id of readdirSync(root)
    .filter((e) => !e.startsWith("."))
    .sort()
    .reverse()) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(root, id, "manifest.json"), "utf8"),
      ) as BackupManifest
      out.push({
        id: manifest.id,
        startedAt: manifest.startedAt,
        finishedAt: manifest.finishedAt,
        trigger: manifest.trigger,
        label: manifest.label,
        totalBytes: manifest.totalBytes,
        hasControlDb: manifest.controlDb != null,
        users: manifest.users.map((user) => ({
          userId: user.userId,
          email: user.email,
          files: user.volumes.length,
        })),
      })
    } catch {
      // unreadable manifest; skip
    }
  }
  return out
}

export function readManifest(id: string): BackupManifest | null {
  try {
    return JSON.parse(
      readFileSync(join(backupRoot(), id, "manifest.json"), "utf8"),
    ) as BackupManifest
  } catch {
    return null
  }
}

export function totalBytesOf(dir: string, relative: string) {
  try {
    return statSync(join(dir, relative)).size
  } catch {
    return 0
  }
}

async function archiveVolume(volume: string, filePath: string) {
  const inspect = await sh(["docker", "volume", "inspect", volume])
  if (inspect.code !== 0) return 0
  return streamToFile(
    [
      "docker",
      "run",
      "--rm",
      "-v",
      `${volume}:/src:ro`,
      "--entrypoint",
      "tar",
      opencodeImage,
      "-czf",
      "-",
      "-C",
      "/src",
      ".",
    ],
    filePath,
  )
}

export async function restoreVolumeFromFile(volume: string, filePath: string) {
  await docker(["volume", "create", volume])
  await streamFromFile(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      "-v",
      `${volume}:/dst`,
      "--entrypoint",
      "sh",
      opencodeImage,
      "-c",
      "find /dst -mindepth 1 -delete; tar -xzf - -C /dst",
    ],
    filePath,
  )
}

async function snapshotControlDb(filePath: string) {
  const tmp = `${filePath}.tmp`
  const { Database } = await import("bun:sqlite")
  const live = new Database(join(dataDir, "open-bot.sqlite"), {
    readonly: true,
  })
  try {
    // VACUUM INTO reads the live database and writes a compact standalone copy.
    live.exec(`VACUUM INTO '${tmp}'`)
  } finally {
    live.close()
  }
  const gz = Bun.gzipSync(readFileSync(tmp))
  rmSync(tmp, { force: true })
  writeFileSync(filePath, gz)
  return gz.byteLength
}

export function restoreControlDbSnapshot(id: string) {
  const source = join(backupRoot(), id, "control.sqlite.gz")
  if (!existsSync(source)) throw new Error(`backup ${id} has no control db`)
  const target = join(dataDir, "open-bot.sqlite.restore")
  writeFileSync(target, Bun.gunzipSync(readFileSync(source)))
  return target
}

/** Boot hook: swap a staged restore into place before the database opens. */
export function applyPendingRestore(dir = dataDir): boolean {
  const restore = join(dir, "open-bot.sqlite.restore")
  if (!existsSync(restore)) return false
  const live = join(dir, "open-bot.sqlite")
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${live}${suffix}`
    if (existsSync(from)) renameSync(from, `${live}.pre-restore${suffix}`)
  }
  renameSync(restore, live)
  return true
}

let inFlight: Promise<BackupManifest> | null = null

export function backupInFlight() {
  return inFlight !== null
}

export function runState(id: string): BackupRunState | null {
  return runs.get(id) ?? null
}

const runs = new Map<string, BackupRunState>()

export type BackupOptions = {
  db: Db
  trigger: BackupManifest["trigger"]
  label?: string | null
  userIds: string[]
  includeControlDb: boolean
}

export function startBackup(options: BackupOptions): BackupRunState {
  const id = backupId()
  const state: BackupRunState = {
    id,
    state: "running",
    error: null,
    manifest: null,
    userIds: options.userIds,
    includeControlDb: options.includeControlDb,
  }
  runs.set(id, state)
  void createBackup({ ...options, id })
    .then((manifest) => {
      state.state = "done"
      state.manifest = manifest
    })
    .catch((error) => {
      state.state = "failed"
      state.error = error instanceof Error ? error.message : "backup failed"
    })
    .finally(() => {
      setTimeout(() => runs.delete(id), 30 * 60 * 1000).unref?.()
    })
  return state
}

export async function createBackup(
  options: BackupOptions & { id?: string },
): Promise<BackupManifest> {
  if (inFlight) throw new Error("a backup is already running")
  const run = (async () => {
    const id = options.id ?? backupId()
    const startedAt = Date.now()
    pruneStaleStaging()
    const staging = join(backupRoot(), `.staging-${id}`)
    mkdirSync(staging, { recursive: true })
    const manifest: BackupManifest = {
      id,
      startedAt,
      finishedAt: startedAt,
      trigger: options.trigger,
      label: options.label ?? null,
      controlDb: null,
      users: [],
      totalBytes: 0,
    }
    try {
      if (options.includeControlDb) {
        const bytes = await snapshotControlDb(
          join(staging, "control.sqlite.gz"),
        )
        manifest.controlDb = { bytes }
        manifest.totalBytes += bytes
      }
      for (const userId of options.userIds) {
        const user = options.db.userById(userId)
        if (!user) continue
        const n = names(userId)
        const userDir = join(staging, "users", n.key)
        mkdirSync(userDir, { recursive: true })
        const entry: BackupUserEntry = {
          userId,
          email: user.email,
          key: n.key,
          volumes: [],
        }
        for (const { volume, file } of VOLUME_FILES) {
          const bytes = await archiveVolume(n[volume], join(userDir, file))
          if (bytes === 0) continue
          entry.volumes.push({ name: n[volume], file, bytes })
          manifest.totalBytes += bytes
        }
        manifest.users.push(entry)
      }
      manifest.finishedAt = Date.now()
      writeFileSync(
        join(staging, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      )
      const config = loadBackupConfig(options.db)
      if (config.bucket) {
        await uploadToBucket(config.bucket, id, staging)
      }
      renameSync(staging, join(backupRoot(), id))
      recordStatus(options.db, null)
      pruneLocalBackups(config.keepLocal)
      if (config.bucket) {
        void pruneRemoteBackups(config.bucket, config.keepRemote).catch(
          () => {},
        )
      }
      return manifest
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      const message = error instanceof Error ? error.message : "backup failed"
      recordStatus(options.db, message)
      throw error
    }
  })()
  inFlight = run
  try {
    return await run
  } finally {
    inFlight = null
  }
}

export function deleteBackup(id: string, db?: Db): boolean {
  const dir = join(backupRoot(), id)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  if (db) {
    const bucket = loadBackupConfig(db).bucket
    if (bucket) {
      void ensureRcloneImage()
        .then(() =>
          docker([
            "run",
            "--rm",
            ...rcloneEnv(bucket),
            RCLONE_IMAGE,
            ...RCLONE_GLOBAL,
            "purge",
            remotePath(bucket, id),
            ...RCLONE_AFTER,
          ]),
        )
        .catch(() => {})
    }
  }
  return true
}

/** Restore one user's desktop volumes from a backup directory. */
export async function restoreUserVolumes(id: string, userId: string) {
  const dir = join(backupRoot(), id, "users", names(userId).key)
  if (!existsSync(dir)) throw new Error("backup has no volumes for this user")
  const manifest = readManifest(id)
  const entry = manifest?.users.find((user) => user.userId === userId)
  const restored: string[] = []
  for (const { volume, file } of VOLUME_FILES) {
    const known = entry?.volumes.find((item) => item.file === file)
    const path = join(dir, file)
    if (!known && !existsSync(path)) continue
    await restoreVolumeFromFile(names(userId)[volume], path)
    restored.push(volume)
  }
  return restored
}

/** Schedule loop: fires due backups and stores the next run time. */
export function startBackupScheduler(db: Db) {
  const tick = () => {
    try {
      const config = loadBackupConfig(db)
      if (!config.enabled || !config.schedule) {
        db.setSetting(BACKUP_NEXT_RUN_KEY, "")
        return
      }
      const raw = db.getSetting(BACKUP_NEXT_RUN_KEY)
      let due = Number(raw ?? 0)
      if (!due) {
        due = nextBackupRunMs(config.schedule) ?? 0
        if (!due) return
        db.setSetting(BACKUP_NEXT_RUN_KEY, String(due))
        return
      }
      if (Date.now() < due) return
      const next = nextBackupRunMs(config.schedule) ?? 0
      db.setSetting(BACKUP_NEXT_RUN_KEY, String(next))
      if (inFlight) return
      startBackup({
        db,
        trigger: "schedule",
        userIds: db.desktopUserIds(),
        includeControlDb: true,
      })
    } catch {
      // scheduler must never crash the process
    }
  }
  tick()
  return setInterval(tick, 30_000)
}
