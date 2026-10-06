import { useEffect, useState } from "react"

export function useMobile(breakpoint = 899): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint,
  )
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [breakpoint])
  return mobile
}

export function usePath(path: string, setPath: (next: string) => void) {
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [setPath])
  void path
}
