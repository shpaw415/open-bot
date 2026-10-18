import { describe, expect, test } from "bun:test"
import {
  OPEN_PROJECT_EVENT,
  openProjectById,
  peekPendingProject,
  takePendingProject,
} from "./open-project"

// The module dispatches through window; bun's test runner has no DOM, so a
// bare EventTarget is enough for the event contract under test.
;(globalThis as { window?: EventTarget }).window ??= new EventTarget()

describe("open-project pipeline", () => {
  test("opening dispatches the event and parks the id for a late mount", () => {
    let eventProjectId = ""
    const onOpen = (event: Event) => {
      eventProjectId = (event as CustomEvent<{ projectId?: string }>).detail
        ?.projectId as string
    }
    window.addEventListener(OPEN_PROJECT_EVENT, onOpen)
    try {
      openProjectById("p42")
      expect(eventProjectId).toBe("p42")
      // The Projects view may not be mounted yet (the search pick navigates
      // first) — the pending slot survives until it consumes it.
      expect(peekPendingProject()).toBe("p42")
      expect(takePendingProject()).toBe("p42")
      expect(takePendingProject()).toBe("")
    } finally {
      window.removeEventListener(OPEN_PROJECT_EVENT, onOpen)
    }
  })

  test("an empty id is a no-op", () => {
    openProjectById("")
    expect(peekPendingProject()).toBe("")
  })
})
