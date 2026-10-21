import type { ComponentPropsWithoutRef } from "react"
import { chatLinkOpensExternally } from "./chat-view"

export function ChatLink({
  href,
  children,
  ...rest
}: ComponentPropsWithoutRef<"a">) {
  const external = chatLinkOpensExternally(href)
  return (
    <a
      href={href}
      {...rest}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  )
}
