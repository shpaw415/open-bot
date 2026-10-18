/**
 * Dialog-editor discard guard: closing an editor (Escape, backdrop,
 * Cancel) that holds real edits asks before dropping them — the same
 * window.confirm convention the shell's route guard and the IDE's file
 * close use. An intact form closes without asking; a failed save keeps
 * the values on screen (they differ from the pristine snapshot, so the
 * next close still asks); a busy save is never bypassed (callers gate on
 * their busy flag first).
 */

export function confirmDiscard(): boolean {
  return window.confirm("Discard unsaved changes?")
}

/**
 * True when the current editor state differs from the snapshot taken when
 * it opened. Compare only user-editable fields (spread copies share key
 * order, so stringify is a stable deep-enough compare here).
 */
export function snapshotDirty(
  pristine: Record<string, unknown> | null,
  current: Record<string, unknown> | null,
): boolean {
  if (!pristine || !current) return false
  return JSON.stringify(pristine) !== JSON.stringify(current)
}
