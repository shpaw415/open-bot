import { describe, expect, test } from "bun:test"
import { type DraftStorage, draftKey, readDraft, writeDraft } from "./src/draft"

function memory(): DraftStorage & { keys(): string[] } {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
    keys: () => [...store.keys()],
  }
}

describe("composer draft", () => {
  test("reads and writes a session draft", () => {
    const storage = memory()
    expect(readDraft(storage, "ses_a")).toBe("")
    writeDraft(storage, "ses_a", "still writing")
    expect(readDraft(storage, "ses_a")).toBe("still writing")
    expect(storage.keys()).toEqual([draftKey("ses_a")])
  })

  test("keeps drafts separate per session", () => {
    const storage = memory()
    writeDraft(storage, "ses_a", "hello")
    writeDraft(storage, "ses_b", "other")
    expect(readDraft(storage, "ses_a")).toBe("hello")
    expect(readDraft(storage, "ses_b")).toBe("other")
  })

  test("clears an empty draft", () => {
    const storage = memory()
    writeDraft(storage, "ses_a", "hello")
    writeDraft(storage, "ses_a", "")
    expect(readDraft(storage, "ses_a")).toBe("")
    expect(storage.keys()).toEqual([])
  })

  test("ignores a missing session", () => {
    const storage = memory()
    writeDraft(storage, "", "orphan")
    expect(readDraft(storage, "")).toBe("")
    expect(storage.keys()).toEqual([])
  })

  test("survives a storage failure", () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => {
        throw new Error("quota")
      },
    }
    expect(() => writeDraft(storage, "ses_a", "hello")).not.toThrow()
    expect(() => writeDraft(storage, "ses_a", "")).not.toThrow()
    expect(readDraft(storage, "ses_a")).toBe("")
  })
})
