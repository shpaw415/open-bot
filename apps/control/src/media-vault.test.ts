import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Db, openDatabase, type User } from "@open-bot/db"

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ob-vault-"))

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
