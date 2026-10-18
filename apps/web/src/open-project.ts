/**
 * "Open this exact project" pipeline, modeled on the thread opener in
 * notify.ts: a custom event plus a pending slot. The event covers the
 * common case (Projects already mounted in the workspace); the pending slot
 * covers the race where the search pick navigates to /projects and the
 * Projects view mounts AFTER the event fired — it consumes the request on
 * (or after) its first successful load.
 */

export const OPEN_PROJECT_EVENT = "ob-open-project"

let pendingProjectId = ""

export function openProjectById(projectId: string) {
  if (!projectId) return
  pendingProjectId = projectId
  window.dispatchEvent(
    new CustomEvent(OPEN_PROJECT_EVENT, { detail: { projectId } }),
  )
}

/** Consume a pending open request ("" when none). */
export function takePendingProject(): string {
  const id = pendingProjectId
  pendingProjectId = ""
  return id
}

/** Peek without consuming (test seam). */
export function peekPendingProject(): string {
  return pendingProjectId
}
