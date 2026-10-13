import { describe, expect, test } from "bun:test"
import { isWatchedRootPath, WATCH_ROOTS } from "./file-watch"

describe("watched root paths", () => {
  test("covers the workspace and plugins-create roots", () => {
    expect(WATCH_ROOTS).toContain("/home/agent/workspace")
    expect(WATCH_ROOTS).toContain("/home/agent/plugins-create")
  })

  test("accepts files inside the watched roots", () => {
    expect(isWatchedRootPath("/home/agent/workspace/app/index.ts")).toBe(true)
    expect(isWatchedRootPath("/home/agent/plugins-create/x/README.md")).toBe(
      true,
    )
  })

  test("drops files outside them and prefix lookalikes", () => {
    expect(isWatchedRootPath("/home/agent/.config/open-bot/x")).toBe(false)
    expect(isWatchedRootPath("/home/agent/workspace-sibling/x")).toBe(false)
    expect(isWatchedRootPath("/home/agent/plugins-create-extra/x")).toBe(false)
    expect(isWatchedRootPath("/etc/passwd")).toBe(false)
    expect(isWatchedRootPath("/home/agent/workspace")).toBe(false)
  })
})
