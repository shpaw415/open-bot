import { expect, test } from "bun:test"
import {
  buildActionSpace,
  buildQuestions,
  goalUrl,
  goalValues,
  marksFromSpace,
  NONE_VALUE,
  parseDecision,
  quoteCandidates,
  type Snapshot,
  withGoalUrl,
} from "./action-space"

function page(elements: Snapshot["elements"]): Snapshot {
  return {
    url: "https://example.test",
    title: "Example",
    text: "hello",
    canScrollDown: false,
    canScrollUp: false,
    elements,
  }
}

test("marks use action-space indexes and badge a dropdown once", () => {
  const space = buildActionSpace(
    page([
      {
        targetId: "n4",
        role: "button",
        label: "Search",
        value: "",
        editable: false,
        actionable: true,
      },
      {
        targetId: "n9",
        role: "select",
        label: "Size",
        value: "",
        editable: false,
        actionable: true,
        options: [{ label: "S" }, { label: "M" }],
      },
      {
        targetId: "n1",
        role: "button",
        label: "Hidden",
        value: "",
        editable: false,
        actionable: false,
      },
    ]),
    [],
  )
  expect(marksFromSpace(space)).toEqual([
    { index: "1", targetId: "n4" },
    { index: "2", targetId: "n9" },
  ])
})

test("goal values come from quotes, urls, and search phrasing", () => {
  expect(goalValues('search for "rubber duck"')).toEqual(["rubber duck"])
  expect(goalValues("open https://example.test/a.")).toEqual([
    "https://example.test/a",
  ])
  expect(goalValues("search for lasagna")).toEqual(["lasagna"])
})

test("--url folds into the goal so goalUrl navigates straight to it", () => {
  expect(
    withGoalUrl(
      "open the messages and read the last one",
      "https://www.facebook.com/messages",
    ),
  ).toBe(
    "open the messages and read the last one https://www.facebook.com/messages",
  )
  expect(withGoalUrl("", "https://www.messenger.com/")).toBe(
    "https://www.messenger.com/",
  )
  expect(withGoalUrl("open https://a.test/x", "https://a.test/x")).toBe(
    "open https://a.test/x",
  )
  expect(withGoalUrl("just a goal", "")).toBe("just a goal")
  expect(goalUrl(withGoalUrl("", "https://www.facebook.com/messages."))).toBe(
    "https://www.facebook.com/messages",
  )
})

test("occluded and dead controls are not click targets", () => {
  const space = buildActionSpace(
    page([
      {
        targetId: "1",
        role: "button",
        label: "Search",
        value: "",
        editable: false,
        actionable: false,
      },
      {
        targetId: "2",
        role: "button",
        label: "Stuck",
        value: "",
        editable: false,
        actionable: true,
      },
    ]),
    [
      { action: "Stuck", kind: "click", pageChanged: false },
      { action: "Stuck", kind: "click", pageChanged: false },
    ],
  )
  expect(space.heads.CLICK).toBeUndefined()
  expect(space.operations).toContain("BLOCKED")
})

test("a decision must name an offered target", () => {
  const space = buildActionSpace(
    page([
      {
        targetId: "9",
        role: "button",
        label: "Go",
        value: "",
        editable: false,
        actionable: true,
      },
    ]),
    [],
  )
  expect(
    parseDecision(
      {
        answers: {
          operation: { choice: "CLICK", confidence: 0.8 },
          click_target: { choice: "1", confidence: 0.7 },
          needs_user: { noul: 0.1 },
        },
      },
      space,
    )?.target,
  ).toBe("1")
  expect(
    parseDecision(
      {
        answers: {
          operation: { choice: "CLICK", confidence: 0.8 },
          click_target: { choice: "99", confidence: 0.7 },
        },
      },
      space,
    ),
  ).toBeNull()
})

test("a lone target question offers an explicit opt-out", () => {
  const space = buildActionSpace(
    page([
      {
        targetId: "9",
        role: "button",
        label: "Accept",
        value: "",
        editable: false,
        actionable: true,
      },
    ]),
    [],
  )
  const questions = buildQuestions(space, "accept cookies", [])
  expect(Object.keys(questions.click_target?.criteria ?? {})).toEqual([
    "1",
    NONE_VALUE,
  ])
})

test("quote candidates are verbatim page-text chunks with a none opt-out", () => {
  const text = [
    "1. YC S24 startup",
    "builds robots",
    "345 points by user 2 hours ago  |  120 comments",
    "",
    "Second headline that is long enough to stand on its own without merging",
    "footer",
  ].join("\n")
  const quotes = quoteCandidates(text)
  const normalized = text.replace(/\s+/g, " ")
  expect(quotes.length).toBeGreaterThan(0)
  for (const quote of quotes) {
    expect(normalized.includes(quote)).toBe(true)
  }
  // Short lines merge so a story title and its points land in one snippet.
  expect(quotes.some((quote) => quote.includes("YC S24 startup"))).toBe(true)
  expect(
    quotes.some(
      (quote) =>
        quote.includes("YC S24 startup") && quote.includes("345 points"),
    ),
  ).toBe(true)
  const questions = buildQuestions(
    buildActionSpace(page([]), []),
    "quote the #1 story title and points",
    [],
    quotes,
  )
  expect(questions.page_quote).toBeDefined()
  expect(Object.keys(questions.page_quote?.criteria ?? {})).toContain(
    NONE_VALUE,
  )
  for (const quote of quotes) {
    expect(Object.keys(questions.page_quote?.criteria ?? {})).toContain(quote)
  }
})

test("parseDecision carries the picked page quote and none clears it", () => {
  const space = buildActionSpace(page([]), [])
  const quote = "1. YC S24 startup builds robots"
  const decision = parseDecision(
    {
      answers: {
        operation: { choice: "DONE", confidence: 0.9 },
        page_quote: { choice: quote, confidence: 0.8 },
        needs_user: { noul: 0.1 },
      },
    },
    space,
  )
  expect(decision?.quote).toBe(quote)
  expect(
    parseDecision(
      {
        answers: {
          operation: { choice: "DONE", confidence: 0.9 },
          page_quote: { choice: NONE_VALUE, confidence: 0.8 },
        },
      },
      space,
    )?.quote,
  ).toBeNull()
  expect(
    parseDecision(
      {
        answers: {
          operation: { choice: "DONE", confidence: 0.9 },
        },
      },
      space,
    )?.quote,
  ).toBeNull()
})

test("a clef result envelope unwraps to the answers", () => {
  const space = buildActionSpace(
    page([
      {
        targetId: "9",
        role: "button",
        label: "Go",
        value: "",
        editable: false,
        actionable: true,
      },
    ]),
    [],
  )
  const decision = parseDecision(
    {
      result: {
        model: "clef",
        answers: {
          operation: {
            type: "choice",
            choice: "CLICK",
            probabilities: { CLICK: 0.9659, DONE: 0.0341 },
            confidence: 0.8683,
          },
          click_target: {
            type: "choice",
            choice: "1",
            probabilities: { "1": 0.99 },
            confidence: 0.99,
          },
          needs_user: { type: "noul", noul: 0.0088 },
        },
        usage: { input_tokens: 152, output_tokens: 0 },
      },
      success: true,
      errors: [],
    },
    space,
  )
  expect(decision).toMatchObject({
    operation: "CLICK",
    confidence: 0.9659,
    target: "1",
    needsUser: 0.0088,
  })
})

test("trimProseUrl keeps balanced parens, strips prose punctuation", async () => {
  const { goalUrl, withGoalUrl } = await import("./action-space")
  expect(
    goalUrl(
      "Follow https://en.wikipedia.org/wiki/Olympic_Stadium_(Montreal) now",
    ),
  ).toBe("https://en.wikipedia.org/wiki/Olympic_Stadium_(Montreal)")
  expect(goalUrl("see https://x.com/page).")).toBe("https://x.com/page")
  expect(goalUrl("open https://x.com/page.")).toBe("https://x.com/page")
  expect(
    withGoalUrl("Follow the link", "https://en.wikipedia.org/wiki/X_(Y)"),
  ).toBe("Follow the link https://en.wikipedia.org/wiki/X_(Y)")
})

test("pageNeedsUser recognizes verification phrasing without the word captcha", async () => {
  const { pageNeedsUser } = await import("./action-space")
  const base = {
    url: "https://example.test/verify",
    title: "Example",
    text: "",
    canScrollDown: false,
    canScrollUp: false,
    elements: [],
  }
  expect(
    pageNeedsUser({
      ...base,
      text: "complete the human verification below by typing the characters you see in the image",
    }),
  ).toBe(true)
  expect(
    pageNeedsUser({ ...base, text: "Verify you are human to continue" }),
  ).toBe(true)
  expect(
    pageNeedsUser({
      ...base,
      text: "This site is protected. Not a robot? Prove you are human",
    }),
  ).toBe(true)
  expect(
    pageNeedsUser({
      ...base,
      text: "Welcome to the knowledge base article collection",
    }),
  ).toBe(false)
})
