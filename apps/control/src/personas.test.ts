import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emptyAppliedLog, openDatabase } from "@open-bot/db"
import {
  ASSISTANT_ID,
  findPersona,
  listPersonas,
  mergeSystem,
  nameSimilarity,
  parsePersonaInput,
  personaSystem,
  resolvePersona,
} from "./personas"

function open() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function addCustom(
  db: ReturnType<typeof openDatabase>,
  id: string,
  name: string,
) {
  db.createPersona({
    id,
    userId: "u",
    name,
    instruction: "run the team",
    createdAt: Date.now(),
  })
}

describe("findPersona", () => {
  test("matches a name case-insensitively and an id exactly", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    expect(findPersona(db, "u", "software MANAGER")).toEqual({
      persona: expect.objectContaining({ id: "p1" }),
      matched: "exact",
    })
    expect(findPersona(db, "u", "assistant")).toEqual({
      persona: expect.objectContaining({ id: ASSISTANT_ID }),
      matched: "exact",
    })
  })

  test("rescues typos when one candidate is clearly closest", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    const fuzzy = findPersona(db, "u", "softwre managr")
    if (!fuzzy.persona) throw new Error("expected a fuzzy match")
    expect(fuzzy.matched).toBe("fuzzy")
    expect(fuzzy.persona.id).toBe("p1")
    const swapped = findPersona(db, "u", "softwaer manager")
    if (!swapped.persona) throw new Error("expected a fuzzy match")
    expect(swapped.matched).toBe("fuzzy")
  })

  test("matches a short custom name exactly", () => {
    const db = open()
    addCustom(db, "p1", "Ops")
    expect(findPersona(db, "u", "ops")).toEqual({
      persona: expect.objectContaining({ id: "p1" }),
      matched: "exact",
    })
  })

  test("refuses a near-tie between two candidates and suggests instead", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    addCustom(db, "p2", "Softwarex manager")
    const match = findPersona(db, "u", "softwarey manager")
    expect(match.persona).toBeNull()
    if (!match.persona)
      expect(match.suggestions).toEqual(
        expect.arrayContaining(["Software manager", "Softwarex manager"]),
      )
  })

  test("unknown names return the closest suggestions", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    addCustom(db, "p2", "Chef")
    const match = findPersona(db, "u", "zzzzzz")
    expect(match.persona).toBeNull()
    if (!match.persona) expect(match.suggestions).toHaveLength(3)
  })

  test("personas of other users are invisible", () => {
    const db = open()
    db.createPersona({
      id: "p9",
      userId: "someone-else",
      name: "Software manager",
      instruction: "x",
      createdAt: Date.now(),
    })
    const match = findPersona(db, "u", "Software manager")
    expect(match.persona).toBeNull()
  })
})

describe("nameSimilarity", () => {
  test("is 1 for identical strings and counts transpositions as one edit", () => {
    expect(nameSimilarity("software manager", "software manager")).toBe(1)
    expect(nameSimilarity("", "")).toBe(1)
    expect(nameSimilarity("softwaer", "software")).toBeCloseTo(1 - 1 / 8)
  })
})

describe("listPersonas", () => {
  test("badges personas a plugin installed and leaves user customs alone", () => {
    const db = open()
    db.createUser({
      id: "u",
      email: "u@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.createInstalledPlugin({
      id: "row-1",
      userId: "u",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({ id: "weather-pro", name: "Weather Pro" }),
      readme: null,
      enabled: true,
      source: "marketplace",
      localPath: null,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    addCustom(db, "p-user", "Team lead")
    addCustom(db, "p-plugin", "Meteorologist")
    db.setInstalledPluginApplied("u", "weather-pro", {
      ...emptyAppliedLog(),
      personaIds: ["p-plugin"],
    })
    const personas = listPersonas(db, "u")
    const pluginPersona = personas.find((item) => item.id === "p-plugin")
    const userPersona = personas.find((item) => item.id === "p-user")
    expect(pluginPersona?.plugin).toEqual({
      id: "weather-pro",
      name: "Weather Pro",
    })
    expect(userPersona?.plugin).toBeUndefined()
    expect(
      personas.find((item) => item.id === ASSISTANT_ID)?.plugin,
    ).toBeUndefined()
  })
})

describe("persona system line", () => {
  test("assistant adds nothing", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(personaSystem(resolvePersona(db, "u", ASSISTANT_ID))).toBeNull()
  })

  test("a built-in voice is injected and does not replace rules", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    const line = personaSystem(resolvePersona(db, "u", "designer"))
    expect(line).toContain("answer as Designer")
    expect(line).toContain("does not replace desktop, memory, or safety rules")
  })

  test("unknown id does not inject", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(personaSystem(resolvePersona(db, "u", "missing"))).toBeNull()
  })

  test("merge keeps an existing system string", () => {
    expect(mergeSystem("keep", "voice")).toBe("keep\n\nvoice")
    expect(mergeSystem("  ", "voice")).toBe("voice")
  })

  test("rejects reserved and empty names", () => {
    expect(parsePersonaInput("Designer", "be visual")).toEqual({
      error: "that name is reserved",
    })
    expect(parsePersonaInput("  ", "be visual")).toEqual({
      error: "name must be 1–48 characters",
    })
    expect(parsePersonaInput("Chef", "cook simply")).toEqual({
      name: "Chef",
      instruction: "cook simply",
    })
    expect(parsePersonaInput("Chef", "")).toEqual({
      error: "instruction must be 1–2000 characters",
    })
    expect(parsePersonaInput("Chef", "x".repeat(2001))).toEqual({
      error: "instruction must be 1–2000 characters (got 2001, 1 over)",
    })
  })
})
