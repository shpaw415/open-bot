import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, type User } from "@open-bot/db"
import {
  fileImprovement,
  improvementFingerprint,
  NEW_ROW_LIMIT,
  parseImprovementInput,
  stripSecrets,
} from "./improvements"

function user(): User {
  return {
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  }
}

function db() {
  const opened = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
  )
  opened.createUser(user())
  return opened
}

describe("improvement reports", () => {
  test("strips tokens and keys", () => {
    expect(stripSecrets("Authorization: Bearer abc.def")).toBe(
      "Authorization: Bearer [redacted]",
    )
    expect(stripSecrets("key sk-12345678 failed")).toBe("key [redacted] failed")
    expect(stripSecrets("password=hunter2")).toBe("password=[redacted]")
  })

  test("fingerprint ignores title case and spacing", () => {
    expect(improvementFingerprint("bug", "nav", "Ob-nav  failed")).toBe(
      improvementFingerprint("bug", "nav", "ob-nav failed"),
    )
  })

  test("rejects a bad kind", () => {
    const parsed = parseImprovementInput({
      kind: "idea",
      surface: "nav",
      title: "broken",
      detail: "it failed",
    })
    expect(parsed).toEqual({ error: "kind must be bug, friction, or feature" })
  })

  test("bumps an open duplicate and caps new rows", () => {
    const opened = db()
    const first = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "ob-nav failed",
        detail: "short",
        sessionId: null,
      },
      1_000,
    )
    expect(first).toEqual({
      id: expect.any(String),
      duplicate: false,
      hits: 1,
    })
    const again = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "OB-nav   failed",
        detail: "a longer reproduction",
        sessionId: "ses_1",
      },
      2_000,
    )
    expect(again).toMatchObject({ duplicate: true, hits: 2 })
    if (!("id" in again)) throw new Error("expected a row")
    expect(opened.improvementById(again.id)?.detail).toBe(
      "a longer reproduction",
    )
    expect(opened.listImprovements("open")).toHaveLength(1)

    const done = opened.setImprovementStatus(again.id, "done", "fixed")
    expect(done?.status).toBe("done")
    const regression = fileImprovement(
      opened,
      user(),
      {
        kind: "bug",
        surface: "nav",
        title: "ob-nav failed",
        detail: "came back",
        sessionId: null,
      },
      3_000,
    )
    expect(regression).toMatchObject({ duplicate: false, hits: 1 })
    expect(opened.listImprovements("open")).toHaveLength(1)

    for (let i = 0; i < NEW_ROW_LIMIT; i++) {
      fileImprovement(
        opened,
        user(),
        {
          kind: "feature",
          surface: "chat",
          title: `missing ${i}`,
          detail: "needed during work",
          sessionId: null,
        },
        4_000 + i,
      )
    }
    const limited = fileImprovement(
      opened,
      user(),
      {
        kind: "feature",
        surface: "chat",
        title: "one more",
        detail: "needed during work",
        sessionId: null,
      },
      5_000,
    )
    expect(limited).toEqual({
      error: "too many new reports this hour",
      status: 429,
    })
  })

  test("delete user removes their reports", () => {
    const opened = db()
    fileImprovement(
      opened,
      user(),
      {
        kind: "friction",
        surface: "config",
        title: "model picker resets",
        detail: "saving the model clears the field",
        sessionId: null,
      },
      1,
    )
    opened.deleteUser("a")
    expect(opened.listImprovements()).toHaveLength(0)
  })
})
