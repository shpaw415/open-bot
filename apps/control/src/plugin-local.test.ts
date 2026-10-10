import { describe, expect, test } from "bun:test"
import { checkLocalPluginPath } from "./plugin-local"

describe("local plugin path", () => {
  test("accepts an absolute desktop path", () => {
    expect(checkLocalPluginPath("/plugin/root")).toEqual({
      ok: true,
      path: "/plugin/root",
    })
    expect(checkLocalPluginPath("/plugin/root/")).toEqual({
      ok: true,
      path: "/plugin/root",
    })
  })

  test("rejects relative paths, traversal, and blank roots", () => {
    for (const path of [
      "plugin/root",
      "../plugin",
      "/plugin/../root",
      "/plugin/./root",
      "/plugin//root",
      "/",
      "",
      "/plugin/root\n",
    ]) {
      expect(checkLocalPluginPath(path).ok).toBe(false)
    }
  })
})
