import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

/**
 * App-like Back behavior: every user-opened layer (dialog, drawer, sheet,
 * lightbox, menu, viewer…) lives on the history stack, so the system Back
 * button / edge swipe / browser Back dismisses the topmost layer instead
 * of leaving the page — exactly like Escape, one layer at a time.
 *
 * Two cooperating mechanisms:
 *
 * 1. **Back layers** (this module's stack): opening a layer pushes one
 *    history entry on the SAME url whose state carries `obLayers` (the
 *    open layer tokens, stack order). Closing from the UI consumes that
 *    entry via `history.back()`; pressing Back closes the layer through
 *    the shell's popstate handler (`syncFromPop`). A chained swap (menu →
 *    submenu in one click) replaces the token on the current entry
 *    instead of stacking. Forward reopens layers that opt in (`reopen`,
 *    e.g. media viewers); stale transient tokens are stripped. Suspended
 *    layers (busy dialogs) ignore Back and re-arm their entry, mirroring
 *    `suspendEscape`.
 *
 * 2. **URL search state** for content navigation (open thread, media
 *    album/item, project, council, preview, cron editor…): plain query
 *    params via `patchSearch`/`pushSearch`, so Back/Forward/reload/share
 *    all restore the same screen. Layer entries sit on top of these, so
 *    Back first closes a dialog, then leaves the viewer, then the album.
 *
 * The shell (App.tsx) owns history tagging (`ob`/`obPos` for nav-guard)
 * and installs its host here at mount; without a shell (unit tests,
 * standalone renders) the default host drives `window.history` directly
 * and `useBackLayer` still works — with no `window` at all every call is
 * a no-op.
 */

export type LayerState = Record<string, unknown>

export type BackNavHost = {
  getState: () => unknown
  getUrl: () => string
  /** Push an entry carrying `state` (already shell-tagged by the host). */
  push: (patch: { obLayers: string[] }, url: string) => void
  replace: (patch: { obLayers: string[] }, url: string) => void
  back: () => void
  /** Shell page navigation (tagged push/replace + route state sync). */
  go?: (url: string) => void
  replaceUrl?: (url: string) => void
  /** True when an in-app entry sits below the current one. */
  canGoBackInApp?: () => boolean
  /**
   * No app shell drives pops for this host, so the stack listens to
   * popstate itself. The shell host leaves this unset (App.tsx calls
   * syncFromPop inside its own guarded popstate handler).
   */
  standalone?: boolean
}

export type LayerHandlers = {
  close: () => void
  /** Opt-in: Forward (or a history jump) back onto this layer reopens it. */
  reopen?: () => void
  /** True while dismissal must wait (busy save) — Back is ignored. */
  suspended?: () => boolean
}

/** Layer tokens recorded on a history entry, stack order. Never throws. */
export function layersOf(state: unknown): string[] {
  if (!state || typeof state !== "object") return []
  const raw = (state as { obLayers?: unknown }).obLayers
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === "string" && item && !out.includes(item)) out.push(item)
  }
  return out
}

export function splitUrl(url: string): { pathname: string; search: string } {
  const noHash = url.split("#")[0] ?? url
  const at = noHash.indexOf("?")
  if (at === -1) return { pathname: noHash || "/", search: "" }
  return { pathname: noHash.slice(0, at) || "/", search: noHash.slice(at) }
}

export function searchParam(search: string, name: string): string {
  return new URLSearchParams(search).get(name) ?? ""
}

/**
 * Apply a param patch to a search string: `null`/`""` removes, `undefined`
 * keeps. Returns "" or "?…".
 */
export function patchSearch(
  search: string,
  patch: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null || value === "") params.delete(key)
    else params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}

function isPrefix(prefix: string[], full: string[]): boolean {
  return (
    prefix.length <= full.length &&
    prefix.every((token, index) => full[index] === token)
  )
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => b[index] === token)
}

export type ReconcileAction = "push" | "back" | "replace" | "none"

/**
 * How to bring the current history entry (`entry`) in line with the layers
 * the UI actually shows (`desired`): one new top layer pushes, one closed
 * top layer consumes its entry with Back, anything else (swap, middle
 * removal, batch change) rewrites the current entry in place.
 */
export function planReconcile(
  desired: string[],
  entry: string[],
): ReconcileAction {
  if (sameTokens(desired, entry)) return "none"
  if (desired.length === entry.length + 1 && isPrefix(entry, desired))
    return "push"
  if (entry.length === desired.length + 1 && isPrefix(desired, entry))
    return "back"
  return "replace"
}

export type PopSyncPlan = {
  /** Open layers missing from the landed entry, top first. */
  close: string[]
  /** Landed-entry layers that opted into reopening, stack order. */
  reopen: string[]
  /** Landed-entry layers nobody will show again — strip from the entry. */
  strip: string[]
  /** Layers that refuse dismissal right now (busy). */
  blocked: string[]
}

export function planPopSync(input: {
  open: string[]
  entry: string[]
  reopenable: ReadonlySet<string>
  suspended: ReadonlySet<string>
}): PopSyncPlan {
  const entrySet = new Set(input.entry)
  const openSet = new Set(input.open)
  const close: string[] = []
  const blocked: string[] = []
  for (const token of [...input.open].reverse()) {
    if (entrySet.has(token)) continue
    if (input.suspended.has(token)) blocked.push(token)
    else close.push(token)
  }
  const reopen: string[] = []
  const strip: string[] = []
  for (const token of input.entry) {
    if (openSet.has(token)) continue
    if (input.reopenable.has(token)) reopen.push(token)
    else strip.push(token)
  }
  return { close, reopen, strip, blocked }
}

export type PopSyncResult = {
  closedCount: number
  reopenedCount: number
  /** Open layers that refused to close; their entry was re-armed. */
  blockedCount: number
}

/**
 * The layer stack. UI code reports desired state (`setOpen`); a deferred
 * reconciler turns desired-vs-entry diffs into at most one history
 * operation, which keeps StrictMode mount/unmount cycles and chained
 * open/close pairs from ever touching history twice.
 */
export class BackNavStack {
  #host: BackNavHost
  #defer: (fn: () => void) => void
  #settle: (fn: () => void) => void
  #handlers = new Map<string, LayerHandlers>()
  #open: string[] = []
  #entry: string[] = []
  #pendingPop: string[] | null = null
  #scheduled = false
  #listening = false
  #onPopState = () => {
    this.syncFromPop()
  }

  constructor(
    host: BackNavHost,
    opts?: {
      defer?: (fn: () => void) => void
      /** Macrotask used for the no-pop fallback; popstate is a task, so a
       * microtask would always win the race and clear the flag early. */
      settle?: (fn: () => void) => void
    },
  ) {
    this.#host = host
    this.#defer = opts?.defer ?? ((fn) => queueMicrotask(fn))
    this.#settle =
      opts?.settle ??
      opts?.defer ??
      ((fn) => {
        setTimeout(fn, 80)
      })
    this.#entry = layersOf(safeGetState(host))
    this.#updateListener()
  }

  setHost(host: BackNavHost) {
    this.#host = host
    this.#entry = layersOf(safeGetState(host))
    this.#updateListener()
  }

  #updateListener() {
    const want = Boolean(this.#host.standalone) && typeof window !== "undefined"
    if (want === this.#listening) return
    this.#listening = want
    if (want) window.addEventListener("popstate", this.#onPopState)
    else if (typeof window !== "undefined")
      window.removeEventListener("popstate", this.#onPopState)
  }

  host(): BackNavHost {
    return this.#host
  }

  register(token: string, handlers: LayerHandlers) {
    this.#handlers.set(token, handlers)
    // Test DOMs may register the window global after this module (and
    // its host) first evaluated; retry attaching on first real use.
    this.#updateListener()
  }

  updateHandlers(token: string, handlers: LayerHandlers) {
    if (this.#handlers.has(token)) this.#handlers.set(token, handlers)
  }

  unregister(token: string) {
    this.#handlers.delete(token)
    if (this.#open.includes(token)) {
      // The owner unmounted (or disabled itself, e.g. a panel that stops
      // being an overlay on resize): strip the token in place — never
      // traverse history for UI that no longer exists.
      this.#open = this.#open.filter((item) => item !== token)
      if (this.#entry.includes(token)) {
        this.#entry = this.#entry.filter((item) => item !== token)
        this.#host.replace({ obLayers: [...this.#entry] }, this.#host.getUrl())
      }
    }
  }

  openTokens(): string[] {
    return [...this.#open]
  }

  entryTokens(): string[] {
    return [...this.#entry]
  }

  /** Re-read the current entry after a shell push/replace outside layers. */
  syncEntry() {
    this.#entry = layersOf(safeGetState(this.#host))
  }

  setOpen(token: string, open: boolean) {
    const isOpen = this.#open.includes(token)
    if (open === isOpen) return
    this.#open = open
      ? [...this.#open, token]
      : this.#open.filter((item) => item !== token)
    this.#schedule()
  }

  /**
   * Close every layer without traversing history — page navigation is
   * about to push its own entry, and the layers' entries must not strand
   * tokens underneath it.
   */
  closeAllSilently() {
    if (this.#open.length === 0) return
    const closing = [...this.#open].reverse()
    this.#open = []
    this.#pendingPop = null
    if (this.#entry.length > 0) {
      this.#entry = []
      this.#host.replace({ obLayers: [] }, this.#host.getUrl())
    }
    for (const token of closing) this.#handlers.get(token)?.close()
  }

  /**
   * Feed one popstate (the shell calls this before its own route sync).
   * Applies closes/reopens for the landed entry and reports counts so the
   * shell can tell "Back only dismissed UI" from a real navigation.
   */
  syncFromPop(): PopSyncResult {
    const entry = layersOf(safeGetState(this.#host))
    this.#entry = entry
    if (this.#pendingPop && sameTokens(entry, this.#pendingPop)) {
      this.#pendingPop = null
      // A layer opened while our own Back was in flight still needs its
      // entry — reconcile paused for the pending pop.
      this.#schedule()
      return { closedCount: 0, reopenedCount: 0, blockedCount: 0 }
    }
    this.#pendingPop = null
    const reopenable = new Set<string>()
    const suspended = new Set<string>()
    for (const [token, handlers] of this.#handlers) {
      if (handlers.reopen) reopenable.add(token)
      if (handlers.suspended?.()) suspended.add(token)
    }
    const plan = planPopSync({
      open: this.#open,
      entry,
      reopenable,
      suspended,
    })
    for (const token of plan.close) this.#handlers.get(token)?.close()
    for (const token of plan.reopen) this.#handlers.get(token)?.reopen?.()
    if (plan.strip.length > 0 && !sameTokens(this.#open, entry)) {
      this.#entry = [...this.#open]
      this.#host.replace({ obLayers: [...this.#open] }, this.#host.getUrl())
    }
    if (plan.blocked.length > 0) this.#schedule()
    return {
      closedCount: plan.close.length,
      reopenedCount: plan.reopen.length,
      blockedCount: plan.blocked.length,
    }
  }

  #schedule() {
    if (this.#scheduled) return
    this.#scheduled = true
    this.#defer(() => {
      this.#scheduled = false
      this.#reconcile()
    })
  }

  #reconcile() {
    if (this.#pendingPop) return
    const action = planReconcile(this.#open, this.#entry)
    if (action === "none") return
    if (action === "push") {
      this.#entry = [...this.#open]
      this.#host.push({ obLayers: [...this.#open] }, this.#host.getUrl())
      return
    }
    if (action === "back") {
      this.#pendingPop = [...this.#open]
      this.#host.back()
      // Hosts without a pop to fire (history edge) leave the pending flag
      // set; clear it after the pop task had its chance so future layers
      // still reconcile.
      this.#settle(() => {
        if (this.#pendingPop && sameTokens(this.#pendingPop, this.#open)) {
          this.#pendingPop = null
          this.#entry = [...this.#open]
          this.#host.replace({ obLayers: [...this.#open] }, this.#host.getUrl())
        }
      })
      return
    }
    this.#entry = [...this.#open]
    this.#host.replace({ obLayers: [...this.#open] }, this.#host.getUrl())
  }
}

function safeGetState(host: BackNavHost): unknown {
  try {
    return host.getState()
  } catch {
    return null
  }
}

/** Default host: plain window.history (tests, shell-less renders). The
 * window lookup stays lazy: test DOMs register globals after module
 * evaluation, and a captured boolean would stay false forever. */
function browserHost(): BackNavHost {
  const win = () => (typeof window === "undefined" ? undefined : window)
  return {
    standalone: true,
    getState: () => win()?.history.state ?? null,
    getUrl: () => {
      const w = win()
      return w ? w.location.pathname + w.location.search : "/"
    },
    push: (patch, url) => {
      const w = win()
      w?.history.pushState({ ...(w.history.state ?? {}), ...patch }, "", url)
    },
    replace: (patch, url) => {
      const w = win()
      w?.history.replaceState({ ...(w.history.state ?? {}), ...patch }, "", url)
    },
    back: () => {
      win()?.history.back()
    },
    go: (url) => {
      const w = win()
      if (!w) return
      w.history.pushState({ obLayers: [] }, "", url)
      w.dispatchEvent(new PopStateEvent("popstate"))
      w.dispatchEvent(new CustomEvent("ob-navigate"))
    },
    replaceUrl: (url) => {
      const w = win()
      if (!w) return
      w.history.replaceState(w.history.state, "", url)
      w.dispatchEvent(new CustomEvent("ob-navigate"))
    },
    canGoBackInApp: () => {
      const w = win()
      if (!w) return false
      const pos = (w.history.state as { obPos?: unknown } | null)?.obPos
      return typeof pos === "number" && pos > 0
    },
  }
}

export const backNav = new BackNavStack(browserHost())

/** App shell mount point: swap in the tagged host, restore on unmount. */
export function installShellHost(host: BackNavHost): () => void {
  backNav.setHost(host)
  return () => backNav.setHost(browserHost())
}

let layerCounter = 0

/**
 * Bind one overlay's open flag to the back stack. `open` is the UI truth;
 * `onClose` is the exact handler Escape/backdrop already use, so Back,
 * Escape and the ✕ button can never disagree. Suspend mirrors
 * `suspendEscape` (busy dialogs ignore Back too).
 */
export function useBackLayer(
  open: boolean,
  onClose: () => void,
  opts?: {
    /** Stable debug-friendly name; a unique suffix is always appended. */
    name?: string
    reopen?: () => void
    suspend?: boolean
    enabled?: boolean
  },
) {
  const tokenRef = useRef<string>("")
  if (!tokenRef.current) {
    layerCounter += 1
    tokenRef.current = `${opts?.name ?? "layer"}:${layerCounter}`
  }
  const token = tokenRef.current
  const enabled = opts?.enabled !== false
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const reopenRef = useRef(opts?.reopen)
  reopenRef.current = opts?.reopen
  const suspendRef = useRef(Boolean(opts?.suspend))
  suspendRef.current = Boolean(opts?.suspend)

  useEffect(() => {
    if (!enabled) return
    backNav.register(token, {
      close: () => closeRef.current(),
      reopen: reopenRef.current ? () => reopenRef.current?.() : undefined,
      suspended: () => suspendRef.current,
    })
    // A layer that mounts already-open (deep link, conditional render)
    // joins the stack without pushing when its entry is already current:
    // setOpen + reconcile decides push vs none against the live entry.
    return () => backNav.unregister(token)
  }, [token, enabled])

  useEffect(() => {
    if (!enabled) return
    backNav.setOpen(token, open)
  }, [token, enabled, open])
}

/** Reactive `location.search` ("?…" or ""), refreshed on every navigation. */
export function useLocationSearch(): string {
  const [search, setSearch] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  )
  useEffect(() => {
    const sync = () => setSearch(window.location.search)
    sync()
    window.addEventListener("popstate", sync)
    window.addEventListener("ob-navigate", sync)
    return () => {
      window.removeEventListener("popstate", sync)
      window.removeEventListener("ob-navigate", sync)
    }
  }, [])
  return search
}

/**
 * Navigate within the current page by patching query params — the content
 * half of the app stack (thread, album, item, council…). Push by default
 * (Back returns to the previous screen); `replace` for paging/swaps that
 * must not stack (viewer prev/next, IDE file switches). Returns false
 * when the URL already says the same thing.
 */
export function pushSearch(
  patch: Record<string, string | null | undefined>,
  opts?: { replace?: boolean; pathname?: string },
): boolean {
  if (typeof window === "undefined") return false
  const pathname = opts?.pathname ?? window.location.pathname
  const next = pathname + patchSearch(window.location.search, patch)
  const current = window.location.pathname + window.location.search
  if (next === current) return false
  const host = backNav.host()
  if (opts?.replace) {
    if (host.replaceUrl) host.replaceUrl(next)
    else host.replace({ obLayers: backNav.entryTokens() }, next)
  } else if (host.go) {
    host.go(next)
  } else {
    host.push({ obLayers: [] }, next)
  }
  return true
}

/** Current full URL (pathname+search) through the active host. */
export function currentUrl(): string {
  return backNav.host().getUrl()
}

/**
 * In-app "Back/Close" for URL-backed screens: traverse to the entry the
 * user actually came from when one exists in this tab's app stack, else
 * navigate to the parent URL (fresh deep link — Forward then returns).
 */
export function backOr(fallbackUrl: string) {
  const host = backNav.host()
  if (host.canGoBackInApp?.()) host.back()
  else if (host.go) host.go(fallbackUrl)
  else host.push({ obLayers: [] }, fallbackUrl)
}

/**
 * Pane-scoped URL state for the global split screen (split.ts). Views
 * that keep screens in query params read and write *their pane's* URL
 * through this instead of `location` directly: the primary pane (and
 * every unsplit render — unit tests included) gets the real address,
 * byte-for-byte today's behavior, while the shell provides the second
 * pane a value whose reads come from the decoded `?split=` URL and
 * whose writes rewrite only that param, pushing the next pair entry.
 */
export type PaneNav = {
  /** This pane's pathname. */
  pathname: string
  /** This pane's search string ("?…" or ""). */
  search: string
  pushSearch: (
    patch: Record<string, string | null | undefined>,
    opts?: { replace?: boolean; pathname?: string },
  ) => boolean
  backOr: (fallbackUrl: string) => void
  /**
   * The pane that owns one-instance global behaviors (the open-thread
   * window event, notice focus): the only pane when unsplit, the
   * focused pane in a split. Inactive panes must not answer globals.
   */
  active: boolean
}

export const PaneNavContext = createContext<PaneNav | null>(null)

/** Reactive `location.pathname`, refreshed on every navigation. */
function useLocationPathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  )
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname)
    sync()
    window.addEventListener("popstate", sync)
    window.addEventListener("ob-navigate", sync)
    return () => {
      window.removeEventListener("popstate", sync)
      window.removeEventListener("ob-navigate", sync)
    }
  }, [])
  return pathname
}

/**
 * This pane's URL-state access; see {@link PaneNav}. The returned
 * `pushSearch`/`backOr` are identity-stable and always dispatch to the
 * latest pane value, so memoized callbacks that captured the old module
 * functions keep their exact live-location semantics in either pane.
 */
export function usePaneNav(): PaneNav {
  const pane = useContext(PaneNavContext)
  const search = useLocationSearch()
  const pathname = useLocationPathname()
  const current: PaneNav = pane ?? {
    pathname,
    search,
    pushSearch,
    backOr,
    active: true,
  }
  const latest = useRef(current)
  latest.current = current
  const stablePushSearch = useCallback<PaneNav["pushSearch"]>(
    (patch, opts) => latest.current.pushSearch(patch, opts),
    [],
  )
  const stableBackOr = useCallback<PaneNav["backOr"]>(
    (fallbackUrl) => latest.current.backOr(fallbackUrl),
    [],
  )
  return {
    pathname: current.pathname,
    search: current.search,
    pushSearch: stablePushSearch,
    backOr: stableBackOr,
    active: current.active,
  }
}
