import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Db, openDatabase, type User } from "@open-bot/db"

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ob-snapshots-"))

const db: Db = openDatabase(join(process.env.DATA_DIR, "bot.sqlite"))

const {
  DEFAULT_MEDIA_CAP_MB,
  MEDIA_CAP_KEY,
  MAX_MEDIA_CAP_MB,
  MEDIA_DIR,
  collectTargets,
  deleteSessionMedia,
  mediaCapMb,
  pruneWorkspaceMedia,
  snapshotOne,
  snapshotUrlFor,
} = await import("./workspace-snapshots")

const admin: User = {
  id: "u1",
  email: "admin@localhost",
  passwordHash: "x",
  role: "admin",
  createdAt: 0,
  mustChangePassword: false,
  disabled: false,
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

function assistantMessage(options: {
  id: string
  completed: number
  text?: string
  fileUrl?: string
}) {
  return {
    info: {
      id: options.id,
      role: "assistant",
      time: { completed: options.completed },
    },
    parts: [
      ...(options.text ? [{ type: "text", text: options.text }] : []),
      ...(options.fileUrl
        ? [{ type: "file", url: options.fileUrl, mime: "image/png" }]
        : []),
    ],
  }
}

test("media cap defaults, parses, and clamps", () => {
  expect(mediaCapMb(db)).toBe(DEFAULT_MEDIA_CAP_MB)
  db.setSetting(MEDIA_CAP_KEY, "512")
  expect(mediaCapMb(db)).toBe(512)
  db.setSetting(MEDIA_CAP_KEY, "-5")
  expect(mediaCapMb(db)).toBe(DEFAULT_MEDIA_CAP_MB)
  db.setSetting(MEDIA_CAP_KEY, String(MAX_MEDIA_CAP_MB * 10))
  expect(mediaCapMb(db)).toBe(MAX_MEDIA_CAP_MB)
  db.setSetting(MEDIA_CAP_KEY, "512")
})

test("collectTargets scans recent assistant media only", () => {
  const now = Date.now()
  expect(
    collectTargets(
      assistantMessage({
        id: "m1",
        completed: now,
        text: "Here it is\n\n![koi](/home/agent/workspace/koi.png)\n",
      }),
      now,
    ),
  ).toEqual([
    { messageId: "m1", path: "/home/agent/workspace/koi.png", kind: "image" },
  ])
  expect(
    collectTargets(
      assistantMessage({
        id: "m2",
        completed: now,
        text: "plain text only",
        fileUrl: "/home/agent/workspace/part.png",
      }),
      now,
    ),
  ).toEqual([
    { messageId: "m2", path: "/home/agent/workspace/part.png", kind: "image" },
  ])
  expect(
    collectTargets(
      assistantMessage({
        id: "m3",
        completed: now - 20 * 60_000,
        text: "![old](/home/agent/workspace/old.png)",
      }),
      now,
    ),
  ).toEqual([])
  expect(
    collectTargets(
      assistantMessage({
        id: "m4",
        completed: now,
        text: "![nope](/etc/passwd) ![txt](/home/agent/workspace/n.txt)",
      }),
      now,
    ),
  ).toEqual([])
  expect(
    collectTargets(
      {
        info: { id: "m5", role: "user", time: { completed: now } },
        parts: [{ type: "text", text: "![x](/home/agent/workspace/x.png)" }],
      },
      now,
    ),
  ).toEqual([])
})

test("snapshotOne stores bytes once and builds a stable URL", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        JSON.stringify({
          type: "binary",
          encoding: "base64",
          content: png.toString("base64"),
        }),
        { headers: { "content-type": "application/json" } },
      ),
  })
  try {
    const base = `http://localhost:${server.port}`
    const target = {
      messageId: "msg-1",
      path: "/home/agent/workspace/koi.png",
      kind: "image" as const,
    }
    await snapshotOne(db, "u1", "s1", base, {}, target)
    await snapshotOne(db, "u1", "s1", base, {}, target)
    const rows = db.workspaceMediaForSession("u1", "s1")
    expect(rows.length).toBe(1)
    expect(rows[0]?.mime).toBe("image/png")
    expect(rows[0]?.bytes).toBe(png.byteLength)
    expect(rows[0]?.path).toBe("/home/agent/workspace/koi.png")
    const id = rows[0]?.id ?? ""
    expect(id).not.toBe("")
    expect(existsSync(join(MEDIA_DIR, id))).toBe(true)
    expect(snapshotUrlFor({ id, path: "/home/agent/workspace/koi.png" })).toBe(
      `/api/workspace/snapshot/${id}/koi.png`,
    )
    expect(db.workspaceMedia(id, "u1")?.id).toBe(id)
    expect(db.workspaceMedia(id, "other")).toBeNull()
  } finally {
    server.stop(true)
  }
})

test("pruneWorkspaceMedia deletes oldest rows over the cap", () => {
  db.setSetting(MEDIA_CAP_KEY, "1")
  deleteSessionMedia(db, "u1", "s1")
  db.createWorkspaceMedia({
    id: "w-old",
    userId: "u1",
    sessionId: "s2",
    messageId: "mo",
    path: "/home/agent/workspace/a.png",
    mime: "image/png",
    bytes: 600_000,
    createdAt: 1,
  })
  db.createWorkspaceMedia({
    id: "w-mid",
    userId: "u1",
    sessionId: "s2",
    messageId: "mm",
    path: "/home/agent/workspace/b.png",
    mime: "image/png",
    bytes: 600_000,
    createdAt: 2,
  })
  db.createWorkspaceMedia({
    id: "w-new",
    userId: "u1",
    sessionId: "s2",
    messageId: "mn",
    path: "/home/agent/workspace/c.png",
    mime: "image/png",
    bytes: 600_000,
    createdAt: 3,
  })
  pruneWorkspaceMedia(db)
  const left = db
    .workspaceMediaForSession("u1", "s2")
    .map((row) => row.id)
    .sort()
  expect(left).toEqual(["w-new"])
  expect(db.workspaceMediaUsedBytes()).toBe(600_000)
})

test("zero cap clears the whole store", () => {
  db.setSetting(MEDIA_CAP_KEY, "0")
  pruneWorkspaceMedia(db)
  expect(db.workspaceMediaUsedBytes()).toBe(0)
  db.setSetting(MEDIA_CAP_KEY, "512")
})

test("deleteSessionMedia removes a thread's snapshots", () => {
  db.createWorkspaceMedia({
    id: "w-s3",
    userId: "u1",
    sessionId: "s3",
    messageId: "m9",
    path: "/home/agent/workspace/d.png",
    mime: "image/png",
    bytes: 10,
    createdAt: Date.now(),
  })
  expect(db.workspaceMediaForSession("u1", "s3").length).toBe(1)
  deleteSessionMedia(db, "u1", "s3")
  expect(db.workspaceMediaForSession("u1", "s3").length).toBe(0)
})

test("admin settings route validates and applies the cap", async () => {
  const { handleAdmin } = await import("./admin")
  const url = "http://x/api/admin/settings"
  const put = async (body: unknown) =>
    handleAdmin(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      new URL(url),
      db,
      admin,
    )
  expect((await put({ mediaSnapshotCapMb: -1 })).status).toBe(400)
  expect((await put({ mediaSnapshotCapMb: 1.5 })).status).toBe(400)
  expect(
    (await put({ mediaSnapshotCapMb: MAX_MEDIA_CAP_MB * 100 })).status,
  ).toBe(400)
  const saved = (await put({ mediaSnapshotCapMb: 2048 })) as Response
  expect(saved.status).toBe(200)
  expect(
    ((await saved.json()) as { mediaSnapshotCapMb: number }).mediaSnapshotCapMb,
  ).toBe(2048)
  const got = (await handleAdmin(
    new Request(url),
    new URL(url),
    db,
    admin,
  )) as Response
  const body = (await got.json()) as {
    mediaSnapshotCapMb: number
    mediaSnapshotUsedBytes: number
  }
  expect(body.mediaSnapshotCapMb).toBe(2048)
  expect(typeof body.mediaSnapshotUsedBytes).toBe("number")
  expect(mediaCapMb(db)).toBe(2048)
  expect(
    (await handleAdmin(new Request(url), new URL(url), db, {
      ...admin,
      role: "user",
    })) as Response,
  ).toMatchObject({ status: 403 })
})
