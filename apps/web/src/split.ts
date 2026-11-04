import { type PaneNav, patchSearch, searchParam, splitUrl } from "./back-nav"
import { PARAM_SPLIT } from "./routes"

/**
 * Global split screen URL model. The primary (left) pane keeps the real
 * address untouched — pathname plus its own search params, exactly as
 * single-page navigation has always worked. The second pane's complete
 * URL (pathname + search) rides along, encoded, in one extra param
 * (`?split=`), so the pair is shareable and Back/Forward/reload restore
 * both panes like every other app screen. Each history entry therefore
 * names a *pair*; navigating either pane pushes the next pair.
 *
 * A pane URL can never itself carry `split` — it is stripped on the way
 * in and out — so panes cannot nest.
 */

/** Pane URLs past this are junk (or an attack), never a real screen. */
export const MAX_PANE_URL = 2048

export const SPLIT_RATIO_KEY = "ob-split-ratio"
/** Last second-pane URL, so reopening the split restores the pairing. */
export const SPLIT_LAST_KEY = "ob-split-last"

function normalizePaneUrl(url: string): string | null {
  if (!url || url.length > MAX_PANE_URL) return null
  if (!url.startsWith("/") || url.startsWith("//")) return null
  const { pathname, search } = splitUrl(url)
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null
  return pathname + patchSearch(search, { [PARAM_SPLIT]: null })
}

/** The second pane's URL named by a search string, or null when unsplit. */
export function parseSplit(search: string): string | null {
  const raw = searchParam(search, PARAM_SPLIT)
  if (!raw) return null
  return normalizePaneUrl(raw)
}

/**
 * The pair URL for `primaryUrl` beside `secondaryUrl`. Passing null (or
 * an invalid pane URL) returns the primary alone — closing the split.
 */
export function buildSplitUrl(
  primaryUrl: string,
  secondaryUrl: string | null,
): string {
  const { pathname, search } = splitUrl(primaryUrl)
  const secondary = secondaryUrl ? normalizePaneUrl(secondaryUrl) : null
  return pathname + patchSearch(search, { [PARAM_SPLIT]: secondary })
}

/** `url` with any second pane removed. */
export function stripSplit(url: string): string {
  return buildSplitUrl(url, null)
}

/**
 * The second pane's {@link PaneNav}: reads come from its decoded URL,
 * writes rewrite only the `?split=` param on the live address (pushing
 * the next pair entry; `replace` swaps in place like the primary's).
 * `backOr` pushes the fallback as the pane's next screen — pair entries
 * are the history, so Back then walks this pane's screens without ever
 * traversing the primary's. Every write re-reads the live address, so
 * a value captured by an old render can never resurrect a stale pair.
 */
export function buildSecondaryPaneNav(
  secondaryUrl: string,
  active: boolean,
  nav: {
    getUrl: () => string
    go: (url: string) => void
    replace: (url: string) => void
  },
): PaneNav {
  const here = splitUrl(secondaryUrl)
  return {
    pathname: here.pathname,
    search: here.search,
    active,
    pushSearch: (patch, opts) => {
      const currentUrl = nav.getUrl()
      const currentSecondary = parseSplit(splitUrl(currentUrl).search)
      if (!currentSecondary) return false
      const current = splitUrl(currentSecondary)
      const pathname = opts?.pathname ?? current.pathname
      const nextSecondary = pathname + patchSearch(current.search, patch)
      if (nextSecondary === currentSecondary) return false
      const pair = buildSplitUrl(currentUrl, nextSecondary)
      if (opts?.replace) nav.replace(pair)
      else nav.go(pair)
      return true
    },
    backOr: (fallbackUrl) => {
      nav.go(buildSplitUrl(nav.getUrl(), fallbackUrl))
    },
  }
}

export const SPLIT_RATIO_DEFAULT = 0.5
const SPLIT_RATIO_MIN = 0.25
const SPLIT_RATIO_MAX = 0.75

/** Primary pane's share of the split row, kept usable at both ends. */
export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value))
}
