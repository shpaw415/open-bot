export interface CalloutProps {
  type?: "note" | "warning" | "tip"
  children: React.ReactNode
}

const styles = {
  note: {
    wrap: "border-border bg-card",
    label: "text-accent",
    icon: "ℹ️",
  },
  warning: {
    wrap: "border-yellow-600/40 bg-yellow-500/10",
    label: "text-yellow-500",
    icon: "⚠️",
  },
  tip: {
    wrap: "border-emerald-600/40 bg-emerald-500/10",
    label: "text-emerald-500",
    icon: "💡",
  },
} as const

export function Callout({ type = "note", children }: CalloutProps) {
  const style = styles[type]
  return (
    <div
      className={`not-prose my-4 flex gap-3 rounded-lg border p-4 ${style.wrap}`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {style.icon}
      </span>
      <div className="min-w-0 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  )
}

export default Callout
