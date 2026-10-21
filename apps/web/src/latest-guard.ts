/**
 * Token guard for async work that must only apply while it is still the
 * latest attempt. A fetch started, then overtaken by a newer one (thread
 * switch, reconnect, debounce), resolves with a stale token the caller
 * discards instead of painting — the classic race where a slow response
 * for the previous thread overwrites the newly opened one.
 */
export type LatestGuard = {
  begin: () => number
  isCurrent: (token: number) => boolean
}

export function createLatestGuard(): LatestGuard {
  let counter = 0
  return {
    begin: () => {
      counter += 1
      return counter
    },
    isCurrent: (token: number) => token === counter,
  }
}
