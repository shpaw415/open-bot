import { useEffect, useState } from "react"

export function usePath(): string {
  const [path, setPath] = useState("/")
  useEffect(() => {
    setPath(window.location.pathname)
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  return path
}
