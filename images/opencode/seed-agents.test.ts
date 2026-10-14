import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { agentsPath, buildIndex, renderAgents } from "../../scripts/gen-agents"

test("every seed skill appears in the generated skills index", () => {
  const index = buildIndex()
  expect(index).toContain("`desktop` —")
  expect(index).toContain("`improve` —")
  expect(index).not.toContain("undefined")
})

test("the committed skills index in seed AGENTS.md is fresh", () => {
  const current = readFileSync(agentsPath, "utf8")
  expect(renderAgents(current)).toBe(current)
})
