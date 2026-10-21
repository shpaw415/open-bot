import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  CATALOG_ASSIGN_MAX,
  CATALOG_DIR_MAX,
  catalogKind,
  handleCatalogDirs,
  parseNameBatch,
} from "./catalog-dirs"
import type { EventHub } from "./events"

function open() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function seedUser(db: ReturnType<typeof openDatabase>, id = "u") {
  db.createUser({
    id,
    email: `${id}@localhost`,
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
}

function userOf(db: ReturnType<typeof openDatabase>, id = "u") {
  const user = db.userById(id)
  if (!user) throw new Error(`missing user ${id}`)
  return user
}

const hubEvents: { userId: string; type: string }[] = []
const hub = {
  emit(userId: string, event: { type: string }) {
    hubEvents.push({ userId, type: event.type })
  },
} as unknown as EventHub

function req(
  url: string,
  method: string,
  body?: unknown,
): { req: Request; url: URL } {
  return {
    req: new Request(`http://control${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url: new URL(`http://control${url}`),
  }
}

describe("catalogKind", () => {
  test("accepts only skill and mcp", () => {
    expect(catalogKind("skill")).toBe("skill")
    expect(catalogKind("mcp")).toBe("mcp")
    expect(catalogKind("threads")).toBeNull()
    expect(catalogKind(null)).toBeNull()
  })
})

describe("parseNameBatch", () => {
  test("validates names per kind and dedupes", () => {
    const skills = parseNameBatch(["research", " media ", "research"], "skill")
    expect("names" in skills && skills.names).toEqual(["research", "media"])
    const mcps = parseNameBatch(["stock.tickers"], "mcp")
    expect("names" in mcps && mcps.names).toEqual(["stock.tickers"])
  })

  test("rejects glob characters and wrong-kind names", () => {
    expect("error" in parseNameBatch(["a*"], "skill")).toBe(true)
    expect("error" in parseNameBatch(["A_UPPER"], "skill")).toBe(true)
    // MCP names allow dots and capitals; skill slugs do not.
    expect("names" in parseNameBatch(["Stock.X"], "mcp")).toBe(true)
    expect("error" in parseNameBatch(["Stock.X"], "skill")).toBe(true)
    expect("error" in parseNameBatch([42], "skill")).toBe(true)
    expect(
      "error" in
        parseNameBatch(Array(CATALOG_ASSIGN_MAX + 1).fill("a"), "skill"),
    ).toBe(true)
  })
})

describe("handleCatalogDirs", () => {
  test("create, list, rename, delete emit catalog.changed", async () => {
    const db = open()
    seedUser(db)
    const made = await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "Research" })
        .req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "Research" })
        .url,
      db,
      userOf(db),
      hub,
    )
    expect(made?.status).toBe(201)
    const view = (await (made as Response).json()) as {
      id: string
      label: string
      position: number
    }
    expect(view.label).toBe("Research")
    expect(view.position).toBe(0)

    // Case-insensitive duplicate label is refused.
    const dup = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "research" })
        .req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "research" })
        .url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(dup.status).toBe(409)

    // Same label in the other kind is a separate namespace.
    const otherKind = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Research" }).req,
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Research" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(otherKind.status).toBe(201)

    const renamed = (await handleCatalogDirs(
      req(`/api/catalog/dirs/${view.id}`, "PUT", { label: "Deep research" })
        .req,
      req(`/api/catalog/dirs/${view.id}`, "PUT", { label: "Deep research" })
        .url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as { label: string }).label).toBe(
      "Deep research",
    )

    const listed = (await handleCatalogDirs(
      req("/api/catalog/dirs?kind=skill", "GET").req,
      req("/api/catalog/dirs?kind=skill", "GET").url,
      db,
      userOf(db),
      hub,
    )) as Response
    const list = (await listed.json()) as {
      dirs: { id: string }[]
      items: unknown[]
    }
    expect(list.dirs).toHaveLength(1)
    expect(list.items).toEqual([])

    const removed = (await handleCatalogDirs(
      req(`/api/catalog/dirs/${view.id}`, "DELETE").req,
      req(`/api/catalog/dirs/${view.id}`, "DELETE").url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(removed.status).toBe(200)
    expect(hubEvents.filter((e) => e.type === "catalog.changed").length).toBe(4)
  })

  test("bad labels and kinds are rejected", async () => {
    const db = open()
    seedUser(db)
    const bad = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "" }).req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(bad.status).toBe(400)
    const badKind = (await handleCatalogDirs(
      req("/api/catalog/dirs?kind=threads", "GET").req,
      req("/api/catalog/dirs?kind=threads", "GET").url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(badKind.status).toBe(400)
  })

  test("the per-kind directory cap is enforced", async () => {
    const db = open()
    seedUser(db)
    for (let i = 0; i < CATALOG_DIR_MAX; i++) {
      const made = (await handleCatalogDirs(
        req("/api/catalog/dirs", "POST", {
          kind: "skill",
          label: `group-${i}`,
        }).req,
        req("/api/catalog/dirs", "POST", {
          kind: "skill",
          label: `group-${i}`,
        }).url,
        db,
        userOf(db),
        hub,
      )) as Response
      expect(made.status).toBe(201)
    }
    const over = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "one more" })
        .req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "one more" })
        .url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(over.status).toBe(409)
  })

  test("assign validates the directory kind and unassign clears", async () => {
    const db = open()
    seedUser(db)
    const skillDir = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "Writing" }).req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "Writing" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    const { id } = (await skillDir.json()) as { id: string }

    // An mcp-kind directory never takes skill-kind names: an mcp name in the
    // skill kind fails the slug pattern first.
    const wrongName = (await handleCatalogDirs(
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["Stock.X"],
        dirId: id,
      }).req,
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["Stock.X"],
        dirId: id,
      }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(wrongName.status).toBe(400)

    const assigned = (await handleCatalogDirs(
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research", "media"],
        dirId: id,
      }).req,
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research", "media"],
        dirId: id,
      }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(assigned.status).toBe(200)
    let list = (await (
      (await handleCatalogDirs(
        req("/api/catalog/dirs?kind=skill", "GET").req,
        req("/api/catalog/dirs?kind=skill", "GET").url,
        db,
        userOf(db),
        hub,
      )) as Response
    ).json()) as { items: { name: string; dirId: string }[] }
    expect(list.items).toHaveLength(2)

    // An assignment to an mcp-kind directory id is refused for skill items.
    const mcpDir = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Sources" }).req,
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Sources" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    const mcpDirId = (await mcpDir.json()) as { id: string }
    const crossKind = (await handleCatalogDirs(
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research"],
        dirId: mcpDirId.id,
      }).req,
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research"],
        dirId: mcpDirId.id,
      }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    expect(crossKind.status).toBe(400)

    // dirId null moves back to Ungrouped (row removed).
    await handleCatalogDirs(
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research"],
        dirId: null,
      }).req,
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "skill",
        names: ["research"],
        dirId: null,
      }).url,
      db,
      userOf(db),
      hub,
    )
    list = (await (
      (await handleCatalogDirs(
        req("/api/catalog/dirs?kind=skill", "GET").req,
        req("/api/catalog/dirs?kind=skill", "GET").url,
        db,
        userOf(db),
        hub,
      )) as Response
    ).json()) as { items: { name: string; dirId: string }[] }
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.name).toBe("media")
  })

  test("deleting a directory drops its membership rows", async () => {
    const db = open()
    seedUser(db)
    const made = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Browsers" }).req,
      req("/api/catalog/dirs", "POST", { kind: "mcp", label: "Browsers" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    const { id } = (await made.json()) as { id: string }
    await handleCatalogDirs(
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "mcp",
        names: ["playwright", "chrome-devtools"],
        dirId: id,
      }).req,
      req("/api/catalog/dirs/assign", "PUT", {
        kind: "mcp",
        names: ["playwright", "chrome-devtools"],
        dirId: id,
      }).url,
      db,
      userOf(db),
      hub,
    )
    await handleCatalogDirs(
      req(`/api/catalog/dirs/${id}`, "DELETE").req,
      req(`/api/catalog/dirs/${id}`, "DELETE").url,
      db,
      userOf(db),
      hub,
    )
    const list = (await (
      (await handleCatalogDirs(
        req("/api/catalog/dirs?kind=mcp", "GET").req,
        req("/api/catalog/dirs?kind=mcp", "GET").url,
        db,
        userOf(db),
        hub,
      )) as Response
    ).json()) as { dirs: unknown[]; items: unknown[] }
    expect(list.dirs).toHaveLength(0)
    expect(list.items).toHaveLength(0)
  })

  test("reorder applies the known ids in order and ignores unknown ones", async () => {
    const db = open()
    seedUser(db)
    const ids: string[] = []
    for (const label of ["one", "two", "three"]) {
      const made = (await handleCatalogDirs(
        req("/api/catalog/dirs", "POST", { kind: "skill", label }).req,
        req("/api/catalog/dirs", "POST", { kind: "skill", label }).url,
        db,
        userOf(db),
        hub,
      )) as Response
      ids.push(((await made.json()) as { id: string }).id)
    }
    await handleCatalogDirs(
      req("/api/catalog/dirs/reorder", "PUT", {
        kind: "skill",
        ids: ["nope", ids[2]!, ids[0]!, ids[1]!],
      }).req,
      req("/api/catalog/dirs/reorder", "PUT", {
        kind: "skill",
        ids: ["nope", ids[2]!, ids[0]!, ids[1]!],
      }).url,
      db,
      userOf(db),
      hub,
    )
    const list = (await (
      (await handleCatalogDirs(
        req("/api/catalog/dirs?kind=skill", "GET").req,
        req("/api/catalog/dirs?kind=skill", "GET").url,
        db,
        userOf(db),
        hub,
      )) as Response
    ).json()) as { dirs: { id: string; label: string }[] }
    expect(list.dirs.map((dir) => dir.label)).toEqual(["three", "one", "two"])
  })

  test("another user's directories are invisible", async () => {
    const db = open()
    seedUser(db)
    seedUser(db, "v")
    const made = (await handleCatalogDirs(
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "mine" }).req,
      req("/api/catalog/dirs", "POST", { kind: "skill", label: "mine" }).url,
      db,
      userOf(db),
      hub,
    )) as Response
    const { id } = (await made.json()) as { id: string }
    const foreign = await handleCatalogDirs(
      req(`/api/catalog/dirs/${id}`, "DELETE").req,
      req(`/api/catalog/dirs/${id}`, "DELETE").url,
      db,
      userOf(db, "v"),
      hub,
    )
    expect(foreign?.status).toBe(404)
    const stillThere = db.catalogDirById(id, "u")
    expect(stillThere?.label).toBe("mine")
  })
})
