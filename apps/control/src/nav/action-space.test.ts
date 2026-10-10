import { expect, test } from "bun:test"
import {
  buildActionSpace,
  buildQuestions,
  goalValues,
  marksFromSpace,
  NONE_VALUE,
  parseDecision,
  type Snapshot,
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
