/**
 * Cancelable popstate for forms with unsaved changes.
 *
 * A popstate cannot be prevented — the location has already changed when the
 * event fires. The classic cancel (pushState back) truncates the forward
 * stack and adds a duplicate entry. This guard instead re-enters the current
 * entry with history.forward(), which restores the position without
 * truncation or duplicates when the user pressed Back. If forward() had no
 * entry to return to (rare: canceled Forward, fresh tab), a settle check
 * falls back to pushState. An echo flag consumes the popstate that forward()
 * itself fires, so nothing oscillates.
 */

export type NavGuardHarness = {
  locationPath: () => string
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

/** How long to wait for the echo popstate before considering forward() a no-op. */
export const ECHO_SETTLE_MS = 80

export function createPopGuard(
  harness: NavGuardHarness,
  options: NavGuardOptions,
) {
  const schedule =
    harness.schedule ??
    ((callback: () => void, ms: number) => {
      const id = setTimeout(callback, ms)
      return () => clearTimeout(id)
    })
  let echoArmed = false
  let cancelEcho: (() => void) | null = null

  /** The next popstate is the echo of our own forward() — consume it. */
  function onPop() {
    if (echoArmed) {
      disarmEcho()
      return true // consumed; the caller must not treat this as navigation
    }
    if (!options.isBlocked()) return false
    if (options.confirmLeave()) return false
    // Cancel: return to the guarded entry via forward (Back case). If the
    // echo never arrives, forward() had no next entry — restore by pushState.
    const target = options.getGuardedPath()
    echoArmed = true
    harness.forward()
    cancelEcho = schedule(() => {
      const echoed = echoArmed
      disarmEcho()
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
    /** Drop any pending echo (unmount, route resolved by other means). */
    reset() {
      disarmEcho()
    },
  }
}
