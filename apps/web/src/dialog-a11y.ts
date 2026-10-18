import { useEffect } from "react"

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard/focus contract for mui-lite Dialogs. The library's Dialog is a
 * plain div + backdrop: no Escape, no focus management. This hook adds, per
 * open dialog:
 * - Escape closes (unless suspended, e.g. while a destructive save is busy),
 * - focus moves to the first focusable element inside the dialog on open,
 *   falling back to the dialog paper itself,
 * - focus returns to whatever element had focus when the dialog opened,
 * - Tab/Shift+Tab stay confined to the dialog while it is open.
 *
 * Pass `paperRef` attached to the <Dialog> element (its ref lands on the
 * Paper that carries role="dialog"). Use `suspendEscape` while a busy or
 * destructive wait state must not be dismissed.
 */
export function useDialogA11y(
  open: boolean,
  onClose: () => void,
  paperRef?: React.RefObject<HTMLElement | null>,
  suspendEscape?: boolean,
) {
  useEffect(() => {
    if (!open) return
    // Whoever had focus before the dialog (the trigger button) gets it back
    // on close — captured now, before the dialog takes it.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      const root = paperRef?.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? root).focus?.()
    }, 0)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !suspendEscape) {
        event.stopPropagation()
        onClose()
        return
      }
      const paper = paperRef?.current
      if (event.key === "Tab" && paper) {
        // Confine Tab to the dialog's focusables.
        const focusables = Array.from(
          paper.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => !el.hasAttribute("disabled"))
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !paper.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener("keydown", onKey, true)
      if (previouslyFocused && document.contains(previouslyFocused))
        previouslyFocused.focus?.()
    }
  }, [open, onClose, paperRef, suspendEscape])
}
