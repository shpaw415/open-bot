import { describe, expect, test } from "bun:test"
import type { Db, User } from "@open-bot/db"
import type { EventHub } from "./events"
import {
  DIR_NAME_MAX,
  findOrCreateThreadDir,
  handleThreadDirs,
  sanitizeDirName,
} from "./thread-dirs"

const user = { id: "user-1", disabled: false } as unknown as User

type DirRow = { id: string; userId: string; name: string; createdAt: number }
type AssignRow = { userId: string; sessionId: string; dirId: string }

function dirDb(seed: DirRow[] = [], assignments: AssignRow[] = []) {
  const events: { userId: string; type: string }[] = []
  const db = {
    threadDirs: (userId: string) =>
      seed
        .filter((row) => row.userId === userId)
        .sort((a, b) => a.createdAt - b.createdAt),
    threadDirById: (id: string, userId: string) =>
      seed.find((row) => row.id === id && row.userId === userId) ?? null,
    threadDirByName: (userId: string, name: string) =>
      seed.find(
        (row) =>
          row.userId === userId &&
          row.name.toLowerCase() === name.toLowerCase(),
      ) ?? null,
    createThreadDir: (row: DirRow) => {
      seed.push(row)
    },
    renameThreadDir: (id: string, userId: string, name: string) => {
      const row = seed.find((item) => item.id === id && item.userId === userId)
      if (!row) return null
      row.name = name
      return row
    },
    deleteThreadDir: (id: string, userId: string) => {
      const index = seed.findIndex(
        (row) => row.id === id && row.userId === userId,
      )
      if (index === -1) return false
      seed.splice(index, 1)
      for (let i = assignments.length - 1; i >= 0; i--) {
        const row = assignments[i]
        if (row && row.userId === userId && row.dirId === id)
          assignments.splice(i, 1)
      }
      return true
    },
    setThreadDir: (userId: string, sessionId: string, dirId: string | null) => {
      const index = assignments.findIndex(
        (row) => row.userId === userId && row.sessionId === sessionId,
      )
      if (dirId === null) {
        if (index !== -1) assignments.splice(index, 1)
        return
      }
      if (index !== -1) assignments[index].dirId = dirId
      else assignments.push({ userId, sessionId, dirId })
    },
    threadDirAssignments: (userId: string) =>
      assignments.filter((row) => row.userId === userId),
  } as unknown as Db
  const hub = {
    emit: (userId: string, event: { type: string }) => {
      events.push({ userId, type: event.type })
    },
  } as unknown as EventHub
  return { db, hub, events, seed, assignments }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  database: ReturnType<typeof dirDb> = dirDb(),
) {
  const handled = await handleThreadDirs(
    new Request(`http://control${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    new URL(`http://control${path}`),
    database.db,
    user,
    database.hub,
  )
  if (!handled) throw new Error(`route not handled: ${method} ${path}`)
  return { call: handled, database }
}

describe("sanitizeDirName", () => {
  test("trims, collapses whitespace, strips control characters, and caps length", () => {
    expect(sanitizeDirName("  Billing  \n")).toBe("Billing")
    expect(sanitizeDirName("a\u0000b\tc")).toBe("a b c")
    expect(sanitizeDirName("x".repeat(100))).toHaveLength(DIR_NAME_MAX)
    expect(sanitizeDirName(undefined)).toBe("")
    expect(sanitizeDirName(null)).toBe("")
    expect(sanitizeDirName(42)).toBeNull()
  })
})

describe("findOrCreateThreadDir", () => {
  test("reuses an existing folder case-insensitively and creates missing ones", () => {
    const database = dirDb([
      { id: "d1", userId: "user-1", name: "Billing", createdAt: 1 },
    ])
    expect(findOrCreateThreadDir(database.db, "user-1", "billing")).toEqual({
      id: "d1",
      name: "Billing",
      createdAt: 1,
    })
    expect(database.seed).toHaveLength(1)
    const created = findOrCreateThreadDir(database.db, "user-1", "Work")
    expect(created.name).toBe("Work")
    expect(database.seed).toHaveLength(2)
  })
})

describe("handleThreadDirs", () => {
  test("lists folders and assignments", async () => {
    const database = dirDb(
      [{ id: "d1", userId: "user-1", name: "Billing", createdAt: 1 }],
      [{ userId: "user-1", sessionId: "s1", dirId: "d1" }],
    )
    const dirs = await request("GET", "/api/thread-dirs", undefined, database)
    expect((await dirs.call).status).toBe(200)
    const dirsBody = (await (await dirs.call).json()) as {
      dirs: { id: string; name: string; createdAt: number }[]
    }
    expect(dirsBody.dirs).toEqual([{ id: "d1", name: "Billing", createdAt: 1 }])
    const assigns = await request(
      "GET",
      "/api/thread-dirs/assignments",
      undefined,
      database,
    )
    const assignsBody = (await (await assigns.call).json()) as {
      threads: unknown
    }
    expect(assignsBody.threads).toEqual([{ sessionId: "s1", dirId: "d1" }])
  })

  test("creates, renames, and deletes folders with events", async () => {
    const database = dirDb()
    const created = await request(
      "POST",
      "/api/thread-dirs",
      { name: " Work " },
      database,
    )
    const createdRes = await created.call
    expect(createdRes.status).toBe(201)
    const dir = (await createdRes.json()) as { id: string; name: string }
    expect(dir.name).toBe("Work")
    expect(database.events).toEqual([
      { userId: "user-1", type: "threads.changed" },
    ])

    const dup = await request(
      "POST",
      "/api/thread-dirs",
      { name: "work" },
      database,
    )
    expect((await dup.call).status).toBe(409)

    const renamed = await request(
      "PUT",
      `/api/thread-dirs/${dir.id}`,
      { name: "Invoices" },
      database,
    )
    const renamedRes = await renamed.call
    expect(renamedRes.status).toBe(200)
    expect(((await renamedRes.json()) as { name: string }).name).toBe(
      "Invoices",
    )

    const removed = await request(
      "DELETE",
      `/api/thread-dirs/${dir.id}`,
      undefined,
      database,
    )
    expect((await removed.call).status).toBe(200)
    expect(database.seed).toHaveLength(0)
    expect(database.events).toHaveLength(3)

    const missing = await request(
      "DELETE",
      "/api/thread-dirs/nope",
      undefined,
      database,
    )
    expect((await missing.call).status).toBe(404)
  })

  test("validates create input", async () => {
    const database = dirDb()
    expect(
      (await request("POST", "/api/thread-dirs", null, database)).call.status,
    ).toBe(400)
    expect(
      (await request("POST", "/api/thread-dirs", { name: 42 }, database)).call
        .status,
    ).toBe(400)
    expect(
      (await request("POST", "/api/thread-dirs", { name: "   " }, database))
        .call.status,
    ).toBe(400)
    expect(
      (await request("POST", "/api/thread-dirs", {}, database)).call.status,
    ).toBe(400)
    expect(database.seed).toHaveLength(0)
    expect(database.events).toHaveLength(0)
  })

  test("assigns and unfiles threads, validating the folder", async () => {
    const database = dirDb([
      { id: "d1", userId: "user-1", name: "Work", createdAt: 1 },
    ])
    const assign = await request(
      "PUT",
      "/api/thread-dirs/assign",
      { sessionId: " s1 ", dirId: "d1" },
      database,
    )
    expect((await assign.call).status).toBe(200)
    expect(database.assignments).toEqual([
      { userId: "user-1", sessionId: "s1", dirId: "d1" },
    ])
    // move to another folder reuses the same assignment row
    database.seed.push({
      id: "d2",
      userId: "user-1",
      name: "Play",
      createdAt: 2,
    })
    await request(
      "PUT",
      "/api/thread-dirs/assign",
      { sessionId: "s1", dirId: "d2" },
      database,
    )
    expect(database.assignments).toEqual([
      { userId: "user-1", sessionId: "s1", dirId: "d2" },
    ])
    const unfile = await request(
      "PUT",
      "/api/thread-dirs/assign",
      { sessionId: "s1", dirId: null },
      database,
    )
    expect((await unfile.call).status).toBe(200)
    expect(database.assignments).toHaveLength(0)
    const unknownDir = await request(
      "PUT",
      "/api/thread-dirs/assign",
      { sessionId: "s1", dirId: "nope" },
      database,
    )
    expect((await unknownDir.call).status).toBe(400)
    const missingSession = await request(
      "PUT",
      "/api/thread-dirs/assign",
      { dirId: "d1" },
      database,
    )
    expect((await missingSession.call).status).toBe(400)
    expect(database.events).toHaveLength(3)
  })

  test("unknown routes return null", () => {
    expect(
      handleThreadDirs(
        new Request("http://control/api/thread-dirs", { method: "PATCH" }),
        new URL("http://control/api/thread-dirs"),
        dirDb().db,
        user,
        dirDb().hub,
      ),
    ).toBeNull()
    expect(
      handleThreadDirs(
        new Request("http://control/api/other"),
        new URL("http://control/api/other"),
        dirDb().db,
        user,
        dirDb().hub,
      ),
    ).toBeNull()
  })
})
