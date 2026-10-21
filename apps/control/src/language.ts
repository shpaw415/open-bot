import type { Db } from "@open-bot/db"

// One host-wide UI language. The dashboard Config tab writes it; every plugin
// receives it (config file + x-open-bot-language header + frame ?lang=) so
// plugin pages and tools speak the user's language without shipping their own
// selector. Dashboard chrome localization keys off this same value later.
// A new language is one entry in SUPPORTED_LANGUAGES.

export const LANGUAGE_KEY = "language"
export const DEFAULT_LANGUAGE = "fr"
export const SUPPORTED_LANGUAGES = ["en", "fr"] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function isValidLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

// The saved value wins; anything else (missing, stale, tampered) falls back —
// a bad row must never break /api/me or a plugin config sync.
export function instanceLanguage(db: Db): SupportedLanguage {
  const saved = db.getSetting(LANGUAGE_KEY)
  return isValidLanguage(saved) ? saved : DEFAULT_LANGUAGE
}
