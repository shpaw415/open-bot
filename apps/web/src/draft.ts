export type DraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function draftKey(sessionId: string): string {
  return `ob-draft:${sessionId}`
}

export function readDraft(storage: DraftStorage, sessionId: string): string {
  if (!sessionId) return ""
  try {
    return storage.getItem(draftKey(sessionId)) ?? ""
  } catch {
    return ""
  }
}

export function writeDraft(
  storage: DraftStorage,
  sessionId: string,
  text: string,
): void {
  if (!sessionId) return
  try {
    if (!text) storage.removeItem(draftKey(sessionId))
    else storage.setItem(draftKey(sessionId), text)
  } catch {}
}
