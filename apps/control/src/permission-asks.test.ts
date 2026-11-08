import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import type { EventHub, HubEvent } from "./events"
import {
  dispatchPermissionAsks,
  isPermissionAsked,
  rejectPermissionAsk,
} from "./permission-asks"

function testDb() {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-perm-")), "bot.sqlite"),
  )
  db.createUser({
    id: "u1",
    email: "u1@localhost",
    passwordHash: "x",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
  db.ensureDesktop({
    userId: "u1",
    llmToken: "t",
    opencodePassword: "secret",
    vikingKey: "v",
    selectedProvider: null,
    selectedModel: null,
    thinkingEffort: null,
    lastActiveAt: 1,
  })
  return db
}

function testHub() {
  const events: HubEvent[] = []
  const hub = {
    emit: (_userId: string, event: HubEvent) => {
      events.push(event)
    },
  } as unknown as EventHub
  return { hub, events }
}

describe("isPermissionAsked", () => {
  test("accepts only permission.asked events with a request id", () => {
    expect(isPermissionAsked({ type: "session.idle" })).toBeNull()
    expect(isPermissionAsked({ type: "permission.asked" })).toBeNull()
    expect(
      isPermissionAsked({ type: "permission.asked", properties: {} }),
    ).toBeNull()
    const asked = isPermissionAsked({
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: ["git push"],
      },
    })
    expect(asked).toMatchObject({ id: "per_1", sessionID: "ses_1" })
  })
})

describe("rejectPermissionAsk", () => {
  test("replies reject with feedback and emits a dashboard notice", async () => {
    const db = testDb()
    const { hub, events } = testHub()
    const calls: { url: string; init: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response("true")
    }) as unknown as typeof fetch
    try {
      const ok = await rejectPermissionAsk(
        db,
        hub,
        "u1",
        {
          id: "per_1",
          sessionID: "ses_1",
          permission: "bash",
          patterns: ["ob-nav --goal x"],
        },
        async () => "http://opencode.test",
      )
      expect(ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toContain("/permission/per_1/reply")
      expect(calls[0]?.init.method).toBe("POST")
      const body = JSON.parse(String(calls[0]?.init.body))
      expect(body.reply).toBe("reject")
      expect(body.message).toContain("headless")
      expect(events.map((event) => event.type)).toEqual(["permission.notice"])
      const props = events[0]?.properties as {
        title?: string
        sessionId?: string
      }
      expect(props.title).toContain("auto-rejected")
      expect(props.sessionId).toBe("ses_1")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("a failed reply still notices, with the unanswered wording", async () => {
    const db = testDb()
    const { hub, events } = testHub()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch
    try {
      const ok = await rejectPermissionAsk(
        db,
        hub,
        "u1",
        { id: "per_2", permission: "webfetch" },
        async () => "http://opencode.test",
      )
      expect(ok).toBe(false)
      const props = events[0]?.properties as { title?: string }
      expect(props.title).toContain("unanswered")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("dispatchPermissionAsks", () => {
  test("ignores other events, rejects asks without throwing", async () => {
    const db = testDb()
    const { hub, events } = testHub()
    let dispatched = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      dispatched++
      throw new Error("network down")
    }) as unknown as typeof fetch
    try {
      expect(
        dispatchPermissionAsks(db, hub, "u1", { type: "session.idle" }),
      ).toBeUndefined()
      dispatchPermissionAsks(
        db,
        hub,
        "u1",
        {
          type: "permission.asked",
          properties: { id: "per_3", permission: "edit" },
        },
        async () => "http://opencode.test",
      )
      // the rejected promise is swallowed; give it a tick
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(dispatched).toBe(1)
      expect(events.map((event) => event.type)).toEqual(["permission.notice"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
