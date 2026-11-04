import { memo, useMemo } from "react"
import Markdown, { type Components, defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChatLink } from "./chat-link"
import { chatImageUrl, chatLinkUrl } from "./chat-view"
import { MarkdownCodeBlock } from "./code-copy"
import { remarkAgentFiles } from "./file-refs"
import {
  MediaDownloadButton,
  MediaFullscreenButton,
  MediaImage,
} from "./MediaDownload"
import { Model3dView } from "./Model3dView"
import { unwrapMediaParagraphs } from "./markdown-media"
import {
  ProjectRefLink,
  remarkProjectRefs,
  useProjectRefs,
} from "./project-refs"

/** Shared with the council/cron transcript renderers: every agent-written
 * markdown surface routes disk references to the file endpoints.
 * `basePath` is the folder relative links resolve against — the open
 * file's folder inside the file previewer, the workspace in chat. */
export function makeChatUrlTransform(basePath?: string) {
  return (url: string, key: string): string => {
    if (key === "src") return chatImageUrl(url, basePath)
    if (key === "href")
      return chatLinkUrl(url, basePath) ?? defaultUrlTransform(url)
    return defaultUrlTransform(url)
  }
}

export const chatUrlTransform = makeChatUrlTransform()

// Stable module-level identities so memoized markdown skips re-parsing when
// only surrounding state (e.g. the composer draft) changes.
const markdownPlugins = [remarkGfm, unwrapMediaParagraphs, remarkAgentFiles]

const MEDIA_FILE_SRC = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp4|webm|glb)$/i

/** A file endpoint URL whose target no <img> can show (the agent used
 * image syntax for a PDF…): the embed renders as a plain openable link. */
export function nonMediaFileName(src: string): string | null {
  if (!src.startsWith("/api/workspace/file?")) return null
  const path = new URLSearchParams(src.slice(src.indexOf("?") + 1)).get("path")
  if (!path || MEDIA_FILE_SRC.test(path)) return null
  return path.slice(path.lastIndexOf("/") + 1) || path
}

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
    const fileName = nonMediaFileName(src)
    if (fileName) return <ChatLink href={src}>{alt || fileName}</ChatLink>
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
    return <MediaImage src={src} alt={alt ?? ""} />
  },
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  basePath,
}: {
  text: string
  /** Folder relative links/images resolve against (file previewer). */
  basePath?: string
}) {
  const refs = useProjectRefs()
  const plugins = useMemo(
    () =>
      refs.length
        ? [...markdownPlugins, () => remarkProjectRefs(refs)]
        : markdownPlugins,
    [refs],
  )
  const urlTransform = useMemo(
    () => (basePath ? makeChatUrlTransform(basePath) : chatUrlTransform),
    [basePath],
  )
  return (
    <Markdown
      remarkPlugins={plugins}
      urlTransform={urlTransform}
      components={markdownComponents}
    >
      {text}
    </Markdown>
  )
})
