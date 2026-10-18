// Shared model + thinking-effort logic for the chat composer and the Config
// page. The server owns the truth: PUT /api/model silently drops a saved
// effort the new model no longer supports, and PUT /api/thinking validates
// against the current model. These helpers keep every UI honest about that
// contract — no local-only selection that never reaches the engine.

const EFFORT_LABELS: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  thinking: "Thinking on",
}

export function effortLabel(variant: string): string {
  return (
    EFFORT_LABELS[variant] ?? variant.charAt(0).toUpperCase() + variant.slice(1)
  )
}

/** Sentinel effort value meaning "follow the model's own default". */
export const MODEL_DEFAULT_EFFORT = ""

/**
 * The effort that survives a move to a model exposing these variants.
 * An unsupported level is dropped (to the model default), never kept
 * silently — the server applies the same rule on PUT /api/model.
 */
export function effortForModel(
  variants: readonly string[],
  effort: string,
): string {
  if (!effort) return MODEL_DEFAULT_EFFORT
  return variants.includes(effort) ? effort : MODEL_DEFAULT_EFFORT
}

/**
 * Options for the effort picker: the "Model default" sentinel first, then
 * this model's variants. A saved effort the list no longer knows about stays
 * visible so the display never lies about what is stored server-side.
 */
export function effortOptions(
  variants: readonly string[],
  current: string,
): string[] {
  const options =
    !current || variants.includes(current)
      ? [...variants]
      : [...variants, current]
  return [MODEL_DEFAULT_EFFORT, ...options]
}

export type OrbActivity = "initialize" | "working"

/**
 * Visual orb phase for the active turn. These are presentation states, not
 * measurements: initialize (desktop booting) and the accepted-send window
 * read as "thinking", live turn activity reads as "working". A null activity
 * means no orb at all.
 */
export function orbState(
  activity: OrbActivity | null,
  sending: boolean,
): "thinking" | "working" | null {
  if (!activity) return null
  return activity === "initialize" || sending ? "thinking" : "working"
}
