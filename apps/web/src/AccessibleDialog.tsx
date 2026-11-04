import Dialog, { type DialogProps } from "@shpaw415/mui-lite/Dialog"
import { useCallback, useRef } from "react"
import { useOverlayA11y } from "./dialog-a11y"

export type AccessibleDialogProps = DialogProps & {
  /** Ignore Escape (and Back) while true (busy saves, destructive waits). */
  suspendEscape?: boolean
  /** Opt out of Back-to-close when the dialog's open state rides the URL. */
  disableBackClose?: boolean
}

/**
 * Drop-in Dialog wrapper carrying the app-wide overlay contract: Escape
 * and the system Back button close it (top overlay only), focus enters the
 * dialog on open and returns to the trigger on close, Tab stays confined.
 * Render behavior is otherwise the library's.
 *
 * mui-lite renders role="dialog" on its inner Paper, so the accessible name
 * must land there: `aria-label` / `aria-labelledby` props are routed onto
 * slotProps.paper automatically (pair with a <DialogTitle id=…> via
 * aria-labelledby for named dialogs).
 */
export function AccessibleDialog({
  open,
  onClose,
  suspendEscape,
  disableBackClose,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  slotProps,
  ...props
}: AccessibleDialogProps) {
  const paperRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const handleClose = useCallback(() => onCloseRef.current?.(), [])
  useOverlayA11y(
    Boolean(open),
    handleClose,
    paperRef,
    Boolean(suspendEscape) || !onClose,
    { backName: "dialog", backEnabled: !disableBackClose && Boolean(onClose) },
  )
  return (
    <Dialog
      {...props}
      open={open}
      onClose={onClose}
      ref={paperRef}
      slotProps={{
        ...slotProps,
        paper: {
          ...slotProps?.paper,
          "aria-label": ariaLabel ?? slotProps?.paper?.["aria-label"],
          "aria-labelledby":
            ariaLabelledBy ?? slotProps?.paper?.["aria-labelledby"],
        },
      }}
    />
  )
}

export {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
export default AccessibleDialog
