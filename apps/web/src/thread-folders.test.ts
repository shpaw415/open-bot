import { expect, test } from "bun:test"
import { expandFolder, parseCollapsedFolders } from "./thread-folders"

test("parseCollapsedFolders keeps string entries only", () => {
  expect(parseCollapsedFolders(null).size).toBe(0)
  expect(parseCollapsedFolders("").size).toBe(0)
  expect(parseCollapsedFolders("not json").size).toBe(0)
  expect(parseCollapsedFolders('{"a":1}').size).toBe(0)
  expect(parseCollapsedFolders("5").size).toBe(0)
  expect([...parseCollapsedFolders('["a",1,"b",null,"c"]')]).toEqual([
    "a",
    "b",
    "c",
  ])
})

test("expandFolder removes the key and is idempotent", () => {
  const collapsed = new Set(["a", "b"])
  const opened = expandFolder(collapsed, "a")
  expect(opened.has("a")).toBe(false)
  expect(opened.has("b")).toBe(true)
  expect(collapsed.has("a")).toBe(true)
  expect(expandFolder(opened, "a")).toBe(opened)
  expect(expandFolder(opened, "zzz")).toBe(opened)
})
