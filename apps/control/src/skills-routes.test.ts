import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import { HttpError } from "./http-error"
import type { EventHub } from "./events"
import { handleSkills, type VikingSkills } from "./skills-routes"
import type { SkillDetail } from "./viking-skills"

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

// In-memory stand-in for the desktop OpenViking client.
function fakeClient() {
  const store = new Map<string, SkillDetail>()
  const client: VikingSkills = {
    async list() {
      return [...store.values()].map(({ name, description }) => ({
        name,
        description,
      }))
    },
    async get(name: string) {
      const hit = store.get(name)
      if (!hit) throw new HttpError(404, "skill not found", "not_found")
      return { ...hit }
    },
    async save(input: SkillDetail, previousName = "") {
      if (previousName && previousName !== input.name) {
        store.delete(previousName)
      } else {
        store.delete(input.name)
      }
      store.set(input.name, { ...input })
      return undefined
    },
    async remove(name: string) {
      store.delete(name)
      return undefined
    },
  } as unknown as VikingSkills
  return { client, store }
}

function req(url: string, method: string, body?: unknown): Request {
  return new Request(`http://control${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("handleSkills", () => {
  test(
    "save stores the skill and emits catalog.changed; get reads it back",
    async () => {
      const db = open()
      seedUser(db)
      const user = userOf(db)
      const fake = fakeClient()
      const call = (url: string, method: string, body?: unknown) =>
        handleSkills(
          req(url, method, body),
          new URL(`http://control${url}`),
          db,
          user,
          hub,
          async () => fake.client,
        )

      const saved = await call("/api/skills", "PUT", {
        name: "logo-cutout",
        description: "Cut a logo out",
        body: "# Logo cutout\n\nsteps",
      })
      expect(saved.status).toBe(200)
      expect(hubEvents.at(-1)).toEqual({
        userId: "u",
        type: "catalog.changed",
      })

      const detail = await call("/api/skills?name=logo-cutout", "GET")
      expect(await detail.json()).toEqual({
        name: "logo-cutout",
        description: "Cut a logo out",
        body: "# Logo cutout\n\nsteps",
      })

      const list = await call("/api/skills", "GET")
      const listed = (await list.json()).skills as {
        name: string
        seed: boolean
        group: string | null
      }[]
      const hit = listed.find((skill) => skill.name === "logo-cutout")
      expect(hit?.seed).toBe(false)
      expect(hit?.group).toBeNull()
    },
  )

  test(
    "rename carries directory membership; delete drops it",
    async () => {
      const db = open()
      seedUser(db)
      const user = userOf(db)
      const fake = fakeClient()
      fake.store.set("old-name", {
        name: "old-name",
        description: "d",
        body: "b",
      })
      db.createCatalogDir({
        id: "dir_1",
        userId: "u",
        kind: "skill",
        label: "Research",
        position: 0,
        createdAt: 1,
      })
      db.setCatalogDirItem("u", "skill", "old-name", "dir_1")
      const call = (url: string, method: string, body?: unknown) =>
        handleSkills(
          req(url, method, body),
          new URL(`http://control${url}`),
          db,
          user,
          hub,
          async () => fake.client,
        )

      const renamed = await call("/api/skills", "PUT", {
        name: "new-name",
        description: "d",
        body: "b",
        previousName: "old-name",
      })
      expect(renamed.status).toBe(200)
      expect(fake.store.has("old-name")).toBe(false)
      expect(fake.store.has("new-name")).toBe(true)
      expect(
        db.catalogDirItems("u", "skill").find((row) => row.name === "new-name")
          ?.dirId,
      ).toBe("dir_1")
      expect(db.catalogDirItems("u", "skill").length).toBe(1)

      await call("/api/skills", "DELETE", { name: "new-name" })
      expect(db.catalogDirItems("u", "skill").length).toBe(0)
      expect(hubEvents.at(-1)).toEqual({
        userId: "u",
        type: "catalog.changed",
      })
    },
  )

  test(
    "invalid names and bodies are rejected without touching OpenViking",
    async () => {
      const db = open()
      seedUser(db)
      const user = userOf(db)
      const fake = fakeClient()

      const reserved = await handleSkills(
        req("/api/skills", "PUT", {
          name: "cron",
          description: "d",
          body: "b",
        }),
        new URL("http://control/api/skills"),
        db,
        user,
        hub,
        async () => fake.client,
      )
      expect(reserved.status).toBe(400)

      const missingDescription = await handleSkills(
        req("/api/skills", "PUT", {
          name: "okay-name",
          description: "",
          body: "b",
        }),
        new URL("http://control/api/skills"),
        db,
        user,
        hub,
        async () => {
          throw new Error("must not be called")
        },
      )
      expect(missingDescription.status).toBe(400)
      expect(fake.store.size).toBe(0)
    },
  )
})
