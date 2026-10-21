import { type ReactNode, useEffect, useRef, useState } from "react"
import { CheckIcon, ContentCopyIcon } from "./icons"
import { CODE_COPY } from "./texts"

type HastNode = {
  type?: string
  value?: string
  children?: HastNode[]
}

type MarkdownPreProps = {
  node?: unknown
  children?: ReactNode
}

function nodeText(node: unknown): string {
  if (typeof node !== "object" || node === null) return ""
  const { type, value, children } = node as HastNode
  if (type === "text") return typeof value === "string" ? value : ""
  if (!Array.isArray(children)) return ""
  return children.map(nodeText).join("")
}

export function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  function copy() {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }
  return (
    <button
      type="button"
      className={copied ? "ob-code-copy ob-code-copy-done" : "ob-code-copy"}
      title={CODE_COPY.copy}
      aria-label={copied ? CODE_COPY.copied : CODE_COPY.copy}
      onClick={copy}
    >
      {copied ? (
        <>
          <CheckIcon width={14} height={14} />
          {CODE_COPY.copied}
        </>
      ) : (
        <ContentCopyIcon width={14} height={14} />
      )}
    </button>
  )
}

export function MarkdownCodeBlock({ node, children }: MarkdownPreProps) {
  const text = nodeText(node).replace(/\n$/, "")
  return (
    <div className="ob-code-wrap">
      <CodeCopyButton text={text} />
      <pre>{children}</pre>
    </div>
  )
}
