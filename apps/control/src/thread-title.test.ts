import { expect, test } from "bun:test"
import { isStockTitle, promptText, titleFromPrompt } from "./thread-title"

test("stock OpenCode titles are replaced from the prompt", () => {
  expect(isStockTitle("")).toBe(true)
  expect(isStockTitle("New session - 2026-10-06T16:16:39.111Z")).toBe(true)
  expect(isStockTitle("Horaire Agendrix")).toBe(false)
  expect(titleFromPrompt("  check the site\nthen stop")).toBe("check the site")
  expect(promptText({ parts: [{ type: "text", text: "hello" }] })).toBe("hello")
})
