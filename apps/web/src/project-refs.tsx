import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react"
import { findReferenceTokens, type ProjectRefItem } from "./references"

export const ProjectRefsContext = createContext<ProjectRefItem[]>([])

export function useProjectRefs(): ProjectRefItem[] {
  return useContext(ProjectRefsContext)
}

type MdNode = {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

export function projectRefUrl(name: string, path?: string): string {
  return `#project-ref/${encodeURIComponent(name)}/${encodeURIComponent(path ?? "")}`
}

function parseProjectRefUrl(
  url: string,
): { name: string; path?: string } | null {
  const match = url.match(/^#project-ref\/([^/]+)\/(.*)$/s)
  if (!match) return null
  try {
    return {
      name: decodeURIComponent(match[1] ?? ""),
      path: decodeURIComponent(match[2] ?? "") || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Remark plugin: rewrites `@projects/<name>` / `@project/<name>` text into
 * inert `#project-ref/…` links so the bubble renderer can style them. Runs on
 * mdast text nodes only, so code fences and inline code stay untouched.
 * Unresolved mentions are left as plain text here; the composer overlay flags
 * those while typing.
 */
export function remarkProjectRefs(projects: ProjectRefItem[]) {
  return (tree: MdNode) => {
    const walk = (node: MdNode): void => {
      if (!node.children) return
      const next: MdNode[] = []
      let changed = false
      for (const child of node.children) {
        const tokens =
          child.type === "text" && child.value
            ? findReferenceTokens(child.value, projects).filter(
                (token) => token.name,
              )
            : []
        if (child.value !== undefined && tokens.length) {
          changed = true
          let pos = 0
          for (const token of tokens) {
            if (token.start < pos) continue
            if (token.start > pos)
              next.push({
                type: "text",
                value: child.value.slice(pos, token.start),
              })
            next.push({
              type: "link",
              url: projectRefUrl(token.name, token.path),
              children: [
                {
                  type: "text",
                  value: child.value.slice(token.start, token.end),
                },
              ],
            })
            pos = token.end
          }
          if (pos < child.value.length)
            next.push({ type: "text", value: child.value.slice(pos) })
          continue
        }
        walk(child)
        next.push(child)
      }
      if (changed) node.children = next
    }
    walk(tree)
  }
}

const refLinkStyle: CSSProperties = {
  borderRadius: 4,
  padding: "0 2px",
  background: "rgba(20, 184, 166, 0.24)",
  boxShadow: "inset 0 -1px 0 rgba(20, 184, 166, 0.55)",
  cursor: "default",
}

const refTipStyle = (rect: DOMRect): CSSProperties => ({
  position: "fixed",
  left: Math.min(rect.left, window.innerWidth - 400),
  ...(rect.bottom + 90 > window.innerHeight
    ? { bottom: window.innerHeight - rect.top + 6 }
    : { top: rect.bottom + 6 }),
  zIndex: 1500,
  maxWidth: 380,
  padding: "6px 9px",
  borderRadius: 7,
  background: "#22303c",
  color: "#e7edf3",
  fontSize: 12,
  lineHeight: 1.45,
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
  pointerEvents: "none",
})

/** Shared hover card: project name + its root directory on the desktop. */
export function ProjectRefTip({
  name,
  path,
  rect,
}: {
  name: string
  path?: string
  rect: DOMRect
}) {
  return (
    <div style={refTipStyle(rect)} role="tooltip">
      <strong>{name}</strong>
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          opacity: 0.85,
          wordBreak: "break-all",
        }}
      >
        {path ?? "project root"}
      </div>
    </div>
  )
}

/** Bubble renderer for the `#project-ref/…` links the remark plugin emits. */
export function ProjectRefLink({
  href,
  children,
}: {
  href?: string
  children?: ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  if (!href) return <span>{children}</span>
  const ref = parseProjectRefUrl(href)
  if (!ref) return <span>{children}</span>
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only path hint */}
      <span
        style={refLinkStyle}
        onMouseEnter={(event) =>
          setRect(event.currentTarget.getBoundingClientRect())
        }
        onMouseLeave={() => setRect(null)}
      >
        {children}
      </span>
      {rect ? (
        <ProjectRefTip name={ref.name} path={ref.path} rect={rect} />
      ) : null}
    </>
  )
}
