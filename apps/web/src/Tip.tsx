import type { ToolTipProps } from "@shpaw415/mui-lite/ToolTip"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import { useEffect, useState } from "react"

/** Fired by the shell on every location change (push, pop, replace). */
export const NAVIGATE_EVENT = "ob-navigate"

/**
 * Local wrapper around mui-lite's ToolTip. Adds what the audit flagged:
 * - closes on view changes (NAVIGATE_EVENT) so a tip never floats over the
 *   wrong view while its anchor re-lays out,
 * - closes on Escape,
 * - opens on keyboard focus, not only hover,
 * - fully unmounts with its anchor, so no stale portal survives.
 * It never suppresses tips: everything still renders, just bounded.
 */
export function Tip({
  children,
  ...props
}: Omit<ToolTipProps, "open" | "onOpen" | "onClose"> & {
  children: ToolTipProps["children"]
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener(NAVIGATE_EVENT, close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, close)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <ToolTip
      {...props}
      triggers={props.triggers ?? ["hover", "focus"]}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    >
      {children}
    </ToolTip>
  )
}
