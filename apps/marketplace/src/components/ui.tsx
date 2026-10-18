import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"

export function Icon({
  path,
  className = "",
  fill = false,
}: {
  path: string
  className?: string
  fill?: boolean
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 ${className}`}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={fill ? undefined : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

export const icons = {
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm4.2-.5L14 14",
  chevronRight: "M6 3.5 10.5 8 6 12.5",
  chevronDown: "M3.5 6 8 10.5 12.5 6",
  download: "M8 2v8m0 0 3-3m-3 3-3-3M3 13.5h10",
  warning: "M8 1.5 15 14H1L8 1.5Zm0 4.5v3.5m0 2v.1",
  lock: "M4.5 7V5a3.5 3.5 0 1 1 7 0v2m-8 0h9a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z",
  arrowLeft: "M13 8H3m0 0 4-4M3 8l4 4",
  check: "M3 8.5 6.5 12 13 4.5",
  grid: "M2.5 2.5h4.5v4.5H2.5V2.5Zm6.5 0h4.5v4.5H9V2.5ZM2.5 9h4.5v4.5H2.5V9Zm6.5 0h4.5v4.5H9V9Z",
  spark: "M8 1.5 9.5 6 14 7.5 9.5 9 8 13.5 6.5 9 2 7.5 6.5 6 8 1.5Z",
  user: "M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Zm-5.5 6c.5-2.9 2.75-4.5 5.5-4.5s5 1.6 5.5 4.5",
  clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Zm0-9.5V8l2.5 1.5",
  wrench:
    "M9.5 5.5a3 3 0 0 1 4-2.8L11.5 4.7l1.8 1.8 2-2a3 3 0 0 1-3.9 3.9L5 14.8a1.5 1.5 0 0 1-2.1-2.1l6.4-6.4c.1-.3.2-.5.2-.8Z",
  sliders: "M2.5 4.5h6m3 0h2m-11 7h2m3 0h6M11 2.5v4m-5 3v4",
  key: "M9.5 11.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 3.3 4.7L14 10.4V13h-2.5l-.7-.7a3.5 3.5 0 0 1-1.3-.8Z",
  layout: "M2.5 2.5h11v11h-11v-11Zm0 4h11m-4 0v7",
  message:
    "M14 10.5a1 1 0 0 1-1 1H5l-3 3v-11a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7Z",
  plug: "M6 1.5v3m4-3v3M4 4.5h8v3a4 4 0 0 1-8 0v-3Zm4 7v3",
  github:
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  x: "M4 4l8 8m0-8-8 8",
  copy: "M5.5 5.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-2.5m-7-5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5Z",
  shield:
    "M8 1.5 13.5 3.6v4.2c0 3.2-2.3 5.6-5.5 6.7-3.2-1.1-5.5-3.5-5.5-6.7V3.6L8 1.5Z",
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3",
  tag: "M2.5 2.5h5l6 6-5 5-6-6v-5Zm2.5 2.5v.1",
  cube: "M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Zm0 0v6.5M14 5 8 8 2 5",
} as const

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 h-10 text-[14px] font-semibold transition-colors duration-150 select-none active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_2px_rgba(43,61,232,0.3)] hover:bg-accent-strong active:bg-accent-deep",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-sunken hover:border-ink-3/60",
  quiet:
    "h-auto p-0 text-accent hover:underline underline-offset-4 active:translate-y-0",
  danger: "border border-bad-line bg-bad-soft text-bad hover:bg-[#fbdcd9]",
}

const buttonSizes: Record<string, string> = {
  sm: "!h-8 !px-3 !text-[13px]",
  md: "",
  lg: "!h-12 !px-6 !text-[15px]",
}

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: "sm" | "md" | "lg" = "md",
  className = "",
) {
  return [
    buttonBase,
    buttonVariants[variant],
    buttonSizes[size],
    focusRing,
    className,
  ]
    .filter(Boolean)
    .join(" ")
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: "sm" | "md" | "lg"
}) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...rest}
    />
  )
}

type BadgeTone = "pass" | "pending" | "danger" | "dev" | "neutral"

const badgeTones: Record<BadgeTone, string> = {
  pass: "border-good-line bg-good-soft text-good",
  pending: "border-warn-line bg-warn-soft text-warn",
  danger: "border-bad-line bg-bad-soft text-bad",
  dev: "border-accent-line bg-accent-soft text-accent",
  neutral: "border-line bg-sunken text-ink-2",
}

const badgeStatusMap: Record<string, BadgeTone> = {
  approved: "pass",
  pass: "pass",
  pending: "pending",
  queued: "pending",
  running: "pending",
  rejected: "danger",
  concern: "danger",
  revoked: "danger",
  error: "danger",
  dev: "dev",
}

export function Badge({
  status,
  label,
  className = "",
}: {
  status: string
  label?: string
  className?: string
}) {
  const tone = badgeStatusMap[status.toLowerCase()] ?? "neutral"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-[3px] text-[12.5px] font-medium ${badgeTones[tone]} ${className}`}
    >
      {tone === "pass" ? (
        <Icon path={icons.check} className="size-3.5" />
      ) : null}
      {label ?? status}
    </span>
  )
}

export function TagChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[6px] border border-line bg-sunken px-1.5 py-[2px] text-[12.5px] text-ink-2">
      <span className="opacity-70">#</span>
      {children}
    </span>
  )
}

export function CategoryChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-[2px] text-[12.5px] font-medium text-ink-2">
      {children}
    </span>
  )
}

export const inputClasses =
  "h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors duration-150"

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClasses} ${className}`} {...rest} />
}

const cardShadow = "shadow-(--shadow-card)"

export function Card({
  href,
  interactive = false,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  href?: string
  interactive?: boolean
}) {
  const classes = [
    "rounded-(--radius-card) border border-line bg-surface",
    cardShadow,
    interactive
      ? "block transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-(--shadow-card-hover)"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

export function SectionHeading({
  label,
  right,
  sub,
  className = "",
}: {
  label: string
  right?: ReactNode
  sub?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
          {label}
        </h2>
        {sub ? <p className="mt-1 text-[13.5px] text-ink-2">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0 pb-0.5">{right}</div> : null}
    </div>
  )
}

type CopyState = "idle" | "copied" | "failed"

// Only reports success after the copy actually succeeded: the async
// clipboard API rejects when blocked (permissions, focus, sandbox), and the
// execCommand fallback returns false — both surface as a visible, announced
// failure with a manual-selection hint instead of a false "Copied".
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string
  label?: string
  className?: string
}) {
  const [state, setState] = useState<CopyState>("idle")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    const ok = await copyTextToClipboard(text)
    setState(ok ? "copied" : "failed")
    clearTimeout(timer.current)
    if (ok) {
      timer.current = setTimeout(() => setState("idle"), 1500)
    } else {
      timer.current = setTimeout(() => setState("idle"), 4000)
    }
  }
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => void copy()}
        className={`h-7 rounded-[8px] border px-2.5 font-mono text-[12.5px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          state === "copied"
            ? "border-good-line bg-good-soft text-good"
            : state === "failed"
              ? "border-bad-line bg-bad-soft text-bad"
              : "border-accent-line bg-surface text-accent hover:bg-accent-soft"
        }`}
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}
      </button>
      <span role="status" className="sr-only">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "failed"
            ? "Copy failed — select the text and copy it manually"
            : ""}
      </span>
    </span>
  )
}

function renderCommandLines(text: string) {
  return text.split("\n").map((line, index) => {
    if (line.startsWith("#")) {
      return (
        <span key={index} className="block text-ink-2">
          {line}
        </span>
      )
    }
    const prompt = line.startsWith("$ ")
    const body = prompt ? line.slice(2) : line
    return (
      <span key={index} className="block whitespace-pre">
        {prompt ? <span className="font-bold text-accent">$ </span> : null}
        {body}
      </span>
    )
  })
}

export function CommandBlock({
  label = "terminal",
  command,
  copy = true,
  children,
  className = "",
}: {
  label?: string
  command?: string
  copy?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[12px] border border-accent-line bg-accent-soft ${className}`}
    >
      <div className="flex h-10 items-center justify-between border-b border-accent-line px-4">
        <span className="font-mono text-[12px] font-medium text-ink-2">
          {label}
        </span>
        {copy && command ? <CopyButton text={command} /> : null}
      </div>
      <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[13.5px] leading-6 text-ink">
        {children ?? renderCommandLines(command ?? "")}
      </pre>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[6px] border border-line bg-sunken px-1.5 py-0.5 font-mono text-[12.5px] text-ink">
      {children}
    </code>
  )
}

export function Spinner({
  size = "size-6",
  label,
  className = "",
}: {
  size?: string
  label?: string
  className?: string
}) {
  return (
    <div className={`grid place-items-center ${className}`}>
      <span
        className={`${size} animate-spin rounded-full border-2 border-line-strong border-t-accent`}
      />
      {label ? <p className="mt-3 text-[13px] text-ink-2">{label}</p> : null}
    </div>
  )
}

// ——— Skeleton primitives ————————————————————————————————————————————————
// Discreet pulse, aria-hidden (the region carrying them announces loading),
// shaped to match the final layout so swaps are geometrically stable.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken ${className}`}
    />
  )
}

export function PluginRowSkeleton() {
  return (
    <div className="flex items-start gap-4 border-b border-line px-4 py-4 sm:px-5">
      <Skeleton className="size-11 rounded-(--radius-tile) shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <Skeleton className="h-3.5 w-full max-w-[420px]" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
    </div>
  )
}

export function CatalogSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface shadow-(--shadow-card)"
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <PluginRowSkeleton key={index} />
      ))}
    </div>
  )
}

export function PluginDetailSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8"
      aria-hidden="true"
    >
      <Skeleton className="mb-6 h-4 w-20" />
      <div className="rounded-(--radius-card) border border-line bg-surface p-6 shadow-(--shadow-card) sm:p-8">
        <div className="flex gap-5">
          <Skeleton className="size-14 rounded-(--radius-tile)" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-4 w-full max-w-[480px]" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-(--radius-card) border border-line bg-surface p-5 shadow-(--shadow-card) sm:p-6">
            <Skeleton className="h-4 w-24" />
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-(--radius-card) border border-line bg-surface p-5 shadow-(--shadow-card)">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-4 h-[72px] w-full rounded-[12px]" />
          </div>
          <div className="rounded-(--radius-card) border border-line bg-surface p-5 shadow-(--shadow-card)">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-6 w-32" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AccountSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8"
      aria-hidden="true"
    >
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="rounded-(--radius-card) border border-line bg-surface p-6 shadow-(--shadow-card)">
          <Skeleton className="size-12 rounded-[12px]" />
          <Skeleton className="mt-3 h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <div className="space-y-6">
          {[0, 1].map((block) => (
            <div
              key={block}
              className="rounded-(--radius-card) border border-line bg-surface p-6 shadow-(--shadow-card)"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-10 w-full max-w-[360px]" />
              <div className="mt-4 space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// A region whose content is loading: announces busy politely once.
export function LoadingRegion({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  )
}

// Small inline busy/text indicator for refreshes that keep prior content.
export function InlineStatus({ children }: { children: ReactNode }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2"
    >
      {children}
    </span>
  )
}

export function EmptyState({
  icon = icons.grid,
  title,
  children,
  action,
}: {
  icon?: string
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-surface px-6 py-12 text-center shadow-(--shadow-card)">
      <Icon path={icon} className="mx-auto mb-3 size-8 text-ink-3" />
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children ? (
        <p className="mt-1 text-[14px] text-ink-2">{children}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

const TILE_PAIRS = [
  "#FFE3C7,#F5C48E",
  "#D9E4FF,#A8BFFF",
  "#D2EFE0,#96D8BC",
  "#E6E1FF,#C0B4F8",
  "#FFF0B8,#EFD06E",
  "#FFD9DE,#F2A2AF",
  "#CFF3EE,#87D8CB",
  "#E9E4D6,#CDC1A0",
] as const

export function IconTile({
  seed,
  name,
  size = "size-11",
  rounded = "rounded-(--radius-tile)",
  text = "text-[20px]",
}: {
  seed: string
  name: string
  size?: string
  rounded?: string
  text?: string
}) {
  let hash = 0
  for (const char of seed) hash = (hash + char.charCodeAt(0)) % 8
  const [from, to] = (TILE_PAIRS[hash] ?? TILE_PAIRS[0]).split(",")
  const letter = (name.match(/[a-z0-9]/i)?.[0] ?? "•").toUpperCase()
  return (
    <span
      className={`grid shrink-0 place-items-center border border-black/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${size} ${rounded}`}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden="true"
    >
      <span className={`font-sans font-bold text-ink/80 ${text}`}>
        {letter}
      </span>
    </span>
  )
}

export function RobotMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="2.9" r="1.1" fill="currentColor" stroke="none" />
      <path d="M12 5.6V4" />
      <path d="M1.7 12.4v3.2" />
      <path d="M22.3 12.4v3.2" />
      <rect x="4" y="7.6" width="16" height="11.4" rx="3.6" />
      <path d="M8.7 12.1v2.5" strokeWidth={2.4} />
      <path d="M15.3 12.1v2.5" strokeWidth={2.4} />
    </svg>
  )
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`grid size-8 shrink-0 place-items-center rounded-[9px] text-white ${className}`}
      style={{ background: "linear-gradient(135deg, #2B3DE8, #7A86FF)" }}
    >
      <RobotMark className="size-[22px]" />
    </span>
  )
}
