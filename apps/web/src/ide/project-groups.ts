import type { ProjectInfo } from "./types"

const PLUGINS_ROOT = "/home/agent/plugins-create"

// The control plane tags projects pointing into ~/plugins-create as the
// "plugins" sub-category; fall back to the path prefix for rows saved by
// older control planes that do not send the field yet.
function isPluginProject(project: ProjectInfo): boolean {
  if (project.category) return project.category === "plugins"
  return (
    project.path === PLUGINS_ROOT || project.path.startsWith(`${PLUGINS_ROOT}/`)
  )
}

export function groupProjects(projects: ProjectInfo[]): {
  plugins: ProjectInfo[]
  general: ProjectInfo[]
} {
  const plugins: ProjectInfo[] = []
  const general: ProjectInfo[] = []
  for (const project of projects) {
    ;(isPluginProject(project) ? plugins : general).push(project)
  }
  return { plugins, general }
}
