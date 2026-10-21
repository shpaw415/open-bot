import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  DEFAULT_LANGUAGE,
  instanceLanguage,
  isValidLanguage,
  SUPPORTED_LANGUAGES,
} from "./language"

function db() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

describe("language", () => {
  test("the default applies when nothing is saved", () => {
    expect(DEFAULT_LANGUAGE).toBe("fr")
    expect(instanceLanguage(db())).toBe("fr")
  })

  test("a saved supported value wins", () => {
    const database = db()
    database.setSetting("language", "en")
    expect(instanceLanguage(database)).toBe("en")
  })

  test("a stale or tampered value falls back instead of breaking callers", () => {
    const database = db()
    database.setSetting("language", "klingon")
    expect(instanceLanguage(database)).toBe(DEFAULT_LANGUAGE)
  })

  test("validation only accepts the supported list", () => {
    for (const value of SUPPORTED_LANGUAGES) {
      expect(isValidLanguage(value)).toBe(true)
    }
    expect(isValidLanguage("klingon")).toBe(false)
    expect(isValidLanguage(42)).toBe(false)
    expect(isValidLanguage(null)).toBe(false)
    expect(isValidLanguage(undefined)).toBe(false)
  })
})
