/**
 * Cancelable popstate for forms with unsaved changes — in BOTH directions,
 * exact across multi-entry jumps.
 *
 * A popstate cannot be prevented — the location has already changed when
 * the event fires. The guard tags every entry the shell pushes with a
 * monotonic id carried in history.state (`ob`), so a pop announces both
 * its direction and its distance: incoming id below the current one is a
 * Back, above is a Forward. A canceled pop re-enters the guarded entry
 * with history.go(currentId - incomingId) — a single, exactly-aimed
 * traversal that fires one echo popstate and lands on the guarded entry
 * whether the user stepped one entry or jumped several. The old
 * forward-only restore walked the user even further ahead on a canceled
 * Forward and overshot multi-entry jumps.
 *
 * Untagged entries (history from before the shell mounted) have no id: the
 * pop is treated as a one-step Back and uses the forward() restore, with a
 * settle check falling back to pushState when no echo arrives (fresh tab,
 * history edge). An echo flag consumes the popstate our own restore fires,
 * so nothing oscillates. The id only rides along in App's
 * pushState/replaceState payloads — any other history.state fields on the
 * guarded entry are untouched.
 */

export type NavGuardHarness = {
  locationPath: () => string
  /** Move exactly `delta` entries (history.go) — one echo popstate. */
  go: (delta: number) => void
  /** Untagged fallback restores (one step). */
  forward: () => void
  pushState: (path: string) => void
  /** Test seam; defaults to setTimeout. */
  schedule?: (callback: () => void, ms: number) => () => void
}

export type NavGuardOptions = {
  /** True while the page holds unsaved changes. */
  isBlocked: () => boolean
  /**
   * Asked only when blocked. True = the user accepted leaving; false = stay,
   * cancel the pop.
   */
  confirmLeave: () => boolean
  /** The entry to hold when a pop is canceled (the app's current path). */
  getGuardedPath: () => string
}

/** How long to wait for the echo popstate before considering the restore a no-op. */
export const ECHO_SETTLE_MS = 80

export type PopGuard = {
  /**
   * Feed one popstate. Pass the incoming entry's id (history.state.ob) or
   * null when the entry is untagged. True = consumed (restore in flight or
   * echo); the caller must not treat it as navigation.
   */
  onPop(incomingId: number | null): boolean
  /** Call when the shell pushes a new entry; returns the id to store. */
  tagPush(): number
  /** Call when the shell replaces the current entry; returns the id to store. */
  tagReplace(): number
  /** Drop any pending echo (unmount, route resolved by other means). */
  reset(): void
}

export function createPopGuard(
  harness: NavGuardHarness,
  options: NavGuardOptions,
): PopGuard {
  const schedule =
    harness.schedule ??
    ((callback: () => void, ms: number) => {
      const id = setTimeout(callback, ms)
      return () => clearTimeout(id)
    })
  let echoArmed = false
  let cancelEcho: (() => void) | null = null
  // Id of the entry the app currently renders. 0 = unknown (untagged).
  let currentId = 0
  let counter = 0

  /** The next popstate is the echo of our own restore — consume it. */
  function onPop(incomingId: number | null) {
    if (echoArmed) {
      disarmEcho()
      if (incomingId) currentId = incomingId
      return true // consumed; the caller must not treat this as navigation
    }
    // The guarded entry is where the app rendered before this pop —
    // capture it before the pop's own entry becomes current.
    const guardedId = currentId
    if (incomingId) currentId = incomingId
    if (!options.isBlocked()) return false
    if (options.confirmLeave()) return false
    echoArmed = true
    if (incomingId != null && guardedId !== 0 && incomingId !== guardedId) {
      // Tagged: one exact traversal back to the guarded entry — +n after a
      // Back (any depth), -n after a Forward. history.go fires a single
      // echo popstate and truncates nothing.
      harness.go(guardedId - incomingId)
    } else {
      // Untagged (pre-shell entry): assume the common Back case.
      harness.forward()
    }
    const target = options.getGuardedPath()
    cancelEcho = schedule(() => {
      const echoed = echoArmed
      disarmEcho()
      // The restore never fired (no adjacent entry — fresh tab, history
      // edge): rebuild the guarded entry.
      if (echoed && harness.locationPath() !== target) harness.pushState(target)
    }, ECHO_SETTLE_MS)
    return true
  }

  function disarmEcho() {
    echoArmed = false
    cancelEcho?.()
    cancelEcho = null
  }

  return {
    onPop,
    tagPush() {
      currentId = ++counter
      return currentId
    },
    tagReplace() {
      if (!currentId) currentId = ++counter
      return currentId
    },
    reset() {
      disarmEcho()
    },
  }
}
