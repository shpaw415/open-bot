// Neutral route-transition fallback (ReactToHTML asyncFallback). It renders
// for any route, so it carries no route-specific shape — just a calm,
// accessible placeholder.
export default function Loading() {
  return (
    <div
      className="grid min-h-[60vh] place-items-center px-4 text-ink"
      role="status"
      aria-label="Loading"
    >
      <div className="w-full max-w-[520px] space-y-3" aria-hidden="true">
        <span className="mx-auto block h-5 w-40 animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
        <span className="mx-auto block h-3.5 w-full max-w-[440px] animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
        <span className="mx-auto block h-3.5 w-4/6 max-w-[300px] animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
      </div>
    </div>
  )
}
