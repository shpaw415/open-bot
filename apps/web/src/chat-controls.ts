// Shared model + thinking-effort logic for the chat composer and the Config
// page. The server owns the truth: PUT /api/model silently drops a saved
// effort the new model no longer supports, and PUT /api/thinking validates
// against the current model. These helpers keep every UI honest about that
// contract — no local-only selection that never reaches the engine.

const EFFORT_LABELS: Record<string, string> = {
  none: "Désactivée",
  minimal: "Minimale",
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  xhigh: "Très haute",
  max: "Maximale",
  thinking: "Réflexion activée",
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

/**
 * Reading mode: the reader scrolled up to read history, so the bottom
 * chrome (orb row + composer toolbar) shrinks out of the way. Enter and
 * exit use different distances from the bottom — the shrink itself frees
 * ~150px of log height, which cuts the measured gap by the same amount;
 * a single threshold would flip the mode on every scroll tick near it.
 * The exit distance matches STICK_PX in chat-view.ts (nearBottom), so
 * leaving reading mode and re-sticking to the bottom are the same event.
 */
export const READING_ENTER_PX = 240
export const READING_EXIT_PX = 48

export function nextReadingMode(gapPx: number, current: boolean): boolean {
  if (gapPx > READING_ENTER_PX) return true
  if (gapPx < READING_EXIT_PX) return false
  return current
}

/**
 * Orb canvas size. The animation never goes away while a turn runs — at
 * the bottom it keeps its full presence; while reading it stays alive at
 * mini size in the same status line (AgentOrb's compact path renders
 * fine below 64px, orbit ring dropped).
 */
export function orbSizePx(mobile: boolean, reading: boolean): number {
  if (reading) return 32
  return mobile ? 80 : 112
}

/**
 * Whether the composer may slim down to its bare field while reading.
 * Anything that means "the user is composing" keeps the full composer:
 * focus inside it, draft text, staged attachments, or a live voice
 * recording/transcription. Send is unreachable in slim mode, which is
 * safe exactly because an empty, unfocused draft has nothing to send;
 * Stop stays available on the mini orb row beside it.
 */
export function composerSlim(input: {
  reading: boolean
  focused: boolean
  hasDraft: boolean
  hasAttachments: boolean
  voiceBusy: boolean
}): boolean {
  return (
    input.reading &&
    !input.focused &&
    !input.hasDraft &&
    !input.hasAttachments &&
    !input.voiceBusy
  )
}
