import { describe, expect, test } from "bun:test"
import { snapshotDirty } from "./discard-guard"

describe("discard-guard", () => {
  test("an intact form is not dirty", () => {
    const pristine = { name: "", instruction: "", skills: null, extras: [] }
    expect(snapshotDirty(pristine, { ...pristine })).toBe(false)
  })

  test("any edited field is dirty", () => {
    const pristine = { name: "", instruction: "", skills: null, extras: [] }
    expect(
      snapshotDirty(pristine, { ...pristine, name: "Brand designer" }),
    ).toBe(true)
    expect(
      snapshotDirty(pristine, { ...pristine, instruction: "Speak plainly." }),
    ).toBe(true)
    expect(snapshotDirty(pristine, { ...pristine, skills: ["research"] })).toBe(
      true,
    )
    expect(snapshotDirty(pristine, { ...pristine, extras: ["research"] })).toBe(
      true,
    )
  })

  test("toggling back to the opened values goes clean again", () => {
    const pristine = { name: "A", skills: ["x", "y"] }
    expect(snapshotDirty(pristine, { name: "A", skills: ["y", "x"] })).toBe(
      true,
    )
    expect(snapshotDirty(pristine, { name: "A", skills: ["x", "y"] })).toBe(
      false,
    )
  })

  test("a failed save stays dirty — the snapshot never moved", () => {
    const pristine = { name: "A", body: "hello" }
    const afterFailedSave = { name: "A", body: "hello world" }
    expect(snapshotDirty(pristine, afterFailedSave)).toBe(true)
  })

  test("missing snapshots never ask", () => {
    expect(snapshotDirty(null, { name: "x" })).toBe(false)
    expect(snapshotDirty({ name: "x" }, null)).toBe(false)
    expect(snapshotDirty(null, null)).toBe(false)
  })
})
