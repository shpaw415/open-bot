// Screen video recorder for the desktop agent (ob-record).
// Captures the thread's whole Xvfb display (browser + native apps) — a
// debugging artifact, not a page screencast. Frames come from xrecord.py
// (XGetImage, the xcap.py path): the screens run Xvfb with MIT-SHM
// disabled, where ffmpeg's x11grab receives no frames. A detached
// supervisor (`run`, spawned by `start`) pumps feeder frames into ffmpeg
// so the `start` call itself can return. One recording per screen at a
// time; state lives beside the file under ~/.open-bot/recordings/<session>/
// so `stop`/`status` in a later bash call find the recording.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"

export const RECORD_USAGE =
  "usage: record.ts SESSION DISPLAY start [--fps N] [--duration SEC] [--output FILE] | stop | status | list"
export const DEFAULT_FPS = 15
export const MAX_FPS = 30
export const DEFAULT_MAX_SECONDS = 600
export const MAX_SECONDS = 3600
export const SCREEN_WIDTH = 1920
export const SCREEN_HEIGHT = 1200

export type RecordState = {
  id: string
  pid: number
  pgid: number
  startTime: number
  file: string
  fps: number
  maxSeconds: number
  startedAt: number
  display?: number
  log: string
}

export type StartOptions = {
  fps: number
  durationSec: number
  output?: string
}

export function homeDir() {
  return process.env.HOME || "/home/agent"
}

export function recordingsDir(session: string) {
  return join(homeDir(), ".open-bot/recordings", session)
}

export function stateFile(session: string) {
  return join(recordingsDir(session), "current.json")
}

export function parseRecordArgs(argv: string[]): {
  verb: string
  options: StartOptions
} {
  const [verb = "", ...rest] = argv
  if (verb !== "start")
    return {
      verb,
      options: { fps: DEFAULT_FPS, durationSec: DEFAULT_MAX_SECONDS },
    }
  let fps = DEFAULT_FPS
  let durationSec = DEFAULT_MAX_SECONDS
  let output: string | undefined
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i]
    const [key, eq] = item.includes("=")
      ? [item.slice(0, item.indexOf("=")), item.slice(item.indexOf("=") + 1)]
      : [item, undefined]
    const value = eq ?? rest[i + 1]
    if (key === "--fps" || key === "--duration" || key === "--output") {
      if (value === undefined || (eq === undefined && value.startsWith("--")))
        throw new Error(`${key} needs a value`)
      if (eq === undefined) i += 1
      if (key === "--fps") fps = Number(value)
      else if (key === "--duration") durationSec = Number(value)
      else output = value
    } else if (key === "--max" || key === "--seconds") {
      // Tolerated aliases for --duration.
      if (value === undefined || (eq === undefined && value.startsWith("--")))
        throw new Error(`${key} needs a value`)
      if (eq === undefined) i += 1
      durationSec = Number(value)
    } else throw new Error(`unknown option ${item} — ${RECORD_USAGE}`)
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS)
    throw new Error(`--fps must be an integer between 1 and ${MAX_FPS}`)
  if (
    !Number.isInteger(durationSec) ||
    durationSec < 1 ||
    durationSec > MAX_SECONDS
  )
    throw new Error(
      `--duration must be an integer between 1 and ${MAX_SECONDS} seconds`,
    )
  return { verb, options: { fps, durationSec, output } }
}

// Relative outputs land in the session's recordings dir; absolute ones must
// stay under the agent home or /tmp so a typo cannot scribble over system
// files. The extension picks the encoder, so anything else is refused.
export function resolveOutput(
  session: string,
  requested: string | undefined,
  now = new Date(),
): string {
  if (!requested) {
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
    return join(recordingsDir(session), `rec-${stamp}.mp4`)
  }
  const file = requested.startsWith("/")
    ? resolve(requested)
    : join(recordingsDir(session), requested)
  const ext = extname(file).toLowerCase()
  if (ext !== ".mp4" && ext !== ".webm" && ext !== ".mkv")
    throw new Error("recording output must end in .mp4, .webm, or .mkv")
  const home = resolve(homeDir())
  if (
    file !== home &&
    !file.startsWith(`${home}/`) &&
    !file.startsWith("/tmp/")
  )
    throw new Error("recording output must be under /home/agent or /tmp")
  if (basename(file).startsWith("."))
    throw new Error("recording output name must not be hidden")
  return file
}

export function ffmpegArgs(opts: {
  fps: number
  durationSec: number
  file: string
}): string[] {
  const ext = extname(opts.file).toLowerCase()
  const video =
    ext === ".webm"
      ? [
          "-c:v",
          "libvpx",
          "-deadline",
          "realtime",
          "-cpu-used",
          "5",
          "-b:v",
          "2M",
        ]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23"]
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "bgra",
    "-video_size",
    `${SCREEN_WIDTH}x${SCREEN_HEIGHT}`,
    "-framerate",
    String(opts.fps),
    "-i",
    "-",
    "-an",
    ...video,
    "-pix_fmt",
    "yuv420p",
    "-t",
    String(opts.durationSec),
    opts.file,
  ]
}

export function feederPath() {
  return process.env.OB_RECORD_FEEDER || "/opt/open-bot/xrecord.py"
}

function readState(session: string): RecordState | null {
  try {
    const row = JSON.parse(
      readFileSync(stateFile(session), "utf8"),
    ) as RecordState
    if (!Number.isInteger(row.pid) || !row.file) return null
    return row
  } catch {
    return null
  }
}

function writeState(session: string, state: RecordState) {
  mkdirSync(recordingsDir(session), { recursive: true })
  const tmp = `${stateFile(session)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state)}\n`)
  renameSync(tmp, stateFile(session))
}

function clearState(session: string) {
  try {
    unlinkSync(stateFile(session))
  } catch {}
}

// /proc starttime (field 22) guards against pid reuse, same as ob-process:
// a recycled pid must never receive our stop signal.
export function procStartTime(pid: number): number | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8")
    const tail = raw
      .slice(raw.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/)
    const value = Number(tail[19])
    return Number.isInteger(value) ? value : null
  } catch {
    return null
  }
}

export function isAlive(state: RecordState): boolean {
  if (!state.pid) return false
  try {
    process.kill(state.pid, 0)
  } catch {
    return false
  }
  if (state.startTime) return procStartTime(state.pid) === state.startTime
  return true
}

function fileInfo(file: string) {
  try {
    const row = statSync(file)
    return { bytes: row.size, modifiedAt: Math.round(row.mtimeMs) }
  } catch {
    return { bytes: 0, modifiedAt: 0 }
  }
}

async function probeSeconds(file: string): Promise<number | null> {
  if (!Bun.which("ffprobe")) return null
  try {
    const proc = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ])
    const value = Number(proc.stdout.toString().trim())
    return Number.isFinite(value) && value > 0
      ? Math.round(value * 10) / 10
      : null
  } catch {
    return null
  }
}

async function startRecording(
  session: string,
  display: number,
  options: StartOptions,
) {
  if (!Bun.which("ffmpeg"))
    throw new Error(
      "ffmpeg is not installed on this desktop — rebuild images (bun run images && bun run update), then retry",
    )
  if (!existsSync(`/tmp/.X11-unix/X${display}`))
    throw new Error(`no screen on display :${display} for ${session}`)
  const existing = readState(session)
  if (existing && isAlive(existing)) {
    throw new Error(
      `already recording ${existing.file} since ${new Date(existing.startedAt).toISOString()} — run ob-record stop first`,
    )
  }
  if (existing) clearState(session)
  const file = resolveOutput(session, options.output)
  if (existsSync(file)) throw new Error(`output already exists: ${file}`)
  mkdirSync(dirname(file), { recursive: true })
  mkdirSync(recordingsDir(session), { recursive: true })
  const log = join(recordingsDir(session), "ffmpeg.log")
  // State first (pid filled in below): the supervisor reads it to learn
  // what to record, and `status` sees the row from the first moment.
  const state: RecordState = {
    id: basename(file),
    pid: 0,
    pgid: 0,
    startTime: 0,
    file,
    fps: options.fps,
    maxSeconds: options.durationSec,
    startedAt: Date.now(),
    display,
    log,
  }
  writeState(session, state)
  const supervisor = Bun.spawn(
    ["setsid", "bun", import.meta.path, session, String(display), "run"],
    { stdin: "ignore", stdout: Bun.file(log), stderr: Bun.file(log) },
  )
  // Without unref, Bun keeps this `start` process alive until the
  // supervisor exits — start would block for the whole recording.
  supervisor.unref()
  // setsid may fork, so the spawned pid is not the supervisor's: the
  // supervisor writes its own pid/pgid/startTime into the state file on
  // boot, and start polls for that instead of trusting the spawn handle.
  const deadline = Date.now() + 5000
  let live = readState(session)
  while (Date.now() < deadline) {
    live = readState(session)
    if (live && live.pid > 0 && isAlive(live)) break
    await Bun.sleep(100)
    live = readState(session)
    if (live && live.pid > 0 && isAlive(live)) break
  }
  await Bun.sleep(500)
  live = readState(session)
  if (!live || !isAlive(live)) {
    clearState(session)
    let tail = ""
    try {
      tail = readFileSync(log, "utf8").trim().split("\n").slice(-3).join(" ")
    } catch {}
    throw new Error(
      `recording exited immediately${tail ? `: ${tail.slice(0, 240)}` : ""}`,
    )
  }
  return {
    recording: true,
    id: live.id,
    file,
    fps: live.fps,
    maxSeconds: live.maxSeconds,
    startedAt: new Date(live.startedAt).toISOString(),
    pid: live.pid,
  }
}

// Detached supervisor: owns the feeder -> ffmpeg pipe for one recording.
// Runs until ffmpeg hits its -t cap, the feeder dies, or `stop` SIGINTs
// the process group — the handler forwards SIGINT to ffmpeg alone so the
// container finalizes instead of truncating.
async function runRecording(session: string) {
  const state = readState(session)
  if (!state) throw new Error("no recording state")
  // Claim the row with our real pid: setsid may have forked, so the
  // spawner's handle does not name this process.
  state.pid = process.pid
  state.pgid = process.pid
  state.startTime = procStartTime(process.pid) ?? 0
  writeState(session, state)
  const logFile = Bun.file(state.log)
  const feeder = Bun.spawn(["python3", feederPath(), String(state.fps)], {
    env: { ...process.env, DISPLAY: `:${state.display ?? 2}` },
    stdin: "ignore",
    stdout: "pipe",
    stderr: logFile,
  })
  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      ...ffmpegArgs({
        fps: state.fps,
        durationSec: state.maxSeconds,
        file: state.file,
      }),
    ],
    { stdin: "pipe", stdout: logFile, stderr: logFile },
  )
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    try {
      ffmpeg.sendSignal("SIGINT")
    } catch {}
    try {
      feeder.kill("SIGTERM")
    } catch {}
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
  const pump = (async () => {
    try {
      for await (const chunk of feeder.stdout) {
        const sink = ffmpeg.stdin as unknown as {
          write(chunk: Uint8Array): number | Promise<number>
          flush?: () => number | Promise<number>
        }
        await sink.write(chunk as Uint8Array)
        await sink.flush?.()
      }
    } catch {}
    try {
      ;(ffmpeg.stdin as unknown as { end(): void }).end()
    } catch {}
  })()
  await Promise.race([feeder.exited, ffmpeg.exited])
  shutdown()
  await pump.catch(() => undefined)
  await ffmpeg.exited.catch(() => undefined)
  try {
    feeder.kill("SIGTERM")
  } catch {}
}

async function stopRecording(session: string) {
  const state = readState(session)
  if (!state) return { recording: false, stopped: false }
  const wasAlive = isAlive(state)
  if (wasAlive) {
    // SIGINT lets ffmpeg finalize the container (moov/trailer); TERM/KILL
    // are only the fallback for a wedged encoder, in that order.
    try {
      process.kill(-state.pgid, "SIGINT")
    } catch {
      try {
        process.kill(state.pid, "SIGINT")
      } catch {}
    }
    const deadline = Date.now() + 10_000
    while (isAlive(state) && Date.now() < deadline) await Bun.sleep(100)
    if (isAlive(state)) {
      try {
        process.kill(-state.pgid, "SIGTERM")
      } catch {}
      await Bun.sleep(500)
    }
    if (isAlive(state)) {
      try {
        process.kill(-state.pgid, "SIGKILL")
      } catch {}
    }
  }
  clearState(session)
  const info = fileInfo(state.file)
  const elapsed = Math.max(
    0,
    Math.round(((info.modifiedAt || Date.now()) - state.startedAt) / 100) / 10,
  )
  return {
    recording: false,
    stopped: wasAlive,
    finalized: !wasAlive,
    file: state.file,
    bytes: info.bytes,
    seconds: (await probeSeconds(state.file)) ?? elapsed,
  }
}

function statusRecording(session: string) {
  const state = readState(session)
  if (!state) return { recording: false }
  // The supervisor claims the row (pid) a moment after `start` writes it;
  // in that window the recording is starting, not finished.
  if (state.pid === 0 && Date.now() - state.startedAt < 5000)
    return { recording: true, starting: true, file: state.file }
  if (!isAlive(state)) {
    clearState(session)
    const info = fileInfo(state.file)
    return {
      recording: false,
      finalized: true,
      file: state.file,
      bytes: info.bytes,
      startedAt: new Date(state.startedAt).toISOString(),
    }
  }
  return {
    recording: true,
    id: state.id,
    file: state.file,
    fps: state.fps,
    pid: state.pid,
    startedAt: new Date(state.startedAt).toISOString(),
    elapsedSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    maxSeconds: state.maxSeconds,
    bytes: fileInfo(state.file).bytes,
  }
}

function listRecordings(session: string) {
  const dir = recordingsDir(session)
  const state = readState(session)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {}
  const recordings = names
    .filter((name) => /\.(mp4|webm|mkv)$/i.test(name))
    .map((name) => {
      const file = join(dir, name)
      const info = fileInfo(file)
      return {
        file,
        bytes: info.bytes,
        modifiedAt: new Date(info.modifiedAt).toISOString(),
        active: state?.file === file && isAlive(state),
      }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return { recordings }
}

async function main() {
  const session = process.argv[2] ?? ""
  const display = Number(process.argv[3])
  const { verb, options } = parseRecordArgs(process.argv.slice(4))
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) throw new Error(RECORD_USAGE)
  if (!Number.isInteger(display) || display < 2 || display > 9)
    throw new Error(RECORD_USAGE)
  if (verb === "run") {
    await runRecording(session)
    return
  }
  let out: Record<string, unknown>
  if (verb === "start") out = await startRecording(session, display, options)
  else if (verb === "stop") out = await stopRecording(session)
  else if (verb === "status") out = statusRecording(session)
  else if (verb === "list") out = listRecordings(session)
  else throw new Error(RECORD_USAGE)
  console.log(JSON.stringify(out))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "recording failed")
    process.exit(1)
  })
}
