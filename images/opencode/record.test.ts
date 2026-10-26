import { expect, test } from "bun:test"
import {
  ffmpegArgs,
  isAlive,
  parseRecordArgs,
  procStartTime,
  type RecordState,
  resolveOutput,
} from "./record"

test("record args default to 15fps capped at 600s", () => {
  expect(parseRecordArgs(["start"])).toEqual({
    verb: "start",
    options: { fps: 15, durationSec: 600 },
  })
  expect(parseRecordArgs(["status"])).toEqual({
    verb: "status",
    options: { fps: 15, durationSec: 600 },
  })
})

test("record args parse fps, duration and output in both forms", () => {
  expect(
    parseRecordArgs([
      "start",
      "--fps",
      "5",
      "--duration=30",
      "--output",
      "x.mp4",
    ]),
  ).toEqual({
    verb: "start",
    options: { fps: 5, durationSec: 30, output: "x.mp4" },
  })
})

test("record args reject out-of-range and unknown options", () => {
  expect(() => parseRecordArgs(["start", "--fps", "60"])).toThrow("--fps")
  expect(() => parseRecordArgs(["start", "--fps", "0"])).toThrow("--fps")
  expect(() => parseRecordArgs(["start", "--duration", "99999"])).toThrow(
    "--duration",
  )
  expect(() => parseRecordArgs(["start", "--bogus"])).toThrow("unknown option")
  expect(() => parseRecordArgs(["start", "--fps"])).toThrow("needs a value")
})

test("output defaults into the session recordings dir", () => {
  const file = resolveOutput(
    "ses_1",
    undefined,
    new Date("2026-10-26T01:02:03Z"),
  )
  expect(
    file.endsWith(".open-bot/recordings/ses_1/rec-20261026T010203Z.mp4"),
  ).toBe(true)
})

test("output resolves relatives into the recordings dir and gates paths", () => {
  expect(resolveOutput("ses_1", "debug.webm")).toContain(
    ".open-bot/recordings/ses_1/debug.webm",
  )
  expect(resolveOutput("ses_1", "/tmp/cap.mp4")).toBe("/tmp/cap.mp4")
  expect(() => resolveOutput("ses_1", "/etc/cap.mp4")).toThrow(
    "/home/agent or /tmp",
  )
  expect(() => resolveOutput("ses_1", "cap.gif")).toThrow(
    ".mp4, .webm, or .mkv",
  )
  expect(() => resolveOutput("ses_1", ".hidden.mp4")).toThrow(
    "must not be hidden",
  )
})

test("ffmpeg args take feeder frames on stdin and cap the duration", () => {
  const args = ffmpegArgs({ fps: 10, durationSec: 42, file: "/tmp/a.mp4" })
  expect(args).toContain("rawvideo")
  expect(args).toContain("bgra")
  expect(args[args.indexOf("-i") + 1]).toBe("-")
  expect(args[args.indexOf("-framerate") + 1]).toBe("10")
  expect(args[args.indexOf("-t") + 1]).toBe("42")
  expect(args).toContain("libx264")
  expect(args[args.length - 1]).toBe("/tmp/a.mp4")
})

test("liveness follows the pid and rejects a reused pid", async () => {
  const proc = Bun.spawn(["sleep", "30"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  const base: Omit<RecordState, "pid" | "pgid" | "startTime"> = {
    id: "x.mp4",
    file: "/tmp/x.mp4",
    fps: 5,
    maxSeconds: 60,
    startedAt: Date.now(),
    log: "/tmp/x.log",
  }
  const state: RecordState = {
    ...base,
    pid: proc.pid,
    pgid: proc.pid,
    startTime: procStartTime(proc.pid) ?? 0,
  }
  expect(state.startTime).toBeGreaterThan(0)
  expect(isAlive(state)).toBe(true)
  // Same pid, different boot-time start ticks: a recycled pid is not ours.
  expect(isAlive({ ...state, startTime: state.startTime + 1 })).toBe(false)
  proc.kill()
  await proc.exited
  expect(isAlive(state)).toBe(false)
  expect(isAlive({ ...state, pid: 0, startTime: 0 })).toBe(false)
})

test("webm output switches to the vp8 realtime encoder", () => {
  const args = ffmpegArgs({ fps: 15, durationSec: 60, file: "/tmp/a.webm" })
  expect(args).toContain("libvpx")
  expect(args).not.toContain("libx264")
})
