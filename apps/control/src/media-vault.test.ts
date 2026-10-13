import { expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Db, openDatabase, type User } from "@open-bot/db"

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ob-vault-"))

const agentHome = mkdtempSync(join(tmpdir(), "ob-agent-home-"))
let desktopUp = true

mock.module("./docker", () => ({
  endpoint: async () => "http://opencode:4096",
  desktopPhase: async () => (desktopUp ? "running" : "sleeping"),
  opencodeExec: async (_userId: string, args: string[]) => {
    const toLocal = (arg: string) => {
      if (arg === "/home/agent") return agentHome
      if (arg.startsWith("/home/agent/"))
        return join(agentHome, arg.slice("/home/agent/".length))
      return arg
    }
    const proc = Bun.spawn(args.map(toLocal), {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout: stdout.split(agentHome).join("/home/agent"), stderr }
  },
}))

const db: Db = openDatabase(join(process.env.DATA_DIR, "bot.sqlite"))

const {
  VAULT_CAP_KEY,
  VAULT_DIR,
  classifyVaultPayload,
  createNamedAlbum,
  ensureThreadAlbum,
  fileCapturedBytes,
  handleMedia,
  isMediaRequest,
  pruneMediaVault,
  storeVaultBytes,
  vaultCaptureFor,
  vaultSourcePath,
} = await import("./media-vault")
const { deleteSessionMedia } = await import("./workspace-snapshots")

const user: User = {
  id: "u1",
  email: "a@localhost",
  passwordHash: "x",
  role: "user",
  createdAt: 0,
  mustChangePassword: false,
  disabled: false,
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

function binary(bytes: Buffer) {
  return {
    type: "binary",
    encoding: "base64",
    content: bytes.toString("base64"),
  }
}

test("vault paths stay under home and reject secrets", () => {
  expect(vaultSourcePath("/home/agent/workspace/logo.png")).toBe(
    "/home/agent/workspace/logo.png",
  )
  expect(vaultSourcePath("/home/agent/workspace/../etc/passwd")).toBeNull()
  expect(vaultSourcePath("/tmp/logo.png")).toBeNull()
  expect(vaultSourcePath("/home/agent/.ssh/id_rsa")).toBeNull()
  expect(vaultSourcePath("/home/agent/.config/open-bot/image.json")).toBeNull()
  expect(vaultSourcePath("/home/agent/.config/cf-ai/auth.json")).toBeNull()
  expect(vaultSourcePath("/home/agent/workspace/image-auth.json")).toBeNull()
})

test("classify accepts pictures and other files, rejects a fake png", () => {
  expect(
    classifyVaultPayload("/home/agent/workspace/koi.png", binary(png))?.kind,
  ).toBe("image")
  expect(
    classifyVaultPayload(
      "/home/agent/workspace/koi.png",
      binary(Buffer.from("not a png")),
    ),
  ).toBeNull()
  const pdf = classifyVaultPayload(
    "/home/agent/workspace/note.pdf",
    binary(Buffer.from("%PDF-1.4")),
  )
  expect(pdf?.kind).toBe("file")
  expect(pdf?.mime).toBe("application/pdf")
  expect(
    classifyVaultPayload("/home/agent/workspace/note.txt", {
      type: "text",
      content: "hello",
    })?.kind,
  ).toBe("file")
  expect(
    classifyVaultPayload("/home/agent/workspace/secret.env", binary(png))?.kind,
  ).toBe("image")
  expect(
    classifyVaultPayload(
      "/home/agent/workspace/secret.env",
      binary(Buffer.from("TOKEN=1")),
    ),
  ).toBeNull()
})

test("hidden sessions are not filed and thread albums keep their name", () => {
  expect(vaultCaptureFor("Chat", "worker:helper")).toBeNull()
  expect(vaultCaptureFor("cron-run:nightly", "Nightly")).toBeNull()
  expect(vaultCaptureFor("Cabin", "New session - 1")).toEqual({
    albumTitle: "Cabin",
  })
  expect(vaultCaptureFor("", "New session")).toEqual({ albumTitle: "Chat" })
  const first = ensureThreadAlbum(db, "u1", "s1", "Cabin")
  const again = ensureThreadAlbum(db, "u1", "s1", "Renamed")
  expect(again.id).toBe(first.id)
  expect(again.name).toBe("Cabin")
  const clash = ensureThreadAlbum(db, "u1", "s2", "Cabin")
  expect(clash.name).toBe("Cabin 2")
  expect(clash.id).not.toBe(first.id)
  const logos = createNamedAlbum(db, "u1", "Logos")
  const marks = createNamedAlbum(db, "u1", "Marks")
  expect("album" in logos && logos.created).toBe(true)
  expect("album" in marks && marks.created).toBe(true)
  const reused = createNamedAlbum(db, "u1", "Logos")
  expect("created" in reused && reused.created).toBe(false)
})

test("the same bytes in an album are skipped and thread delete keeps the copy", () => {
  const album = ensureThreadAlbum(db, "u1", "s3", "Shots")
  const first = storeVaultBytes(db, {
    userId: "u1",
    albumId: album.id,
    kind: "image",
    name: "koi.png",
    title: "koi",
    mime: "image/png",
    sourcePath: "/home/agent/workspace/koi.png",
    sessionId: "s3",
    messageId: "m1",
    bytes: png,
  })
  expect("skipped" in first && first.skipped).toBe(false)
  const second = storeVaultBytes(db, {
    userId: "u1",
    albumId: album.id,
    kind: "image",
    name: "koi.png",
    title: "koi",
    mime: "image/png",
    sourcePath: "/home/agent/workspace/koi-v2.png",
    sessionId: "s3",
    messageId: "m2",
    bytes: png,
  })
  expect("skipped" in second && second.skipped).toBe(true)
  if (!("item" in first) || !("item" in second)) throw new Error("missing item")
  expect(second.item.id).toBe(first.item.id)
  expect(existsSync(join(VAULT_DIR, first.item.id))).toBe(true)
  deleteSessionMedia(db, "u1", "s3")
  expect(db.mediaItem(first.item.id, "u1")?.id).toBe(first.item.id)
  const filed = fileCapturedBytes(db, {
    userId: "u1",
    sessionId: "s3",
    messageId: "m1",
    path: "/home/agent/workspace/koi.png",
    bytes: png,
    mime: "image/png",
    kind: "image",
    albumTitle: "Shots",
  })
  expect(filed).toBe(false)
})

test("serve is immutable and other files download", async () => {
  expect(isMediaRequest("/api/media/items/abc/note.pdf", "GET")).toBe(true)
  expect(isMediaRequest("/api/media/items", "POST")).toBe(true)
  expect(isMediaRequest("/api/media/albums", "DELETE")).toBe(false)
  const album = ensureThreadAlbum(db, "u1", "s4", "Docs")
  const stored = storeVaultBytes(db, {
    userId: "u1",
    albumId: album.id,
    kind: "file",
    name: "note.pdf",
    title: "note",
    mime: "application/pdf",
    sourcePath: "/home/agent/workspace/note.pdf",
    sessionId: null,
    messageId: null,
    bytes: Buffer.from("%PDF-1.4"),
  })
  if (!("item" in stored)) throw new Error("store failed")
  const res = await handleMedia(
    new Request("http://local/api/media/items/x/note.pdf"),
    new URL(`http://local/api/media/items/${stored.item.id}/note.pdf`),
    db,
    user,
    { emit() {} },
  )
  expect(res?.status).toBe(200)
  expect(res?.headers.get("cache-control")).toBe(
    "private, max-age=31536000, immutable",
  )
  expect(res?.headers.get("x-content-type-options")).toBe("nosniff")
  expect(res?.headers.get("content-disposition")).toContain("attachment")
  db.setSetting(VAULT_CAP_KEY, "0")
  const blocked = storeVaultBytes(db, {
    userId: "u1",
    albumId: album.id,
    kind: "file",
    name: "other.pdf",
    title: "other",
    mime: "application/pdf",
    sourcePath: "/home/agent/workspace/other.pdf",
    sessionId: null,
    messageId: null,
    bytes: Buffer.from("%PDF-other"),
  })
  expect("error" in blocked && blocked.error).toBe("media vault is off")
  pruneMediaVault(db)
  expect(db.mediaVaultUsedBytes()).toBe(0)
  db.setSetting(VAULT_CAP_KEY, "3072")
})

async function deleteViaApi(path: string) {
  const url = new URL(`http://local${path}`)
  return handleMedia(
    new Request(`http://local${path}`, { method: "DELETE" }),
    url,
    db,
    user,
    { emit() {} },
  )
}

function storeFixture(
  albumId: string,
  opts: {
    messageId: string
    sourcePath: string
    bytes?: Buffer
  },
) {
  const stored = storeVaultBytes(db, {
    userId: "u1",
    albumId,
    kind: "image",
    name: opts.sourcePath.slice(opts.sourcePath.lastIndexOf("/") + 1),
    title: "fixture",
    mime: "image/png",
    sourcePath: opts.sourcePath,
    sessionId: null,
    messageId: opts.messageId,
    bytes: opts.bytes ?? png,
  })
  if (!("item" in stored)) throw new Error("store failed")
  return stored.item
}

function desktopFile(rel: string) {
  const path = join(agentHome, rel)
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, "desktop bytes")
  return path
}

test("item delete with source=1 also deletes the desktop file", async () => {
  desktopUp = true
  const file = desktopFile("workspace/shot.png")
  const album = ensureThreadAlbum(db, "u1", "s-src-item", "SrcItem")
  const item = storeFixture(album.id, {
    messageId: "m-src-item",
    sourcePath: "/home/agent/workspace/shot.png",
  })
  const res = await deleteViaApi(`/api/media/items/${item.id}?source=1`)
  expect(res?.status).toBe(200)
  const body = (await res?.json()) as {
    sourceDeleted: number
    warnings: string[]
  }
  expect(body.sourceDeleted).toBe(1)
  expect(body.warnings).toEqual([])
  expect(existsSync(file)).toBe(false)
  expect(existsSync(join(VAULT_DIR, item.id))).toBe(false)
})

test("item delete without source keeps the desktop file", async () => {
  desktopUp = true
  const file = desktopFile("workspace/kept.png")
  const album = ensureThreadAlbum(db, "u1", "s-src-keep", "SrcKeep")
  const item = storeFixture(album.id, {
    messageId: "m-src-keep",
    sourcePath: "/home/agent/workspace/kept.png",
  })
  const res = await deleteViaApi(`/api/media/items/${item.id}`)
  expect(res?.status).toBe(200)
  const body = (await res?.json()) as {
    sourceDeleted: number
    warnings: string[]
  }
  expect(body.sourceDeleted).toBe(0)
  expect(body.warnings).toEqual([])
  expect(existsSync(file)).toBe(true)
  expect(existsSync(join(VAULT_DIR, item.id))).toBe(false)
})

test("source deletion refuses protected desktop paths", async () => {
  desktopUp = true
  const file = desktopFile(".ssh/id_ed25519")
  const album = ensureThreadAlbum(db, "u1", "s-src-ssh", "SrcSsh")
  const item = storeFixture(album.id, {
    messageId: "m-src-ssh",
    sourcePath: "/home/agent/.ssh/id_ed25519",
  })
  const res = await deleteViaApi(`/api/media/items/${item.id}?source=1`)
  expect(res?.status).toBe(200)
  const body = (await res?.json()) as {
    sourceDeleted: number
    warnings: string[]
  }
  expect(body.sourceDeleted).toBe(0)
  expect(body.warnings.join(" ")).toContain("protected")
  expect(existsSync(file)).toBe(true)
  expect(existsSync(join(VAULT_DIR, item.id))).toBe(false)
})

test("source deletion warns and keeps files when the desktop is stopped", async () => {
  desktopUp = false
  try {
    const file = desktopFile("workspace/stopped.png")
    const album = ensureThreadAlbum(db, "u1", "s-src-down", "SrcDown")
    const item = storeFixture(album.id, {
      messageId: "m-src-down",
      sourcePath: "/home/agent/workspace/stopped.png",
    })
    const res = await deleteViaApi(`/api/media/items/${item.id}?source=1`)
    expect(res?.status).toBe(200)
    const body = (await res?.json()) as {
      sourceDeleted: number
      warnings: string[]
    }
    expect(body.sourceDeleted).toBe(0)
    expect(body.warnings.join(" ")).toContain("not running")
    expect(existsSync(file)).toBe(true)
  } finally {
    desktopUp = true
  }
})

test("album delete with source=1 cascades desktop files once each", async () => {
  desktopUp = true
  const first = desktopFile("workspace/album-a.png")
  const second = desktopFile("workspace/album-b.png")
  const album = ensureThreadAlbum(db, "u1", "s-src-album", "SrcAlbum")
  storeFixture(album.id, {
    messageId: "m-src-album-a",
    sourcePath: "/home/agent/workspace/album-a.png",
    bytes: Buffer.from("album-a"),
  })
  storeFixture(album.id, {
    messageId: "m-src-album-b",
    sourcePath: "/home/agent/workspace/album-b.png",
    bytes: Buffer.from("album-b"),
  })
  const res = await deleteViaApi(`/api/media/albums/${album.id}?source=1`)
  expect(res?.status).toBe(200)
  const body = (await res?.json()) as {
    sourceDeleted: number
    warnings: string[]
  }
  expect(body.sourceDeleted).toBe(2)
  expect(body.warnings).toEqual([])
  expect(existsSync(first)).toBe(false)
  expect(existsSync(second)).toBe(false)
  expect(db.mediaAlbum(album.id, "u1")).toBeNull()
})
