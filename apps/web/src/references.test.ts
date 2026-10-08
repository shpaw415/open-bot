import { describe, expect, test } from "bun:test"
import {
  detectMention,
  fuzzyScore,
  matchSuggestions,
  mentionSuggestions,
  type RefSectionView,
} from "./references"

const keys = ["personas", "cron", "skills"]

describe("detect mention", () => {
  test("starts a section mention at the at sign", () => {
    expect(detectMention("@", 1, keys)).toEqual({
      stage: "section",
      section: "",
      query: "",
      start: 0,
    })
  })

  test("collects the typed query after the at sign", () => {
    expect(detectMention("hi @per", 7, keys)).toMatchObject({
      stage: "section",
      query: "per",
      start: 3,
    })
  })

  test("a known section switches to name stage", () => {
    expect(detectMention("@personas/wor", 13, keys)).toMatchObject({
      stage: "name",
      section: "personas",
      query: "wor",
    })
  })

  test("an unknown section is not a mention", () => {
    expect(detectMention("@nope/x", 7, keys)).toBeNull()
  })

  test("mid-text mentions need a boundary before the at sign", () => {
    expect(detectMention("me@per", 6, keys)).toBeNull()
    expect(detectMention("hi @per", 6, keys)).toMatchObject({ query: "pe" })
  })

  test("a space, newline, or moved caret closes the flow", () => {
    expect(detectMention("@per ", 5, keys)).toBeNull()
    expect(detectMention("a\n@per", 6, keys)).toBeNull()
    expect(detectMention("@personas/x", 1, keys)).toMatchObject({
      stage: "section",
      query: "",
    })
  })
})

describe("fuzzy score", () => {
  test("ranks exact over prefix over substring over typos", () => {
    expect(fuzzyScore("cron", "cron")).toBeGreaterThan(
      fuzzyScore("cron", "cronjobs"),
    )
    expect(fuzzyScore("cron", "cronjobs")).toBeGreaterThan(
      fuzzyScore("cron", "my cron jobs"),
    )
    expect(fuzzyScore("persna", "personas")).toBeGreaterThan(-1)
    expect(fuzzyScore("zzzzzz", "personas")).toBe(-1)
  })

  test("caps misspell distance by query length", () => {
    expect(fuzzyScore("perx", "personas")).toBeGreaterThan(-1)
    expect(fuzzyScore("pxrx", "personas")).toBe(-1)
  })

  test("empty query matches everything equally", () => {
    expect(fuzzyScore("", "anything")).toBe(0)
  })
})

describe("match suggestions", () => {
  const sections: RefSectionView[] = [
    { key: "cron", label: "Cron jobs", items: [] },
    { key: "personas", label: "Personas", items: [] },
    { key: "skills", label: "Skills", items: [] },
  ]

  test("sorts by score then label and caps the list", () => {
    const many = [
      { key: "aaaa", label: "", items: [] },
      { key: "aaab", label: "", items: [] },
      { key: "aaac", label: "", items: [] },
      ...Array.from({ length: 10 }, (_, i) => ({
        key: `x${i}aaa`,
        label: "",
        items: [],
      })),
    ]
    const matches = matchSuggestions(many, "aaa", (section) => section.key)
    expect(matches[0]?.key).toBe("aaaa")
    expect(matches).toHaveLength(8)
  })

  test("keeps registry order for empty queries via stable sort", () => {
    expect(
      matchSuggestions(sections, "", (s) => s.key).map((s) => s.key),
    ).toEqual(["cron", "personas", "skills"])
  })
})

describe("mention suggestions", () => {
  const sections: RefSectionView[] = [
    {
      key: "personas",
      label: "Personas",
      items: [
        { id: "1", name: "Work wife", description: "custom persona" },
        { id: "2", name: "Designer", description: "built-in persona" },
      ],
    },
    { key: "cron", label: "Cron jobs", items: [] },
  ]

  test("section stage lists sections in registry order for empty queries", () => {
    const items = mentionSuggestions(
      { stage: "section", section: "", query: "", start: 0 },
      sections,
    )
    expect(items.map((item) => item.complete)).toEqual(["@personas/", "@cron/"])
  })

  test("name stage lists fuzzy-matched items with a trailing space", () => {
    const items = mentionSuggestions(
      { stage: "name", section: "personas", query: "wife", start: 0 },
      sections,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.complete).toBe("@personas/Work wife ")
    expect(items[0]?.secondary).toBe("custom persona")
  })

  test("empty name query lists everything in the section", () => {
    const items = mentionSuggestions(
      { stage: "name", section: "personas", query: "", start: 0 },
      sections,
    )
    expect(items).toHaveLength(2)
  })
})
