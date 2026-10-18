import { describe, expect, test } from "bun:test"
import { createPopGuard } from "./nav-guard"

/**
 * A fake history: entries + index like the real stack, each entry carrying
 * the tag id the shell stores in history.state. Traversals fire popstate
 * synchronously (the browser fires it async; the guard must survive both
 * orders — the sync case is the stricter one).
 */
function fakeHistory(initial: string) {
  const entries: { path: string; id: number | null }[] = [
    { path: initial, id: null },
  ]
  let index = 0
  const harness = {
    entries,
    get index() {
      return index
    },
    onPop: undefined as (() => void) | undefined,
    locationPath: () => entries[index].path,
    incomingId: () => entries[index].id,
    go: (delta: number) => {
      const next = index + delta
      if (next < 0 || next >= entries.length) return
      index = next
      harness.onPop?.()
    },
    forward: () => harness.go(1),
    back: () => harness.go(-1),
    /** Shell-style push: truncates ahead, stores the guard-issued id. */
    push: (path: string, id: number | null) => {
      entries.splice(index + 1)
      entries.push({ path, id })
      index += 1
    },
  }
  return harness
}

describe("nav-guard", () => {
  /**
   * Wire the guard like App.tsx does: accepted pops update the rendered
   * path (the guarded entry), canceled pops leave it alone.
   */
  function setup(
    harness: ReturnType<typeof fakeHistory>,
    isBlocked: () => boolean,
  ) {
    let rendered = harness.locationPath()
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null),
      },
      {
        isBlocked,
        confirmLeave: () => false,
        getGuardedPath: () => rendered,
      },
    )
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId())) rendered = harness.locationPath()
    }
    return {
      guard,
      renderedPath: () => rendered,
      push: (path: string) => {
        harness.push(path, guard.tagPush())
        rendered = path
      },
    }
  }

  test("an unblocked pop is plain navigation", () => {
    const harness = fakeHistory("/config/plugins")
    const view = setup(harness, () => false)
    view.push("/config/keys")
    harness.back()
    expect(harness.locationPath()).toBe("/config/plugins")
    expect(view.renderedPath()).toBe("/config/plugins")
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/config/plugins",
      "/config/keys",
    ])
  })

  test("Back while dirty: the restore lands on the guarded entry, stack intact", () => {
    const harness = fakeHistory("/a")
    const view = setup(harness, () => true)
    view.push("/b")
    // User presses Back; the guard re-enters /b with go(+1).
    harness.back()
    expect(harness.locationPath()).toBe("/b")
    expect(view.renderedPath()).toBe("/b")
    expect(harness.index).toBe(1)
    // No duplicate entry was pushed and nothing was truncated.
    expect(harness.entries.map((entry) => entry.path)).toEqual(["/a", "/b"])
  })

  test("Forward while dirty: the restore goes back — never a jump to the next entry", () => {
    // /a, /b, /c, /d — the user is ON /b (earlier pops accepted), types
    // something, clicks Forward to /c and cancels. The old forward-only
    // restore landed on /d.
    const harness = fakeHistory("/a")
    let blocked = false
    const view = setup(harness, () => blocked)
    view.push("/b")
    view.push("/c")
    view.push("/d")
    harness.back() // accepted: rendered /c
    harness.back() // accepted: rendered /b
    blocked = true
    harness.forward() // Forward to /c, canceled by the guard
    expect(harness.locationPath()).toBe("/b")
    expect(view.renderedPath()).toBe("/b")
    expect(harness.index).toBe(1)
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/a",
      "/b",
      "/c",
      "/d",
    ])
    // /c and /d are still ahead: history was never truncated.
    blocked = false
    harness.forward()
    expect(harness.locationPath()).toBe("/c")
  })

  test("a multi-entry Back jump is accepted when clean, canceled when dirty", () => {
    const harness = fakeHistory("/a")
    let blocked = false
    const view = setup(harness, () => blocked)
    view.push("/b")
    view.push("/c")
    view.push("/d")
    // go(-2): /d -> /b in one pop, accepted while clean.
    harness.go(-2)
    expect(harness.locationPath()).toBe("/b")
    expect(view.renderedPath()).toBe("/b")
    // Now dirty: another multi-entry jump is canceled and lands back on
    // the guarded entry exactly.
    blocked = true
    harness.go(2) // /b -> /d, canceled -> restore to /b
    expect(harness.locationPath()).toBe("/b")
    expect(view.renderedPath()).toBe("/b")
    expect(harness.index).toBe(1)
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/a",
      "/b",
      "/c",
      "/d",
    ])
  })

  test("a canceled multi-entry Back jump restores the guarded entry exactly", () => {
    const harness = fakeHistory("/a")
    const view = setup(harness, () => true)
    view.push("/b")
    view.push("/c")
    view.push("/d")
    harness.go(-2) // blocked: restored to /d
    expect(harness.locationPath()).toBe("/d")
    // Another deep jump (to the tagged /b) cancels and restores exactly.
    harness.go(-2)
    expect(harness.locationPath()).toBe("/d")
    expect(view.renderedPath()).toBe("/d")
    expect(harness.index).toBe(3)
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/a",
      "/b",
      "/c",
      "/d",
    ])
  })

  test("the echo popstate from the restore is consumed, not treated as navigation", () => {
    const harness = fakeHistory("/a")
    let navigations = 0
    let rendered = "/a"
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => false,
        getGuardedPath: () => rendered,
      },
    )
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId())) {
        navigations += 1
        rendered = harness.locationPath()
      }
    }
    harness.push("/b", guard.tagPush())
    rendered = "/b"
    harness.back()
    // The Back pop was canceled and the go(+1) echo consumed: the caller
    // saw zero navigations and the view never left the guarded page.
    expect(navigations).toBe(0)
    expect(harness.locationPath()).toBe("/b")
    // Same for a canceled Forward.
    harness.push("/c", guard.tagPush())
    harness.push("/d", guard.tagPush())
    harness.go(-2)
    harness.forward()
    expect(navigations).toBe(0)
    expect(harness.locationPath()).toBe("/d")
  })

  test("confirming the leave lets navigation proceed", () => {
    const harness = fakeHistory("/config/keys")
    let navigations = 0
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => true,
        getGuardedPath: () => "/config/plugins",
      },
    )
    harness.push("/config/plugins", guard.tagPush())
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId())) navigations += 1
    }
    harness.back()
    expect(harness.locationPath()).toBe("/config/keys")
    expect(navigations).toBe(1)
  })

  test("an untagged incoming entry falls back to the one-step Back restore", () => {
    const harness = fakeHistory("/old")
    const view = setup(harness, () => true)
    view.push("/b")
    // An entry from before the shell mounted has no id.
    harness.back()
    expect(harness.locationPath()).toBe("/b")
    expect(view.renderedPath()).toBe("/b")
  })

  test("when the restore has no entry, the fallback pushState holds the path", () => {
    const harness = fakeHistory("/config/keys")
    // Single entry: any canceled pop has no entry to return with. The pop
    // landed on "/config/keys" while the guard holds "/config/plugins", so
    // the settle fallback must pushState the guarded path.
    const pending: { settle: (() => void) | null } = { settle: null }
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path: string) => harness.push(path, null),
        schedule: (callback) => {
          pending.settle = callback
          return () => {
            pending.settle = null
          }
        },
      },
      {
        isBlocked: () => true,
        confirmLeave: () => false,
        getGuardedPath: () => "/config/plugins",
      },
    )
    guard.onPop(null)
    // The schedule seam captured the settle check synchronously.
    pending.settle?.()
    expect(harness.locationPath()).toBe("/config/plugins")
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/config/keys",
      "/config/plugins",
    ])
  })

  test("reset drops pending echo state", () => {
    const harness = fakeHistory("/config/keys")
    harness.push("/config/plugins", 1)
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => false,
        getGuardedPath: () => "/config/plugins",
      },
    )
    expect(() => guard.reset()).not.toThrow()
  })

  test("replace keeps the current entry's id stable, pushes move it forward", () => {
    const harness = fakeHistory("/a")
    const view = setup(harness, () => false)
    const first = view.guard.tagReplace()
    const second = view.guard.tagReplace()
    expect(first).toBe(second)
    view.push("/b")
    expect(harness.entries[1].id).toBeGreaterThan(first)
  })
})
