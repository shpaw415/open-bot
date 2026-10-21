import { useEffect, useRef } from "react"

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Topmost-only Escape for stacked overlays (dialog over drawer over dialog):
 * each open overlay registers on a module-level stack and only the top one
 * handles Escape. Pure bookkeeping, unit-tested without a DOM.
 */
const overlayStack: symbol[] = []

export function registerOverlay(id: symbol) {
  overlayStack.push(id)
}

export function unregisterOverlay(id: symbol) {
  const index = overlayStack.lastIndexOf(id)
  if (index !== -1) overlayStack.splice(index, 1)
}

export function isTopOverlay(id: symbol): boolean {
  return overlayStack.length > 0 && overlayStack[overlayStack.length - 1] === id
}

/** Test/visibility helper. */
export function overlayDepth(): number {
  return overlayStack.length
}

/**
 * A focusable element for Tab confinement: matches the selector and is
 * actually reachable — not disabled, not aria-hidden, not tabindex=-1, not
 * a hidden input, not visually hidden. `style` is injected (when a DOM is
 * available) so the predicate stays honest; the query helper below supplies
 * computed styles.
 */
export function isOverlayFocusable(
  el: {
    matches?: (selector: string) => boolean
    getAttribute: (name: string) => string | null
    hasAttribute: (name: string) => boolean
    type?: string
  },
  style?: { visibility?: string; display?: string } | null,
): boolean {
  if (!el.matches?.(FOCUSABLE)) return false
  if (el.hasAttribute("disabled")) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.getAttribute("tabindex") === "-1") return false
  if (el.type === "hidden") return false
  if (style && (style.visibility === "hidden" || style.display === "none"))
    return false
  return true
}

function overlayFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => {
      const computed =
        typeof window !== "undefined"
          ? (window.getComputedStyle?.(el) ?? null)
          : null
      return isOverlayFocusable(el, computed)
    },
  )
}

/**
 * Shared keyboard/focus contract for every app overlay — mui-lite's Dialog
 * and Drawer are plain divs + backdrops: no Escape, no focus management.
 *
 * Per open overlay:
 * - Escape closes, but only when this overlay is the top of the stack, and
 *   never while `suspendEscape` holds (busy/destructive wait states).
 * - Focus moves to the first reachable focusable inside `rootRef` (the
 *   Dialog Paper / Drawer paper), falling back to the container itself.
 * - Focus returns to the exact element that had focus on open — the real
 *   trigger, wherever it lives (header hamburger, workspace button…).
 * - Tab/Shift+Tab stay confined to the overlay, looping when it has
 *   focusables and staying on the container when it has none.
 */
export function useOverlayA11y(
  open: boolean,
  onClose: () => void,
  rootRef?: React.RefObject<HTMLElement | null>,
  suspendEscape?: boolean,
) {
  const idRef = useRef<symbol | null>(null)
  // The trigger is captured at RENDER time, when `open` first flips true —
  // before React commits the overlay. A dialog field carrying autoFocus
  // takes focus during the commit, so an effect-time capture would record
  // the dialog's own field; on close that element is gone with the dialog
  // and the restore silently no-ops (focus left on the page). wasOpen
  // starts false so a conditionally-mounted dialog (open on first render)
  // captures too; on a deep-link open with no real trigger the capture is
  // body — restoring body is the status quo, never a regression.
  const wasOpenRef = useRef(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  if (open && !wasOpenRef.current && typeof document !== "undefined")
    triggerRef.current = (document.activeElement as HTMLElement) ?? null
  wasOpenRef.current = open
  useEffect(() => {
    if (!open) return
    const id = Symbol("overlay")
    idRef.current = id
    registerOverlay(id)
    const focusTimer = window.setTimeout(() => {
      const root = rootRef?.current
      if (!root) return
      const first = overlayFocusables(root)[0]
      ;(first ?? root).focus?.()
    }, 0)
    const onKey = (event: KeyboardEvent) => {
      if (!isTopOverlay(id)) return
      if (event.key === "Escape" && !suspendEscape) {
        event.stopPropagation()
        onClose()
        return
      }
      const root = rootRef?.current
      if (event.key === "Tab" && root) {
        const focusables = overlayFocusables(root)
        if (focusables.length === 0) {
          // Nothing tabbable inside: keep focus on the container instead of
          // letting it fall through to the page behind the modal.
          event.preventDefault()
          root.focus()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !root.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        } else if (!root.contains(active)) {
          // Focus escaped (e.g. programmatic move): pull it back in.
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.clearTimeout(focusTimer)
      unregisterOverlay(id)
      if (idRef.current === id) idRef.current = null
      window.removeEventListener("keydown", onKey, true)
      const trigger = triggerRef.current
      if (trigger && document.contains(trigger)) trigger.focus?.()
    }
  }, [open, onClose, rootRef, suspendEscape])
}

/**
 * Back-compat alias: the original Dialog-scoped name. Same contract.
 */
export function useDialogA11y(
  open: boolean,
  onClose: () => void,
  paperRef?: React.RefObject<HTMLElement | null>,
  suspendEscape?: boolean,
) {
  useOverlayA11y(open, onClose, paperRef, suspendEscape)
}
