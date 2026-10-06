import { expect, test } from "bun:test"
import {
  buildActionSpace,
  goalValues,
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
