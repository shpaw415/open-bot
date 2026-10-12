import type React from "react"
import { useEffect, useState } from "react"
import { docsNav } from "../site.config"

interface FlatNavItem {
  label: string
  href: string
  group: string
}

function flattenNav(): FlatNavItem[] {
  const flat: FlatNavItem[] = []
  for (const section of docsNav) {
    for (const item of section.items) {
      flat.push({ label: item.label, href: item.href, group: section.group })
    }
  }
  return flat
}

function usePathname(): string {
  const [pathname, setPathname] = useState<string>("")
  useEffect(() => {
    setPathname(window.location.pathname)
  }, [])
  return pathname
}

function SidebarNav({
  pathname,
  onNavigate,
}: {
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Documentation" className="not-prose">
      {docsNav.map((section) => (
        <div key={section.group} className="mb-6">
          <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {section.group}
          </h3>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                    className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-card font-medium text-accent"
                        : "text-muted hover:bg-card hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function PrevNextNav({ pathname }: { pathname: string }) {
  const [nav, setNav] = useState<{
    prev: FlatNavItem | null
    next: FlatNavItem | null
  }>({ prev: null, next: null })

  useEffect(() => {
    const flat = flattenNav()
    const index = flat.findIndex((item) => item.href === pathname)
    if (index === -1) {
      setNav({ prev: null, next: null })
      return
    }
    setNav({
      prev: index > 0 ? (flat[index - 1] as FlatNavItem) : null,
      next: index < flat.length - 1 ? (flat[index + 1] as FlatNavItem) : null,
    })
  }, [pathname])

  if (!nav.prev && !nav.next) return null

  return (
    <nav
      aria-label="Page navigation"
      className="not-prose mt-12 flex items-center justify-between gap-4 border-t border-border pt-6"
    >
      <div className="flex-1">
        {nav.prev && (
          <a
            href={nav.prev.href}
            className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card-hover"
          >
            <span className="block text-xs text-muted">Previous</span>
            <span className="mt-1 block text-sm font-medium text-foreground group-hover:text-accent">
              ← {nav.prev.label}
            </span>
          </a>
        )}
      </div>
      <div className="flex-1 text-right">
        {nav.next && (
          <a
            href={nav.next.href}
            className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card-hover"
          >
            <span className="block text-xs text-muted">Next</span>
            <span className="mt-1 block text-sm font-medium text-foreground group-hover:text-accent">
              {nav.next.label} →
            </span>
          </a>
        )}
      </div>
    </nav>
  )
}

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 items-start gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <aside className="not-prose sticky top-24 hidden max-h-[calc(100vh-7rem)] w-64 shrink-0 overflow-y-auto docs-sidebar lg:block">
        <SidebarNav pathname={pathname} />
      </aside>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-expanded={sidebarOpen}
          aria-label="Toggle documentation navigation"
          className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          Menu
        </button>
        {sidebarOpen && (
          <div className="mb-6 rounded-lg border border-border bg-card p-4">
            <SidebarNav
              pathname={pathname}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <main className="prose dark:prose-invert prose-lg mx-auto w-full max-w-prose">
          {children}
        </main>
        <div className="mx-auto w-full max-w-prose">
          <PrevNextNav pathname={pathname} />
        </div>
      </div>
    </div>
  )
}

export default DocsShell
