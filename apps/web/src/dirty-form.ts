import { useEffect, useRef, useState } from "react"

/**
 * Registry of forms with unsaved changes.
 *
 * beforeunload only guards tab close/refresh; the shell's internal
 * navigation (pushState / popstate) consults this registry instead, so
 * leaving a dirty section via the app's own chrome warns too. Forms join
 * while dirty and leave on save/unmount; an empty registry never warns.
 */

const dirty = new Set<symbol>()

const listeners = new Set<() => void>()

export const dirtyForms = {
  mark(key: symbol) {
    dirty.add(key)
    for (const listener of listeners) listener()
  },
  clear(key: symbol) {
    if (!dirty.delete(key)) return
    for (const listener of listeners) listener()
  },
  hasDirty(): boolean {
    return dirty.size > 0
  },
  /** Test/debug helper: drop everything without notifications. */
  reset() {
    dirty.clear()
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/**
 * Declare the calling form's dirty state. Returns [isDirty, setDirty].
 * The registration survives only while the component is mounted, so
 * navigating away (unmount) automatically clears the guard.
 */
export function useDirtyForm(): [boolean, (dirty: boolean) => void] {
  const keyRef = useRef<symbol>(Symbol("dirty-form"))
  const [isDirty, setIsDirty] = useState(false)
  useEffect(() => {
    const key = keyRef.current
    return () => dirtyForms.clear(key)
  }, [])
  const setDirty = (next: boolean) => {
    if (next) dirtyForms.mark(keyRef.current)
    else dirtyForms.clear(keyRef.current)
    setIsDirty(next)
  }
  return [isDirty, setDirty]
}
