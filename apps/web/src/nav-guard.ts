/**
 * Cancelable popstate for forms with unsaved changes — in BOTH directions,
 * exact across multi-entry jumps AND across Forward-branch truncation.
 *
 * A popstate cannot be prevented — the location has already changed when
 * the event fires. The shell tags every entry it pushes/replaces with two
 * values carried in history.state:
 *
 * - `ob` — a monotonic id. Identity only: it marks entries as tagged and
 *   gives the echo of our own restore something to update from.
 * - `obPos` — the entry's traversal position in the history stack, counted
 *   by the shell (0 for the boot entry, +1 per push). Position, not id,
 *   is the traversal distance: after a canceled pop truncates nothing but
 *   a new push truncates the old Forward branch, ids along the remaining
 *   stack are no longer contiguous ([1, 4, 5, 6]) and an id difference is
 *   NOT the travel distance — a canceled Back then restored several entries
 *   too far (URL /f, view /d). The position difference is exact by
 *   construction: history.go(posDelta) re-enters the guarded entry with a
 *   single echo popstate whether the user stepped one entry or jumped
 *   several, in either direction.
 *
 * A canceled pop re-enters the guarded entry with that one aimed go().
 * Untagged entries (history from before the shell mounted, or entries the
 * guard's own settle fallback had to rebuild) have no values: the pop is
 * treated as a one-step Back and uses the forward() restore, with a settle
 * check falling back to pushState when no echo arrives (fresh tab, history
 * edge). An echo flag consumes the popstate our own restore fires, so
 * nothing oscillates. Any other history.state fields on an entry ride
 * along untouched — the shell only adds/updates `ob` and `obPos`.
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
   * Feed one popstate. Pass the incoming entry's id (`history.state.ob`) and
   * its traversal position (`history.state.obPos`), both null when the entry
   * is untagged. True = consumed (restore in flight or echo); the caller
   * must not treat it as navigation.
   */
  onPop(incomingId: number | null, incomingPos: number | null): boolean
  /**
   * Call when the shell pushes a new entry. `pos` is the new entry's
   * traversal position (the current position + 1). Returns the id to store.
   */
  tagPush(pos: number): number
  /**
   * Call when the shell replaces the current entry. `pos` is the current
   * entry's position. Returns the id to store.
   */
  tagReplace(pos: number): number
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
  // Identity (id) and traversal position (pos) of the entry the app
  // currently renders. 0/null = unknown (untagged).
  let currentId = 0
  let currentPos: number | null = null
  let counter = 0

  /** The next popstate is the echo of our own restore — consume it. */
  function onPop(incomingId: number | null, incomingPos: number | null) {
    if (echoArmed) {
      disarmEcho()
      if (incomingId) currentId = incomingId
      if (incomingPos != null) currentPos = incomingPos
      return true // consumed; the caller must not treat this as navigation
    }
    // The guarded entry is where the app rendered before this pop —
    // capture it before the pop's own entry becomes current.
    const guardedId = currentId
    const guardedPos = currentPos
    if (incomingId) currentId = incomingId
    if (incomingPos != null) currentPos = incomingPos
    if (!options.isBlocked()) return false
    if (options.confirmLeave()) return false
    echoArmed = true
    if (
      guardedPos != null &&
      incomingPos != null &&
      incomingPos !== guardedPos
    ) {
      // Tagged with positions: one exact traversal back to the guarded
      // entry — +n after a Back (any depth, any branching), -n after a
      // Forward. history.go fires a single echo popstate and truncates
      // nothing.
      harness.go(guardedPos - incomingPos)
    } else if (
      incomingId != null &&
      guardedId !== 0 &&
      incomingId !== guardedId
    ) {
      // Ids but no positions (a session partly tagged by an older shell):
      // fall back to the id difference — exact while ids are contiguous.
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
    tagPush(pos: number) {
      currentId = ++counter
      currentPos = pos
      return currentId
    },
    tagReplace(pos: number) {
      if (!currentId) currentId = ++counter
      currentPos = pos
      return currentId
    },
    reset() {
      disarmEcho()
    },
  }
}
