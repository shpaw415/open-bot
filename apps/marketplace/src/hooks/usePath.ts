import { useEffect, useSyncExternalStore } from "react"

// Single source of truth for client navigation. The router (client-shell's
// RouterHost onRouteChange) publishes every route change here; usePath
// subscribes, so the header's active indicator updates on push navigations,
// not only on popstate. Plain module store — no context, no global
// history monkey-patching.

let currentPath = typeof window !== "undefined" ? window.location.pathname : "/"

const listeners = new Set<() => void>()

export function getNavPath(): string {
  return currentPath
}

export function subscribeNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setNavPath(path: string): void {
  if (path === currentPath) return
  currentPath = path
  for (const listener of listeners) listener()
}

function usePath(): string {
  return useSyncExternalStore(
    subscribeNav,
    getNavPath,
    // Server snapshot: no route-specific chrome is highlighted during SSR;
    // hydration corrects it right after mount.
    () => "/",
  )
}

export { usePath }

// Explicit rule for which nav item a path highlights: the catalogue owns the
// plugin detail pages.
export function navMatches(path: string, href: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/plugins/")
  return path === href || path.startsWith(`${href}/`)
}

// Client-only document title. SSR keeps the site default; the page updates it
// after mount so tabs and history read well.
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = `${title} · open-bot plugins`
    return () => {
      document.title = previous
    }
  }, [title])
}
