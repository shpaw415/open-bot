import { describe, expect, test } from "bun:test"
import { createPopGuard } from "./nav-guard"

/**
 * A fake history: entries + index like the real stack, each entry carrying
 * the tags the shell stores in history.state (`ob` id + `obPos` position).
 * Traversals fire popstate synchronously (the browser fires it async; the
 * guard must survive both orders — the sync case is the stricter one).
 */
function fakeHistory(initial: string) {
  const entries: {
    path: string
    id: number | null
    pos: number | null
  }[] = [{ path: initial, id: null, pos: null }]
  let index = 0
  const harness = {
    entries,
    get index() {
      return index
    },
    onPop: undefined as (() => void) | undefined,
    locationPath: () => entries[index].path,
    incomingId: () => entries[index].id,
    incomingPos: () => entries[index].pos,
    go: (delta: number) => {
      const next = index + delta
      if (next < 0 || next >= entries.length) return
      index = next
      harness.onPop?.()
    },
    forward: () => harness.go(1),
    back: () => harness.go(-1),
    /** Shell-style push: truncates ahead, stores the guard-issued tags. */
    push: (path: string, id: number | null, pos: number | null) => {
      entries.splice(index + 1)
      entries.push({ path, id, pos })
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
        pushState: (path) => harness.push(path, null, null),
      },
      {
        isBlocked,
        confirmLeave: () => false,
        getGuardedPath: () => rendered,
      },
    )
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId(), harness.incomingPos()))
        rendered = harness.locationPath()
    }
    return {
      guard,
      renderedPath: () => rendered,
      /** Shell-style push: next position, guard-issued id. */
      push: (path: string) => {
        harness.push(path, guard.tagPush(harness.index + 1), harness.index + 1)
        rendered = path
      },
    }
  }

  /**
   * Same wiring plus the boot tag App.tsx writes (replaceState {ob, obPos:0}
   * on the entry the tab booted on) — every entry tagged, like the real app.
   */
  function setupTagged(
    harness: ReturnType<typeof fakeHistory>,
    isBlocked: () => boolean,
  ) {
    const view = setup(harness, isBlocked)
    harness.entries[0].id = view.guard.tagReplace(0)
    harness.entries[0].pos = 0
    return view
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
        pushState: (path) => harness.push(path, null, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => false,
        getGuardedPath: () => rendered,
      },
    )
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId(), harness.incomingPos())) {
        navigations += 1
        rendered = harness.locationPath()
      }
    }
    harness.push("/b", guard.tagPush(1), 1)
    rendered = "/b"
    harness.back()
    // The Back pop was canceled and the go(+1) echo consumed: the caller
    // saw zero navigations and the view never left the guarded page.
    expect(navigations).toBe(0)
    expect(harness.locationPath()).toBe("/b")
    // Same for a canceled Forward.
    harness.push("/c", guard.tagPush(2), 2)
    harness.push("/d", guard.tagPush(3), 3)
    harness.go(-2)
    harness.forward()
    expect(navigations).toBe(0)
    expect(harness.locationPath()).toBe("/d")
  })

  test("a canceled Back after a Forward-branch fork lands on the guarded entry, not the old branch", () => {
    // /a → /b → /c, Back to /a (accepted). A new push truncates the old
    // Forward branch, so stack ids are no longer contiguous: [1, 4, 5, 6].
    // The view /d goes dirty; Back to /a is refused. Id arithmetic (4-1=3)
    // overshoots to /f; the position difference (1-0=1) lands on /d.
    const harness = fakeHistory("/a")
    let blocked = false
    const view = setupTagged(harness, () => blocked)
    view.push("/b")
    view.push("/c")
    harness.back()
    harness.back() // accepted twice: rendered /a
    view.push("/d")
    view.push("/e")
    view.push("/f")
    harness.back()
    harness.back() // accepted: rendered /d
    blocked = true
    harness.back() // Back to /a, canceled by the guard
    expect(harness.locationPath()).toBe("/d")
    expect(view.renderedPath()).toBe("/d")
    expect(harness.index).toBe(1)
    expect(harness.entries.map((entry) => entry.path)).toEqual([
      "/a",
      "/d",
      "/e",
      "/f",
    ])
    // /a is still behind: history was never truncated.
    blocked = false
    harness.back()
    expect(harness.locationPath()).toBe("/a")
  })

  test("a canceled Forward after a fork goes back to the guarded entry", () => {
    const harness = fakeHistory("/a")
    let blocked = false
    const view = setupTagged(harness, () => blocked)
    view.push("/b")
    view.push("/c")
    harness.back()
    harness.back() // rendered /a
    view.push("/d")
    view.push("/e")
    harness.back() // rendered /d
    blocked = true
    harness.forward() // Forward to /e, canceled
    expect(harness.locationPath()).toBe("/d")
    expect(view.renderedPath()).toBe("/d")
    expect(harness.index).toBe(1)
    // /e is still ahead.
    blocked = false
    harness.forward()
    expect(harness.locationPath()).toBe("/e")
  })

  test("a multi-entry jump across a fork restores exactly", () => {
    const harness = fakeHistory("/a")
    let blocked = false
    const view = setupTagged(harness, () => blocked)
    view.push("/b")
    harness.back() // rendered /a
    view.push("/d")
    view.push("/e")
    view.push("/f")
    blocked = true
    harness.go(-3) // /f -> /a in one pop, canceled
    expect(harness.locationPath()).toBe("/f")
    expect(view.renderedPath()).toBe("/f")
    expect(harness.index).toBe(3)
  })

  test("entries with ids but missing positions fall back to the id difference", () => {
    // A state write that carried the id but no position (an older shell, a
    // partial tag): the restore is best effort via guardedId - incomingId,
    // exact while ids are contiguous.
    const harness = fakeHistory("/a")
    let rendered = "/a"
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => false,
        getGuardedPath: () => rendered,
      },
    )
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId(), harness.incomingPos()))
        rendered = harness.locationPath()
    }
    harness.entries[0].id = guard.tagReplace(0)
    harness.push("/b", guard.tagPush(1), null)
    rendered = "/b"
    harness.back()
    expect(harness.locationPath()).toBe("/b")
    expect(rendered).toBe("/b")
  })

  test("confirming the leave lets navigation proceed", () => {
    const harness = fakeHistory("/config/keys")
    let navigations = 0
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null, null),
      },
      {
        isBlocked: () => true,
        confirmLeave: () => true,
        getGuardedPath: () => "/config/plugins",
      },
    )
    harness.push("/config/plugins", guard.tagPush(1), 1)
    harness.onPop = () => {
      if (!guard.onPop(harness.incomingId(), harness.incomingPos()))
        navigations += 1
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
        pushState: (path: string) => harness.push(path, null, null),
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
    guard.onPop(null, null)
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
    harness.push("/config/plugins", 1, null)
    const guard = createPopGuard(
      {
        locationPath: harness.locationPath,
        go: harness.go,
        forward: harness.forward,
        pushState: (path) => harness.push(path, null, null),
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
    const first = view.guard.tagReplace(0)
    const second = view.guard.tagReplace(0)
    expect(first).toBe(second)
    view.push("/b")
    expect(harness.entries[1].id).toBeGreaterThan(first)
  })
})
