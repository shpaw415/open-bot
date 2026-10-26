import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Db } from "@open-bot/db"
import * as shellModule from "./shell"

// Spread the real modules: mock.module leaks into later files of the same
// run, so every export must stay present.
const shCalls: { args: string[]; input?: string }[] = []
let shResult = { code: 0, stdout: "", stderr: "" }
let capturedAuth: Record<string, unknown> | null = null
let syncChanged: string[] = []

mock.module("./shell", () => ({
  ...shellModule,
  sh: async (args: string[], input?: string) => {
    // docker.ts's isRunning probes the container through sh — answer it so
    // capture/sync reach the code under test.
    if (args.includes("inspect")) {
      return { code: 0, stdout: "true\n", stderr: "" }
    }
    shCalls.push({ args, input })
    return shResult
  },
}))

// docker.ts must evaluate against the mocked shell (a static import would
// capture the real sh binding), then the docker module itself is mocked for
// team-apply's fan-out calls.
const dockerModule = await import("./docker")
let restartCalls = 0
mock.module("./docker", () => ({
  ...dockerModule,
  captureOpencodeAuth: async () => capturedAuth,
  syncOpencodeAuth: async () => ({ changed: syncChanged }),
  restartOpencode: async () => {
    restartCalls += 1
  },
}))
const { getTeamOpencodeAuth, setTeamOpencodeAuth, teamOpencodeAuthPublic } =
  await import("./team")
const { pushTeamOpencodeAuth, refreshTeamOpencodeAuth } = await import(
  "./team-apply"
)

const scriptPath = join(
  import.meta.dir,
  "../../../images/opencode/apply-opencode-auth.sh",
)

function settingsDb(overrides: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(overrides))
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => void store.set(key, value),
    desktop: () => ({ opencodePassword: "pw" }),
    listUsers: () => [],
  } as unknown as Db
}

function teamConfigDb(
  mode: "personal" | "team",
  overrides: Record<string, string> = {},
) {
  return settingsDb({
    team_config: JSON.stringify({
      mode,
      lockModelPicker: false,
      lockWatchdog: false,
      quotaDefaultTokens: null,
      quotaBehavior: "block",
      providers: {},
    }),
    ...overrides,
  })
}

beforeEach(() => {
  shCalls.length = 0
  shResult = { code: 0, stdout: "", stderr: "" }
  capturedAuth = null
  syncChanged = []
})

describe("team opencode auth snapshot storage", () => {
  test("round-trips and reports providers without secrets", () => {
    const db = settingsDb()
    expect(getTeamOpencodeAuth(db)).toBeNull()
    const snapshot = setTeamOpencodeAuth(db, {
      zai: { type: "api", key: "secret" },
    })
    expect(snapshot.capturedAt).toBeGreaterThan(0)
    const stored = getTeamOpencodeAuth(db)
    expect(stored?.entries).toEqual({ zai: { type: "api", key: "secret" } })
    expect(teamOpencodeAuthPublic(stored)).toEqual({
      hasAuth: true,
      providers: ["zai"],
      capturedAt: snapshot.capturedAt,
    })
    expect(teamOpencodeAuthPublic(null)).toEqual({
      hasAuth: false,
      providers: [],
      capturedAt: null,
    })
  })

  test("tolerates corrupt settings", () => {
    expect(
      getTeamOpencodeAuth(settingsDb({ team_opencode_auth: "{nope" })),
    ).toBeNull()
    expect(
      getTeamOpencodeAuth(settingsDb({ team_opencode_auth: '{"entries":[]}' })),
    ).toBeNull()
  })
})

describe("pushTeamOpencodeAuth", () => {
  test("merges the snapshot and reports the change in team mode", async () => {
    syncChanged = ["zai"]
    const db = teamConfigDb("team", {
      team_opencode_auth: JSON.stringify({
        entries: { zai: { type: "api", key: "k" } },
        capturedAt: 5,
      }),
    })
    expect(await pushTeamOpencodeAuth(db, "u1")).toEqual({ changed: ["zai"] })
    expect(restartCalls).toBe(1)
  })

  test("skips in personal mode and on an empty snapshot", async () => {
    expect(
      await pushTeamOpencodeAuth(teamConfigDb("personal"), "u1"),
    ).toBeNull()
    expect(await pushTeamOpencodeAuth(teamConfigDb("team"), "u1")).toBeNull()
  })
})

describe("refreshTeamOpencodeAuth", () => {
  test("captures, stores, and fans out", async () => {
    capturedAuth = { colibri: { type: "api", key: "local" } }
    syncChanged = ["colibri"]
    const db = teamConfigDb("team")
    const result = await refreshTeamOpencodeAuth(db, "admin")
    expect(result?.hasAuth).toBe(true)
    expect(result?.providers).toEqual(["colibri"])
    const stored = getTeamOpencodeAuth(db)
    expect(Object.keys(stored?.entries ?? {})).toEqual(["colibri"])
  })

  test("returns null and keeps the old snapshot when the capture fails", async () => {
    capturedAuth = null
    const db = teamConfigDb("team", {
      team_opencode_auth: JSON.stringify({
        entries: { zai: { type: "api", key: "k" } },
        capturedAt: 5,
      }),
    })
    expect(await refreshTeamOpencodeAuth(db, "admin")).toBeNull()
    expect(Object.keys(getTeamOpencodeAuth(db)?.entries ?? {})).toEqual(["zai"])
  })

  test("does nothing in personal mode", async () => {
    capturedAuth = { zai: { type: "api", key: "k" } }
    const db = teamConfigDb("personal")
    expect(await refreshTeamOpencodeAuth(db, "admin")).toBeNull()
    expect(getTeamOpencodeAuth(db)).toBeNull()
  })
})

describe("apply-opencode-auth.sh", () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ob-oc-auth-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function runScript(payload: unknown) {
    // Bun.spawnSync's input option does not reach stdin here; the payload
    // rides an env var through a shell pipe instead.
    return Bun.spawnSync(
      ["sh", "-c", 'printf %s "$OB_PAYLOAD" | sh "$OB_SCRIPT"'],
      {
        env: {
          ...process.env,
          HOME: home,
          OB_PAYLOAD: JSON.stringify(payload),
          OB_SCRIPT: scriptPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
  }

  const authPath = () => join(home, ".local/share/opencode/auth.json")

  test("adds, replaces, and skips identical entries while preserving others", () => {
    mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
    writeFileSync(
      authPath(),
      JSON.stringify({
        personal: { type: "oauth", refresh: "r" },
        zai: { type: "api", key: "old" },
        same: { type: "api", key: "keep" },
      }),
    )
    const proc = runScript({
      entries: {
        zai: { type: "api", key: "new" },
        colibri: { type: "api", key: "local" },
        same: { type: "api", key: "keep" },
        copilot: { type: "oauth", refresh: "tok" },
      },
    })
    expect(proc.exitCode).toBe(0)
    // jq's keys[] sorts alphabetically — the changed order follows it.
    expect(JSON.parse(proc.stdout.toString())).toEqual({
      changed: ["colibri", "copilot", "zai"],
    })
    const auth = JSON.parse(readFileSync(authPath(), "utf8"))
    expect(auth.personal).toEqual({ type: "oauth", refresh: "r" })
    expect(auth.zai).toEqual({ type: "api", key: "new" })
    expect(auth.colibri).toEqual({ type: "api", key: "local" })
    expect(auth.same).toEqual({ type: "api", key: "keep" })
    expect(auth.copilot).toEqual({ type: "oauth", refresh: "tok" })
  })

  test("rejects an invalid payload and creates the file when missing", () => {
    const bad = runScript({ entries: "nope" })
    expect(bad.exitCode).not.toBe(0)
    const ok = runScript({ entries: { zai: { type: "api", key: "k" } } })
    expect(ok.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(authPath(), "utf8")).zai).toEqual({
      type: "api",
      key: "k",
    })
  })
})
