import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  ASSISTANT_ID,
  mergeSystem,
  parsePersonaInput,
  personaSystem,
  resolvePersona,
} from "./personas"

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
  })
})
