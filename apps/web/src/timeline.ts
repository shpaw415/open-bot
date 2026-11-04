import type { ChatMessage, TranscriptEntry } from "./chat-view"

// The thread rendered as derived timeline rows (the T3 Code model):
// message bubbles stay bubbles, but the tool work an assistant turn
// performed — invisible before, when only text parts rendered —
// becomes one summary row per turn ("worked 2 min · 12 steps") that
// expands to the step list. Work is aggregated from the raw messages,
// not the bubbles: burst merging in threadBubbles folds several
// assistant messages into one bubble and keeps only the first one's
// parts, so bubble parts would undercount.

export type WorkStep = {
  tool: string
  title: string
  status: string
}

export type TurnWork = {
  steps: WorkStep[]
  /** Last assistant completion minus first assistant creation of the turn. */
  durationMs: number | null
  running: boolean
}

export type TimelineRow =
  | { kind: "message"; entry: TranscriptEntry; index: number }
  | { kind: "work"; key: string; work: TurnWork }

function messageSteps(message: ChatMessage): WorkStep[] {
  const steps: WorkStep[] = []
  for (const part of message.parts ?? []) {
    if (part.type !== "tool") continue
    const tool = part.tool?.trim() || "tool"
    steps.push({
      tool,
      title: part.state?.title?.trim() || tool,
      status: part.state?.status ?? "",
    })
  }
  return steps
}

/**
 * Work per turn, keyed by turn number: how many user messages precede
 * the turn's assistant messages (lead-in assistants before any user
 * message are turn 0). Receipt/pending bubbles have no raw message
 * and never carry work.
 */
export function turnWorkByTurn(messages: ChatMessage[]): Map<number, TurnWork> {
  const work = new Map<number, TurnWork>()
  const bounds = new Map<number, { start: number; end: number }>()
  let turn = 0
  for (const message of messages) {
    const role = message.info?.role
    if (role === "user") {
      turn++
      continue
    }
    if (role !== "assistant") continue
    const steps = messageSteps(message)
    if (steps.length === 0) continue
    const created = message.info?.time?.created
    const completed = message.info?.time?.completed
    if (created != null && completed != null) {
      const span = bounds.get(turn)
      if (!span) bounds.set(turn, { start: created, end: completed })
      else {
        span.start = Math.min(span.start, created)
        span.end = Math.max(span.end, completed)
      }
    }
    const existing = work.get(turn)
    if (!existing) {
      work.set(turn, { steps: [...steps], durationMs: null, running: false })
    } else {
      existing.steps.push(...steps)
    }
  }
  for (const [turnIndex, span] of bounds) {
    const row = work.get(turnIndex)
    if (row) row.durationMs = Math.max(0, span.end - span.start)
  }
  return work
}

/**
 * Interleaves entries with their turn's work row. A turn's row lands
 * right after its last assistant bubble — flushed when the next user
 * bubble starts a new turn, or at the end — so a tool-only turn that
 * rendered no assistant bubble at all (the live mid-work case) still
 * gets its row. `live` marks the final turn's work as still running.
 */
export function timelineRows(
  entries: TranscriptEntry[],
  messages: ChatMessage[],
  opts: { live?: boolean } = {},
): TimelineRow[] {
  const work = turnWorkByTurn(messages)
  let lastTurn = 0
  for (const message of messages) {
    if (message.info?.role === "user") lastTurn++
  }
  const rows: TimelineRow[] = []
  // Turn number = user bubbles seen so far; assistant bubbles belong
  // to the current turn (lead-in assistants before any user: turn 0).
  let turn = 0
  const flushed = new Set<number>()
  const flushWorkFor = (turnIndex: number) => {
    if (flushed.has(turnIndex)) return
    flushed.add(turnIndex)
    const turnWork = work.get(turnIndex)
    if (!turnWork || turnWork.steps.length === 0) return
    rows.push({
      kind: "work",
      key: `work-${turnIndex}`,
      work: {
        ...turnWork,
        running: Boolean(opts.live) && turnIndex === lastTurn,
      },
    })
  }
  entries.forEach((entry, index) => {
    if (entry.message.info?.role === "user") {
      flushWorkFor(turn)
      turn++
    }
    rows.push({ kind: "message", entry, index })
  })
  flushWorkFor(turn)
  return rows
}

export function formatWorkDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ""
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours} h ${mins} min` : `${hours} h`
}
