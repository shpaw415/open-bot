import { describe, expect, test } from "bun:test"
import { dirtyForms } from "./dirty-form"

describe("dirtyForms registry", () => {
  test("empty registry never reports dirty", () => {
    dirtyForms.reset()
    expect(dirtyForms.hasDirty()).toBe(false)
  })

  test("mark/clear track individual forms", () => {
    dirtyForms.reset()
    const a = Symbol("form-a")
    const b = Symbol("form-b")
    dirtyForms.mark(a)
    expect(dirtyForms.hasDirty()).toBe(true)
    dirtyForms.mark(b)
    expect(dirtyForms.hasDirty()).toBe(true)
    dirtyForms.clear(a)
    expect(dirtyForms.hasDirty()).toBe(true)
    dirtyForms.clear(b)
    expect(dirtyForms.hasDirty()).toBe(false)
  })

  test("clearing an unknown key is a no-op", () => {
    dirtyForms.reset()
    expect(() => dirtyForms.clear(Symbol("ghost"))).not.toThrow()
    expect(dirtyForms.hasDirty()).toBe(false)
  })

  test("the same key marked twice still clears once", () => {
    dirtyForms.reset()
    const key = Symbol("form")
    dirtyForms.mark(key)
    dirtyForms.mark(key)
    dirtyForms.clear(key)
    expect(dirtyForms.hasDirty()).toBe(false)
  })

  test("listeners fire on mark and clear", () => {
    dirtyForms.reset()
    let calls = 0
    const unsubscribe = dirtyForms.subscribe(() => {
      calls += 1
    })
    const key = Symbol("form")
    dirtyForms.mark(key)
    dirtyForms.clear(key)
    unsubscribe()
    dirtyForms.mark(Symbol("other"))
    expect(calls).toBe(2)
    dirtyForms.reset()
  })
})
