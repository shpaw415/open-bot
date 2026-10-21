export type DraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function draftKey(sessionId: string): string {
  return `ob-draft:${sessionId}`
}

/**
 * The composer of a thread that does not exist server-side yet (the blank
 * "Nouvelle conversation" view). Keyed by user so one account never reads
 * another account's text; migrated to the real session on first send.
 */
export function blankDraftKey(userId: string): string {
  return `ob-draft:blank:${userId}`
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

export function readBlankDraft(storage: DraftStorage, userId: string): string {
  if (!userId) return ""
  try {
    return storage.getItem(blankDraftKey(userId)) ?? ""
  } catch {
    return ""
  }
}

export function writeBlankDraft(
  storage: DraftStorage,
  userId: string,
  text: string,
): void {
  if (!userId) return
  try {
    if (!text) storage.removeItem(blankDraftKey(userId))
    else storage.setItem(blankDraftKey(userId), text)
  } catch {}
}

export function clearBlankDraft(storage: DraftStorage, userId: string): void {
  if (!userId) return
  try {
    storage.removeItem(blankDraftKey(userId))
  } catch {}
}
