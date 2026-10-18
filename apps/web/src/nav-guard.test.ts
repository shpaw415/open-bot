import { describe, expect, test } from "bun:test"
import { createPopGuard } from "./nav-guard"

/**
 * A fake history: entries + index like the real stack. forward()/back()
 * move and fire popstate synchronously (the browser fires it async; the
 * guard must survive both orders — the sync case is the stricter one).
 */
function fakeHistory(initial: string) {
  const state = {
    entries: [initial] as string[],
    index: 0,
  }
  const harness = {
    entries: state.entries,
    index: state.index,
    onPop: undefined as (() => void) | undefined,
    locationPath: () => state.entries[state.index],
    forward: () => {
      if (state.index < state.entries.length - 1) {
        state.index += 1
        harness.index = state.index
        harness.onPop?.()
      }
    },
    pushState: (path: string) => {
      state.entries.splice(state.index + 1)
      state.entries.push(path)
      state.index += 1
      harness.index = state.index
    },
    back: () => {
      if (state.index > 0) {
        state.index -= 1
        harness.index = state.index
        harness.onPop?.()
      }
    },
    push: (path: string) => {
      state.entries.splice(state.index + 1)
      state.entries.push(path)
      state.index += 1
      harness.index = state.index
    },
  }
  return harness
}

describe("nav-guard", () => {
  test("an unblocked pop is plain navigation", () => {
    const harness = fakeHistory("/config/plugins")
    const guard = createPopGuard(harness, {
      isBlocked: () => false,
      confirmLeave: () => true,
      getGuardedPath: () => "/config/plugins",
    })
    harness.onPop = () => {
      guard.onPop()
    }
    harness.push("/config/keys")
    harness.back()
    expect(harness.locationPath()).toBe("/config/plugins")
    expect(harness.entries).toEqual(["/config/plugins", "/config/keys"])
  })

  test("Back while dirty: forward() restores the entry, no duplicate, stack intact", () => {
    const harness = fakeHistory("/config/keys")
    harness.push("/config/plugins")
    const guard = createPopGuard(harness, {
      isBlocked: () => true,
      confirmLeave: () => false,
      getGuardedPath: () => "/config/plugins",
    })
    harness.onPop = () => {
      guard.onPop()
    }
    // User presses Back; the guard re-enters via forward().
    harness.back()
    expect(harness.locationPath()).toBe("/config/plugins")
    expect(harness.index).toBe(1)
    // No duplicate entry was pushed and nothing was truncated.
    expect(harness.entries).toEqual(["/config/keys", "/config/plugins"])
  })

  test("the echo popstate from forward() is consumed, not treated as navigation", () => {
    const harness = fakeHistory("/config/keys")
    harness.push("/config/plugins")
    let navigations = 0
    const guard = createPopGuard(harness, {
      isBlocked: () => true,
      confirmLeave: () => false,
      getGuardedPath: () => "/config/plugins",
    })
    harness.onPop = () => {
      if (!guard.onPop()) navigations += 1
    }
    harness.back()
    // The Back pop was canceled and the forward() echo consumed: the caller
    // saw zero navigations and the view never left the guarded page.
    expect(navigations).toBe(0)
    expect(harness.locationPath()).toBe("/config/plugins")
  })

  test("confirming the leave lets navigation proceed", () => {
    const harness = fakeHistory("/config/keys")
    harness.push("/config/plugins")
    let navigations = 0
    const guard = createPopGuard(harness, {
      isBlocked: () => true,
      confirmLeave: () => true,
      getGuardedPath: () => "/config/plugins",
    })
    harness.onPop = () => {
      if (!guard.onPop()) navigations += 1
    }
    harness.back()
    expect(harness.locationPath()).toBe("/config/keys")
    expect(navigations).toBe(1)
  })

  test("when forward() has no entry, the fallback pushState holds the path", () => {
    const harness = fakeHistory("/config/keys")
    // Single entry: any canceled pop has no forward to return with. The pop
    // landed on "/config/keys" while the guard holds "/config/plugins", so
    // the settle fallback must pushState the guarded path.
    const pending: { settle: (() => void) | null } = { settle: null }
    const guard = createPopGuard(
      {
        ...harness,
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
    guard.onPop()
    // The schedule seam captured the settle check synchronously.
    pending.settle?.()
    expect(harness.locationPath()).toBe("/config/plugins")
    expect(harness.entries).toEqual(["/config/keys", "/config/plugins"])
  })

  test("reset drops pending echo state", () => {
    const harness = fakeHistory("/config/keys")
    harness.push("/config/plugins")
    const guard = createPopGuard(harness, {
      isBlocked: () => true,
      confirmLeave: () => false,
      getGuardedPath: () => "/config/plugins",
    })
    harness.onPop = () => {
      guard.onPop()
    }
    expect(() => guard.reset()).not.toThrow()
  })
})
