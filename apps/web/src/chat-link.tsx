import type { ComponentPropsWithoutRef, MouseEvent } from "react"
import { chatLinkOpensExternally } from "./chat-view"
import { filePathFromSrc, useFilePreview } from "./file-view"

export function ChatLink({
  href,
  children,
  onClick,
  ...rest
}: ComponentPropsWithoutRef<"a">) {
  const external = chatLinkOpensExternally(href)
  const openFilePreview = useFilePreview()
  // A plain click on a served desktop file opens the split previewer
  // beside the thread; modifier/middle clicks keep the browser default
  // (the href stays a real URL, so open-in-new-tab still works).
  const previewable = Boolean(openFilePreview && filePathFromSrc(href))
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !previewable || !href) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openFilePreview?.(href)
  }
  return (
    <a
      href={href}
      {...rest}
      onClick={handleClick}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  )
}
