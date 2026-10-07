import { expect, test } from "bun:test"
import { parseTypedText } from "./text"

test("typed text accepts one JSON string and rejects a null", () => {
  expect(parseTypedText('{"text":"Zürich"}')).toBe("Zürich")
  expect(parseTypedText('{"text":null}')).toBe("")
  expect(parseTypedText("not json")).toBe("not json")
  expect(parseTypedText("{broken")).toBe("")
})
