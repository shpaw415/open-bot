import { memo, useMemo } from "react"
import Markdown, { type Components, defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChatLink } from "./chat-link"
import { chatImageUrl } from "./chat-view"
import { MarkdownCodeBlock } from "./code-copy"
import { MediaDownloadButton, MediaFullscreenButton } from "./MediaDownload"
import { Model3dView } from "./Model3dView"
import { unwrapMediaParagraphs } from "./markdown-media"
import {
  ProjectRefLink,
  remarkProjectRefs,
  useProjectRefs,
} from "./project-refs"

function chatUrl(url: string, key: string): string {
  if (key === "src") return chatImageUrl(url)
  return defaultUrlTransform(url)
}

// Stable module-level identities so memoized markdown skips re-parsing when
// only surrounding state (e.g. the composer draft) changes.
const markdownPlugins = [remarkGfm, unwrapMediaParagraphs]

const markdownComponents: Components = {
  pre: MarkdownCodeBlock,
  a: ({ href, children, ...rest }) => {
    if (href?.startsWith("#project-ref/"))
      return <ProjectRefLink href={href}>{children}</ProjectRefLink>
    return (
      <ChatLink href={href} {...rest}>
        {children}
      </ChatLink>
    )
  },
  img: ({ src, alt }) => {
    if (!src) return null
    if (/\.(mp4|webm)$/i.test(src)) {
      return (
        // Inline-safe wrapper: react-markdown renders img inside <p> when the
        // image shares a paragraph with text, and a div there trips React's
        // <p> > <div> nesting warning (standalone media is already unwrapped
        // by the remark plugin).
        <span className="ob-media-wrap">
          {/* biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions */}
          <video src={src} controls preload="metadata" />
          <MediaDownloadButton src={src} />
          <MediaFullscreenButton src={src} alt={alt ?? ""} />
        </span>
      )
    }
    if (src.startsWith("/api/workspace/model3d") || /\.glb$/i.test(src)) {
      return <Model3dView src={src} alt={alt ?? ""} />
    }
    return (
      <span className="ob-media-wrap">
        <img src={src} alt={alt ?? ""} />
        <MediaDownloadButton src={src} />
        <MediaFullscreenButton src={src} alt={alt ?? ""} />
      </span>
    )
  },
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
}: {
  text: string
}) {
  const refs = useProjectRefs()
  const plugins = useMemo(
    () =>
      refs.length
        ? [...markdownPlugins, () => remarkProjectRefs(refs)]
        : markdownPlugins,
    [refs],
  )
  return (
    <Markdown
      remarkPlugins={plugins}
      urlTransform={chatUrl}
      components={markdownComponents}
    >
      {text}
    </Markdown>
  )
})
