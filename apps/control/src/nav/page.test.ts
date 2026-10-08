import { expect, test } from "bun:test"
import { normalize } from "./cdp"
import { shapeView } from "./page"

const probe = {
  url: "https://example.test/",
  title: "Example",
  text: "hello",
  canScrollDown: true,
  canScrollUp: false,
  elementsTruncated: true,
  elements: [
    {
      targetId: "n7",
      role: "button",
      label: "Go",
      value: "",
      editable: false,
      actionable: true,
    },
  ],
}

test("read shapes probe plus viewport into one json line", () => {
  const view = shapeView(probe, {
    width: 1920,
    height: 1200,
    scrollY: 2400,
    scrollHeight: 9000,
  })
  expect(view.url).toBe("https://example.test/")
  expect(view.viewport).toEqual({ width: 1920, height: 1200 })
  expect(view.scrollY).toBe(2400)
  expect(view.canScrollDown).toBe(true)
  expect(view.elementsTruncated).toBe(true)
  expect(view.elements[0]).toEqual({
    id: "n7",
    role: "button",
    label: "Go",
    value: "",
    editable: false,
    options: undefined,
  })
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
})

test("a raw page-world probe keeps ids and scroll flags after normalize", () => {
  const raw = {
    url: "https://fr.wikipedia.org/wiki/Raspberry_Pi_5",
    title: "Raspberry Pi 5",
    text: "specs",
    can_scroll_down: true,
    can_scroll_up: false,
    elements_truncated: false,
    elements: [
      {
        target_id: "n3",
        role: "input",
        label: "Rechercher sur Wikipédia",
        value: "",
        editable: true,
        actionable: true,
      },
    ],
  }
  const view = shapeView(normalize(raw), {
    width: 1911,
    height: 1074,
    scrollY: 0,
    scrollHeight: 1074,
  })
  expect(view.elements[0]?.id).toBe("n3")
  expect(view.canScrollDown).toBe(true)
  expect(JSON.stringify(view)).toContain('"id":"n3"')
})
