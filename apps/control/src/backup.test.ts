import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyPendingRestore,
  defaultBackupConfig,
  nextBackupRunMs,
  parseBackupConfig,
  pruneLocalBackups,
  publicBackupConfig,
} from "./backup"
import {
  APPROVAL_TTL_MS,
  approvalSummary,
  ResetApprovals,
} from "./reset-approvals"

const T = (iso: string) => Date.parse(iso)

describe("backup config", () => {
  test("defaults are disabled, daily at 04:00 UTC, keep 5 local", () => {
    const config = defaultBackupConfig()
    expect(config.enabled).toBe(false)
    expect(config.schedule).toBe("0 4 * * *")
    expect(config.keepLocal).toBe(5)
    expect(config.bucket).toBeNull()
  })

  test("accepts a valid config", () => {
    const parsed = parseBackupConfig({
      enabled: true,
      schedule: "30 5 * * 1",
      keepLocal: 3,
      keepRemote: 10,
      bucket: {
        endpoint: "https://account.r2.cloudflarestorage.com",
        region: "auto",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucket: "open-bot",
        prefix: "/backups/",
      },
    })
    expect(parsed.error).toBeUndefined()
    expect(parsed.value?.bucket?.prefix).toBe("backups")
  })

  test("rejects a bad cron schedule", () => {
    expect(parseBackupConfig({ schedule: "not a cron" }).error).toBeDefined()
    expect(parseBackupConfig({ schedule: "61 * * * *" }).error).toBeDefined()
  })

  test("bucket requires credentials and a bucket name", () => {
    expect(
      parseBackupConfig({ bucket: { accessKeyId: "k" } }).error,
    ).toBeDefined()
    expect(
      parseBackupConfig({
        bucket: {
          accessKeyId: "k",
          secretAccessKey: "s",
          bucket: "b",
          endpoint: "ftp://x",
        },
      }).error,
    ).toBeDefined()
  })

  test("public config masks the secret", () => {
    const parsed = parseBackupConfig({
      bucket: {
        accessKeyId: "k",
        secretAccessKey: "super-secret",
        bucket: "b",
      },
    })
    const config = parsed.value
    expect(config).toBeDefined()
    if (!config) return
    const published = publicBackupConfig(config)
    expect(published.bucket?.secretAccessKey).not.toBe("super-secret")
  })

  test("keepLocal bounds are enforced", () => {
    expect(parseBackupConfig({ keepLocal: 0 }).error).toBeDefined()
    expect(parseBackupConfig({ keepLocal: 101 }).error).toBeDefined()
    expect(parseBackupConfig({ keepLocal: 7 }).value?.keepLocal).toBe(7)
  })
})

describe("backup schedule", () => {
  test("next run follows the cron expression in UTC", () => {
    expect(nextBackupRunMs("0 4 * * *", T("2026-10-08T00:00:00Z"))).toBe(
      T("2026-10-08T04:00:00Z"),
    )
    expect(nextBackupRunMs("0 4 * * *", T("2026-10-08T04:00:00Z"))).toBe(
      T("2026-10-09T04:00:00Z"),
    )
  })
})

describe("pruneLocalBackups", () => {
  test("keeps the newest N backup dirs and never touches staging", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-prune-"))
    try {
      for (const id of [
        "20261001T000000Z-aaaa",
        "20261002T000000Z-bbbb",
        "20261003T000000Z-cccc",
      ])
        writeFileSync(join(dir, id), "x")
      writeFileSync(join(dir, ".staging-20261005T000000Z-dddd"), "x")
      expect(pruneLocalBackups(2, dir)).toEqual(["20261001T000000Z-aaaa"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("applyPendingRestore", () => {
  test("swaps a staged restore in and keeps the old database", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-restore-"))
    try {
      writeFileSync(join(dir, "open-bot.sqlite"), "old")
      writeFileSync(join(dir, "open-bot.sqlite-wal"), "wal")
      writeFileSync(join(dir, "open-bot.sqlite.restore"), "new")
      expect(applyPendingRestore(dir)).toBe(true)
      expect(readFileSync(join(dir, "open-bot.sqlite"), "utf8")).toBe("new")
      expect(
        readFileSync(join(dir, "open-bot.sqlite.pre-restore"), "utf8"),
      ).toBe("old")
      expect(
        readFileSync(join(dir, "open-bot.sqlite.pre-restore-wal"), "utf8"),
      ).toBe("wal")
      expect(applyPendingRestore(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function verify(password: string, stored: string) {
  return password === stored
}

describe("reset approvals", () => {
  test("pending request requires the right password", () => {
    const approvals = new ResetApprovals()
    const record = approvals.create("u1", { kind: "reset" })
    expect(record.status).toBe("pending")
    expect(
      approvals.approve(record.id, "u1", "wrong", verify, "right")?.error,
    ).toBe("wrong password")
    const ok = approvals.approve(record.id, "u1", "right", verify, "right")
    expect(ok.error).toBeUndefined()
    expect(ok.record?.status).toBe("approved")
    expect(ok.record?.result?.state).toBe("running")
  })

  test("another user's request is not visible", () => {
    const approvals = new ResetApprovals()
    const record = approvals.create("u1", { kind: "reset" })
    expect(approvals.get(record.id, "u2")).toBeNull()
    expect(
      approvals.approve(record.id, "u2", "right", verify, "right")?.error,
    ).toBe("request not found")
    expect(approvals.deny(record.id, "u2").error).toBe("request not found")
  })

  test("too many wrong passwords expires the request", () => {
    const approvals = new ResetApprovals()
    const record = approvals.create("u1", { kind: "reset" })
    for (let i = 0; i < 5; i += 1) {
      approvals.approve(record.id, "u1", "nope", verify, "right")
    }
    expect(approvals.get(record.id, "u1")?.status).toBe("expired")
  })

  test("a new request replaces the pending one", () => {
    const approvals = new ResetApprovals()
    const first = approvals.create("u1", { kind: "reset" })
    const second = approvals.create("u1", {
      kind: "restore",
      backupId: "b1",
    })
    expect(first.status).toBe("expired")
    expect(second.status).toBe("pending")
    expect(approvalSummary(second).backupId).toBe("b1")
  })

  test("deny only works while pending", () => {
    const approvals = new ResetApprovals()
    const record = approvals.create("u1", { kind: "reset" })
    expect(approvals.deny(record.id, "u1").record?.status).toBe("denied")
    expect(approvals.deny(record.id, "u1").error).toBe("request is denied")
  })

  test("ttl constant leaves the user five minutes", () => {
    expect(APPROVAL_TTL_MS).toBe(5 * 60 * 1000)
  })
})
