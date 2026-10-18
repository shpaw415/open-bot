import type { ReactNode } from "react"

// Minimal, dependency-free Markdown renderer for plugin READMEs.
//
// Security policy (enforced, tested):
// - No raw HTML ever reaches the DOM: everything is plain text unless produced
//   by the block/inline parsers below (React escapes all text nodes).
// - Links allow only http(s) and same-site relative URLs; `javascript:`,
//   `data:`, `vbscript:`, and unknown schemes are stripped down to plain text.
// - Images are NOT loaded: `![alt](src)` renders as a plain link to the
//   source, so no remote requests happen from marketplace pages.
// - Fenced code blocks render as <pre><code>; inline code as <code>.

const MAX_BLOCKS = 2000
const MAX_LIST_ITEMS = 500

// Exported for tests: the URL policy is the security boundary.
export function safeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  if (/^(https?:\/\/|\/|#|\.\/|\.\.\/)/i.test(url)) return url
  return null
}

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; url: string }

// Exported for tests.
export function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = []
  // Order matters: code spans first so formatting inside them stays literal.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\((?:[^()]|\([^()]*\))+\))|(https?:\/\/[^\s<>()[\]]+)/g
  let last = 0
  for (const match of input.matchAll(pattern)) {
    const start = match.index
    const raw = match[0]
    if (start > last)
      tokens.push({ kind: "text", text: input.slice(last, start) })
    if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) })
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ kind: "strong", text: raw.slice(2, -2) })
    } else if (raw.startsWith("*") || raw.startsWith("_")) {
      tokens.push({ kind: "em", text: raw.slice(1, -1) })
    } else if (raw.startsWith("[")) {
      const split = raw.indexOf("](")
      const label = raw.slice(1, split)
      const url = safeUrl(raw.slice(split + 2, -1))
      if (url) tokens.push({ kind: "link", text: label, url })
      else tokens.push({ kind: "text", text: label })
    } else {
      tokens.push({ kind: "link", text: raw, url: raw })
    }
    last = start + raw.length
  }
  if (last < input.length)
    tokens.push({ kind: "text", text: input.slice(last) })
  return tokens
}

function renderInline(input: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(input).map((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.kind) {
      case "code":
        return (
          <code
            key={key}
            className="rounded-[5px] border border-line bg-sunken px-1 py-[1px] font-mono text-[12.5px] text-ink"
          >
            {token.text}
          </code>
        )
      case "strong":
        return (
          <strong key={key} className="font-semibold text-ink">
            {renderInline(token.text, key)}
          </strong>
        )
      case "em":
        return (
          <em key={key} className="italic">
            {renderInline(token.text, key)}
          </em>
        )
      case "link":
        return (
          <a
            key={key}
            href={token.url}
            className="text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent"
            target={/^https?:\/\//i.test(token.url) ? "_blank" : undefined}
            rel={/^https?:\/\//i.test(token.url) ? "noreferrer" : undefined}
          >
            {renderInline(token.text, key)}
          </a>
        )
      default:
        return token.text
    }
  })
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; text: string; lang: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "hr" }

// Exported for tests: block parsing drives everything visible.
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[index] as string
    if (!line.trim()) {
      index += 1
      continue
    }
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const body: string[] = []
      index += 1
      while (
        index < lines.length &&
        !(lines[index] as string).match(/^```\s*$/)
      ) {
        body.push(lines[index] as string)
        index += 1
      }
      index += 1 // closing fence (or EOF)
      blocks.push({ kind: "code", text: body.join("\n"), lang: fence[1] ?? "" })
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({
        kind: "h",
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? "",
      })
      index += 1
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ kind: "hr" })
      index += 1
      continue
    }
    if (line.startsWith(">")) {
      const body: string[] = []
      while (index < lines.length && (lines[index] as string).startsWith(">")) {
        body.push((lines[index] as string).replace(/^>\s?/, ""))
        index += 1
      }
      blocks.push({ kind: "quote", lines: body })
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (
        index < lines.length &&
        /^\s*[-*+]\s+/.test(lines[index] as string)
      ) {
        if (items.length >= MAX_LIST_ITEMS) {
          index += 1
          continue
        }
        items.push((lines[index] as string).replace(/^\s*[-*+]\s+/, ""))
        index += 1
      }
      blocks.push({ kind: "ul", items })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (
        index < lines.length &&
        /^\s*\d+[.)]\s+/.test(lines[index] as string)
      ) {
        if (items.length >= MAX_LIST_ITEMS) {
          index += 1
          continue
        }
        items.push((lines[index] as string).replace(/^\s*\d+[.)]\s+/, ""))
        index += 1
      }
      blocks.push({ kind: "ol", items })
      continue
    }
    // Paragraph: fold consecutive non-blank lines that are not block starts.
    const para: string[] = []
    while (
      index < lines.length &&
      (lines[index] as string).trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index] as string)
    ) {
      para.push((lines[index] as string).trim())
      index += 1
    }
    if (para.length > 0) blocks.push({ kind: "p", lines: para })
  }
  return blocks
}

const headingClass: Record<number, string> = {
  1: "mt-6 mb-3 border-b border-line pb-2 text-[20px] font-bold tracking-[-0.01em] text-ink first:mt-0",
  2: "mt-6 mb-2 text-[17px] font-bold tracking-[-0.01em] text-ink",
  3: "mt-5 mb-2 text-[15.5px] font-bold text-ink",
  4: "mt-4 mb-1.5 text-[14.5px] font-bold text-ink",
  5: "mt-4 mb-1.5 text-[14px] font-bold text-ink",
  6: "mt-4 mb-1.5 text-[13.5px] font-semibold uppercase tracking-wide text-ink-2",
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source ?? "")
  return (
    <div className="max-w-[76ch] text-[14.5px] leading-6 text-ink-2">
      {blocks.map((block, index) => {
        const key = `b${index}`
        switch (block.kind) {
          case "h": {
            const level = Math.min(6, Math.max(1, block.level))
            const className = headingClass[level]
            const content = renderInline(block.text, key)
            if (level === 1)
              return (
                <h1 key={key} className={className}>
                  {content}
                </h1>
              )
            if (level === 2)
              return (
                <h2 key={key} className={className}>
                  {content}
                </h2>
              )
            if (level === 3)
              return (
                <h3 key={key} className={className}>
                  {content}
                </h3>
              )
            if (level === 4)
              return (
                <h4 key={key} className={className}>
                  {content}
                </h4>
              )
            if (level === 5)
              return (
                <h5 key={key} className={className}>
                  {content}
                </h5>
              )
            return (
              <h6 key={key} className={className}>
                {content}
              </h6>
            )
          }
          case "p":
            return (
              <p key={key} className="my-3 first:mt-0 last:mb-0">
                {renderInline(block.lines.join(" "), key)}
              </p>
            )
          case "code":
            return (
              <pre
                key={key}
                className="my-3 overflow-x-auto rounded-[10px] border border-line bg-sunken p-3.5 font-mono text-[12.5px] leading-5 text-ink"
              >
                <code>{block.text}</code>
              </pre>
            )
          case "ul":
            return (
              <ul
                key={key}
                className="my-3 list-disc space-y-1 pl-5 marker:text-ink-3"
              >
                {block.items.map((item, itemIndex) => (
                  // List items have no stable identity — the position IS the
                  // identity for static readme content.
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            )
          case "ol":
            return (
              <ol
                key={key}
                className="my-3 list-decimal space-y-1 pl-5 marker:text-ink-3"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            )
          case "quote":
            return (
              <blockquote
                key={key}
                className="my-3 border-l-2 border-line-strong pl-3 text-ink-2 italic"
              >
                {renderInline(block.lines.join(" "), key)}
              </blockquote>
            )
          case "hr":
            return <hr key={key} className="my-5 border-line" />
          default:
            return null
        }
      })}
    </div>
  )
}
