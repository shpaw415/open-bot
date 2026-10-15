import { describe, expect, test } from "bun:test"
import {
  collectPluginMentionSources,
  detectMention,
  findProjectReferenceTokens,
  findReferenceTokens,
  fuzzyScore,
  matchSuggestions,
  mentionSuggestions,
  type RefSectionView,
} from "./references"

const sections: RefSectionView[] = [
  {
    key: "personas",
    label: "Personas",
    items: [{ id: "p1", name: "Work wife", description: "custom persona" }],
  },
  {
    key: "cron",
    label: "Cron jobs",
    items: [{ id: "c1", name: "Nightly build" }],
  },
  {
    key: "projects",
    label: "Projects",
    items: [
      { id: "j1", name: "My App", path: "/home/agent/workspace/my-app" },
      {
        id: "j2",
        name: "API client",
        path: "/home/agent/plugins-create/api-client",
      },
    ],
  },
  {
    key: "reports",
    label: "Plugin reports",
    items: [{ id: "r1", name: "stock-dashboard" }],
  },
  {
    key: "plugins",
    label: "Plugins",
    items: [
      {
        id: "pl1",
        name: "Stock Dashboard",
        description: "live stock cards",
      },
    ],
  },
]

describe("detect mention", () => {
  test("starts a section mention at the at sign", () => {
    expect(detectMention("@", 1, sections)).toEqual({
      stage: "section",
      section: "",
      query: "",
      start: 0,
    })
  })

  test("collects the typed query after the at sign", () => {
    expect(detectMention("hi @per", 7, sections)).toMatchObject({
      stage: "section",
      query: "per",
      start: 3,
    })
  })

  test("a known section switches to name stage", () => {
    expect(detectMention("@personas/wor", 13, sections)).toMatchObject({
      stage: "name",
      section: "personas",
      query: "wor",
    })
  })

  test("an unknown section is not a mention", () => {
    expect(detectMention("@nope/x", 7, sections)).toBeNull()
  })

  test("mid-text mentions need a boundary before the at sign", () => {
    expect(detectMention("me@per", 6, sections)).toBeNull()
    expect(detectMention("hi @per", 6, sections)).toMatchObject({
      query: "pe",
    })
  })

  test("a space in the section stage or a newline closes the flow", () => {
    expect(detectMention("@per ", 5, sections)).toBeNull()
    expect(detectMention("a\n@per", 6, sections)).toBeNull()
    expect(detectMention("@personas/x", 1, sections)).toMatchObject({
      stage: "section",
      query: "",
    })
  })

  test("name stage stays open across spaces while the query still matches", () => {
    expect(detectMention("@projects/My ", 13, sections)).toMatchObject({
      stage: "name",
      section: "projects",
      query: "My ",
    })
    expect(detectMention("@projects/My App", 16, sections)).toMatchObject({
      stage: "name",
      query: "My App",
    })
    expect(detectMention("@projects/My A", 14, sections)).toMatchObject({
      stage: "name",
      query: "My A",
    })
    expect(
      detectMention(
        "@personas/Work wife",
        " @personas/Work wife".length - 1,
        sections,
      ),
    ).toMatchObject({ stage: "name", query: "Work wife" })
    expect(
      detectMention("@projects/my-app", "@projects/my-app".length, sections),
    ).toMatchObject({ stage: "name", query: "my-app" })
  })

  test("a finished mention (exact name plus space) closes the flow", () => {
    expect(detectMention("@projects/My App ", 17, sections)).toBeNull()
    expect(detectMention("@personas/Work wife ", 20, sections)).toBeNull()
    expect(detectMention("@projects/my-app ", 17, sections)).toBeNull()
    expect(
      detectMention(
        "@reports/stock-dashboard ",
        "@reports/stock-dashboard ".length,
        sections,
      ),
    ).toBeNull()
  })

  test("a spaced query that matches nothing closes the flow", () => {
    expect(detectMention("@projects/My App t", 18, sections)).toBeNull()
    expect(detectMention("@projects/zz yyy", 15, sections)).toBeNull()
    expect(detectMention("@projects/ ", 11, sections)).toBeNull()
  })

  test("a word query with no match still offers the no-match row", () => {
    expect(detectMention("@projects/zz", 12, sections)).toMatchObject({
      stage: "name",
      section: "projects",
      query: "zz",
    })
  })

  test("singular @project opens the projects picker", () => {
    expect(detectMention("@project/my", 11, sections)).toMatchObject({
      stage: "name",
      section: "projects",
      query: "my",
    })
    expect(detectMention("@project", 8, sections)).toMatchObject({
      stage: "section",
      query: "project",
    })
  })

  test("singular @plugin opens the plugins picker", () => {
    expect(detectMention("@plugin/stock", 13, sections)).toMatchObject({
      stage: "name",
      section: "plugins",
      query: "stock",
    })
    expect(detectMention("@plugins/", 9, sections)).toMatchObject({
      stage: "name",
      section: "plugins",
      query: "",
    })
  })
})

describe("find reference tokens", () => {
  test("finds plural and singular tokens with paths", () => {
    const tokens = findReferenceTokens(
      "work in @projects/My App and @project/api client",
      sections,
    )
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      section: "projects",
      start: 8,
      end: 24,
      name: "My App",
      path: "/home/agent/workspace/my-app",
    })
    expect(tokens[1]).toMatchObject({ name: "API client" })
  })

  test("ends the highlight at the item name, not trailing words", () => {
    const tokens = findReferenceTokens(
      "use @projects/My App today please",
      sections,
    )
    expect(tokens[0]?.start).toBe(4)
    expect(tokens[0]?.end).toBe(4 + "@projects/My App".length)
    expect(
      "use @projects/My App".slice(tokens[0]?.start ?? 0, tokens[0]?.end),
    ).toBe("@projects/My App")
  })

  test("matches slug and path-basename aliases", () => {
    const slugToken = findReferenceTokens(
      "use @projects/my-app today",
      sections,
    )[0]
    expect(slugToken).toMatchObject({ name: "My App" })
    expect(
      "use @projects/my-app".slice(slugToken?.start ?? 0, slugToken?.end ?? 0),
    ).toBe("@projects/my-app")
    expect(
      findReferenceTokens("open @projects/api-client now", sections)[0],
    ).toMatchObject({ name: "API client" })
  })

  test("matches by slug-like prefix and unique first word", () => {
    const tokens = findReferenceTokens("use @projects/my today", sections)
    expect(tokens[0]).toMatchObject({ name: "My App" })
  })

  test("highlights spaceful names in other sections", () => {
    const tokens = findReferenceTokens(
      "ask @personas/Work wife and run @cron/Nightly build",
      sections,
    )
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      section: "personas",
      name: "Work wife",
    })
    expect(
      tokens[0] &&
        "ask @personas/Work wife".slice(tokens[0].start, tokens[0].end),
    ).toBe("@personas/Work wife")
    expect(tokens[1]).toMatchObject({ section: "cron", name: "Nightly build" })
  })

  test("matches plugin tokens by display name and slug alias", () => {
    const tokens = findReferenceTokens(
      "check @plugins/Stock Dashboard and @plugin/stock-dashboard",
      sections,
    )
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      section: "plugins",
      name: "Stock Dashboard",
    })
    expect(tokens[1]).toMatchObject({
      section: "plugins",
      name: "Stock Dashboard",
    })
  })

  test("unknown items keep a span for the warning tint", () => {
    const tokens = findReferenceTokens(
      "use @projects/nope today and @cron/nope build",
      sections,
    )
    expect(tokens).toHaveLength(2)
    expect(tokens[0]?.name).toBe("")
    expect(tokens[0]?.section).toBe("projects")
    expect(
      "use @projects/nope today".slice(tokens[0]?.start ?? 0, tokens[0]?.end),
    ).toBe("@projects/nope")
    expect(
      "use @projects/nope today and @cron/nope build".slice(
        tokens[1]?.start ?? 0,
        tokens[1]?.end ?? 0,
      ),
    ).toBe("@cron/nope")
  })

  test("ignores emails, unknown sections and empty mentions", () => {
    expect(
      findReferenceTokens("mail me@projects/x or @projects/", sections),
    ).toEqual([])
    expect(findReferenceTokens("see @nope/thing here", sections)).toEqual([])
    expect(findReferenceTokens("no mentions here", sections)).toEqual([])
  })
})

describe("find project reference tokens", () => {
  test("keeps only project tokens for bubble links", () => {
    const tokens = findProjectReferenceTokens(
      "ask @personas/Work wife about @projects/My App",
      [
        { name: "My App", path: "/home/agent/workspace/my-app" },
        { name: "Work wife" },
      ],
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      section: "projects",
      name: "My App",
      path: "/home/agent/workspace/my-app",
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
  const bare: RefSectionView[] = [
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
    expect(matchSuggestions(bare, "", (s) => s.key).map((s) => s.key)).toEqual([
      "cron",
      "personas",
      "skills",
    ])
  })
})

describe("mention suggestions", () => {
  const picker: RefSectionView[] = [
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
      picker,
    )
    expect(items.map((item) => item.complete)).toEqual(["@personas/", "@cron/"])
  })

  test("name stage lists fuzzy-matched items with a trailing space", () => {
    const items = mentionSuggestions(
      { stage: "name", section: "personas", query: "wife", start: 0 },
      picker,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.complete).toBe("@personas/Work wife ")
    expect(items[0]?.secondary).toBe("custom persona")
  })

  test("spaced queries still fuzzy-match the full name", () => {
    const items = mentionSuggestions(
      { stage: "name", section: "personas", query: "Work w", start: 0 },
      picker,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.complete).toBe("@personas/Work wife ")
  })

  test("empty name query lists everything in the section", () => {
    const items = mentionSuggestions(
      { stage: "name", section: "personas", query: "", start: 0 },
      picker,
    )
    expect(items).toHaveLength(2)
  })

  test("plugin mention aliases match in the picker and the overlay", () => {
    const stocks: RefSectionView[] = [
      {
        key: "stocks",
        label: "Stocks",
        items: [
          {
            id: "AAPL",
            name: "AAPL",
            description: "Apple Inc.",
            aliases: ["apple"],
          },
        ],
      },
    ]
    const items = mentionSuggestions(
      { stage: "name", section: "stocks", query: "app", start: 0 },
      stocks,
    )
    expect(items[0]?.complete).toBe("@stocks/AAPL ")
    const tokens = findReferenceTokens("buy @stocks/apple today", stocks)
    expect(tokens[0]?.name).toBe("AAPL")
  })
})

describe("plugin mention sources", () => {
  test("first enabled plugin with a page server wins; reserved slugs are dropped", () => {
    const sources = collectPluginMentionSources([
      {
        pluginId: "first",
        enabled: true,
        manifest: {
          dashboard: {
            pages: { entry: "server.ts" },
            mentions: [
              { section: "stocks", label: "Stocks" },
              { section: "plugins" },
            ],
          },
        },
      },
      {
        pluginId: "second",
        enabled: true,
        manifest: {
          dashboard: {
            pages: { entry: "server.ts" },
            mentions: [
              { section: "stocks", label: "Other" },
              { section: "bonds", path: "/bonds" },
            ],
          },
        },
      },
      {
        pluginId: "off",
        enabled: false,
        manifest: {
          dashboard: {
            pages: { entry: "server.ts" },
            mentions: [{ section: "bonds" }],
          },
        },
      },
    ])
    expect(sources).toEqual([
      {
        section: "stocks",
        label: "Stocks",
        pluginId: "first",
        path: "/mentions",
      },
      { section: "bonds", label: "bonds", pluginId: "second", path: "/bonds" },
    ])
  })
})
