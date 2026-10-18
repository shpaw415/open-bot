import Dialog, { type DialogProps } from "@shpaw415/mui-lite/Dialog"
import { useCallback, useRef } from "react"
import { useDialogA11y } from "./dialog-a11y"

export type AccessibleDialogProps = DialogProps & {
  /** Ignore Escape while true (busy saves, destructive wait states). */
  suspendEscape?: boolean
}

/**
 * Drop-in Dialog wrapper carrying the app-wide keyboard/focus contract:
 * Escape closes, focus enters the dialog on open and returns to the trigger
 * on close, Tab stays confined. Render behavior is otherwise the library's.
 */
export function AccessibleDialog({
  open,
  onClose,
  suspendEscape,
  ...props
}: AccessibleDialogProps) {
  const paperRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const handleClose = useCallback(() => onCloseRef.current?.(), [])
  useDialogA11y(
    Boolean(open),
    handleClose,
    paperRef,
    Boolean(suspendEscape) || !onClose,
  )
  return <Dialog {...props} open={open} onClose={onClose} ref={paperRef} />
}

export {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
export default AccessibleDialog
