import Skeleton from "@shpaw415/mui-lite/Skeleton"

// Bubble-shaped placeholders shown while a page of messages loads (a
// thread's first page, or an older page prepended at the top of the
// log). Shapes mirror the timeline geometry — short right-aligned
// user pills, wider left-aligned assistant answers — so the log keeps
// its rhythm instead of collapsing to a spinner + caption row.
// `label` names the load for assistive tech; nothing visible is text.
const SHAPES = [
  { role: "user", width: "42%", height: 44 },
  { role: "assistant", width: "78%", height: 72 },
  { role: "user", width: "30%", height: 44 },
  { role: "assistant", width: "64%", height: 56 },
  { role: "assistant", width: "56%", height: 48 },
] as const

export function MessageSkeletons({
  rows = 3,
  label,
}: {
  rows?: number
  label?: string
}) {
  const shown = Array.from(
    { length: Math.max(1, rows) },
    (_, index) => SHAPES[index % SHAPES.length] ?? SHAPES[0],
  )
  return (
    <output className="ob-msg-skeletons" aria-busy="true" aria-label={label}>
      {shown.map((shape, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={index}
          className={`ob-msg ob-msg-${shape.role}`}
          aria-hidden="true"
        >
          <Skeleton
            variant="rounded"
            className="ob-msg-skeleton"
            width={shape.width}
            height={shape.height}
            sx={shape.role === "user" ? { alignSelf: "flex-end" } : undefined}
          />
        </div>
      ))}
    </output>
  )
}
