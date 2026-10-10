export const PROJECTS_ROOT = "/home/agent/workspace"

const SLUG_MAX = 64

export function slugifyName(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "")
  return slug || null
}

export function projectDir(slug: string): string {
  return `${PROJECTS_ROOT}/${slug}`
}

export function projectSubpath(root: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null
  if (raw.includes("\0") || raw.includes("\\")) return null
  const path = raw.replace(/\/+$/g, "")
  if (!path) return null
  if (path === root) return root
  const prefix = `${root}/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  const segments = rest.split("/")
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".."))
    return null
  return `${root}/${rest}`
}

export function projectName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 80)
  if (!name || !slugifyName(name)) return null
  return name
}

export function isProjectManageRequest(
  pathname: string,
  method: string,
): boolean {
  if (pathname === "/api/projects" && (method === "GET" || method === "POST"))
    return true
  return method === "DELETE" && /^\/api\/projects\/[^/]+$/.test(pathname)
}

// Projects may also point at an existing desktop folder outside the
// workspace (e.g. ~/plugins-create/<slug>), so the dashboard can manage
// plugin projects and other pre-existing folders.
export function resolveCustomProjectPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const path = raw.trim().replace(/\/+$/g, "")
  if (!path || path.length > 256) return null
  if (path.includes("\0") || path.includes("\\")) return null
  if (!path.startsWith("/home/agent/")) return null
  const segments = path.slice("/home/agent/".length).split("/")
  if (
    segments.length === 0 ||
    segments.some((seg) => seg === "" || seg === "." || seg === "..")
  )
    return null
  return path
}
