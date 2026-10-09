import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ProjectRefTip } from "./project-refs"
import {
  findReferenceTokens,
  type ProjectRefItem,
  type ReferenceToken,
} from "./references"

type TokenSpan = { token: ReferenceToken; rect: DOMRect }

type HoverState = { name: string; path?: string; rect: DOMRect }

const KNOWN_TINT = "rgba(20, 184, 166, 0.26)"
const UNKNOWN_TINT = "rgba(245, 158, 11, 0.3)"

const COPY_PROPS = [
  "boxSizing",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "overflowWrap",
  "wordBreak",
] as const

/**
 * Highlight layer behind the composer textarea. Because a textarea cannot
 * style text ranges, the overlay mirrors the draft with identical metrics
 * and paints tinted spans over `@projects/…` tokens; hovering a token shows
 * the project path. The input stays fully interactive (pointer-events none).
 */
export default function ReferenceOverlay({
  text,
  projects,
  inputRef,
}: {
  text: string
  projects: ProjectRefItem[]
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const tokens = useMemo(
    () => findReferenceTokens(text, projects),
    [text, projects],
  )
  const overlayRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  // keep geometry, typography and scroll position locked to the textarea
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const el = inputRef.current as HTMLTextAreaElement | null
    if (!overlay || !el) return
    const host = overlay.parentElement
    if (!host) return
    const sync = () => {
      const hostRect = host.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      overlay.style.left = `${rect.left - hostRect.left}px`
      overlay.style.top = `${rect.top - hostRect.top}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      const style = getComputedStyle(el)
      for (const prop of COPY_PROPS) overlay.style[prop] = style[prop] as string
      // reserve the same space the textarea's scrollbar takes so wrapping matches
      const borders =
        parseFloat(style.borderLeftWidth || "0") +
        parseFloat(style.borderRightWidth || "0")
      const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth - borders)
      overlay.style.paddingRight = `calc(${style.paddingRight} + ${scrollbar}px)`
      overlay.scrollTop = el.scrollTop
      overlay.scrollLeft = el.scrollLeft
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener("resize", sync)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", sync)
    }
  })

  useEffect(() => {
    const el = inputRef.current as HTMLTextAreaElement | null
    if (!el) return
    const findHover = (x: number, y: number): TokenSpan | null => {
      const nodes =
        overlayRef.current?.querySelectorAll<HTMLElement>("[data-token]")
      if (!nodes) return null
      for (const node of nodes) {
        for (const rect of Array.from(node.getClientRects())) {
          if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          ) {
            const start = Number(node.dataset.token ?? -1)
            const token = tokens.find((item) => item.start === start)
            return token ? { token, rect } : null
          }
        }
      }
      return null
    }
    const onMove = (event: MouseEvent) => {
      const hit = findHover(event.clientX, event.clientY)
      if (hit) {
        setHover((prev) =>
          prev?.rect.left === hit.rect.left &&
          prev?.rect.top === hit.rect.top &&
          prev.name === hit.token.name
            ? prev
            : {
                name: hit.token.name,
                path: hit.token.path,
                rect: hit.rect,
              },
        )
        return
      }
      setHover(null)
    }
    const onLeave = () => setHover(null)
    const onScroll = () => {
      setHover(null)
      const overlay = overlayRef.current
      if (overlay) {
        overlay.scrollTop = el.scrollTop
        overlay.scrollLeft = el.scrollLeft
      }
    }
    el.addEventListener("mousemove", onMove)
    el.addEventListener("mouseleave", onLeave)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("mousemove", onMove)
      el.removeEventListener("mouseleave", onLeave)
      el.removeEventListener("scroll", onScroll)
    }
  }, [tokens, inputRef])

  if (!text) return null

  const segments: ReactNode[] = []
  let pos = 0
  tokens.forEach((token) => {
    if (token.start < pos || token.end > text.length) return
    if (token.start > pos)
      segments.push(
        <span key={`plain-${token.start}`}>
          {text.slice(pos, token.start)}
        </span>,
      )
    segments.push(
      <span
        key={`token-${token.start}`}
        data-token={token.start}
        style={{
          borderRadius: 4,
          background: token.name ? KNOWN_TINT : UNKNOWN_TINT,
          boxShadow: token.name
            ? "inset 0 -1px 0 rgba(20, 184, 166, 0.55)"
            : "inset 0 -1px 0 rgba(245, 158, 11, 0.6)",
        }}
      >
        {text.slice(token.start, token.end)}
      </span>,
    )
    pos = token.end
  })
  segments.push(text.slice(pos) + (text.endsWith("\n") ? "\u200b" : ""))

  const flip = Boolean(
    hover && !hover.name && hover.rect.bottom + 40 > window.innerHeight,
  )
  return (
    <>
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          position: "absolute",
          overflow: "hidden",
          scrollbarWidth: "none",
          pointerEvents: "none",
          zIndex: 1,
          whiteSpace: "pre-wrap",
          color: "transparent",
          userSelect: "none",
          borderStyle: "solid",
          borderColor: "transparent",
        }}
      >
        {segments}
      </div>
      {hover ? (
        hover.name ? (
          <ProjectRefTip
            name={hover.name}
            path={hover.path}
            rect={hover.rect}
          />
        ) : (
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: Math.min(hover.rect.left, window.innerWidth - 260),
              ...(flip
                ? { bottom: window.innerHeight - hover.rect.top + 6 }
                : { top: hover.rect.bottom + 6 }),
              zIndex: 1500,
              maxWidth: 240,
              padding: "6px 9px",
              borderRadius: 7,
              background: "#22303c",
              color: "#e7edf3",
              fontSize: 12,
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
              pointerEvents: "none",
            }}
          >
            No project matches this mention
          </div>
        )
      ) : null}
    </>
  )
}
