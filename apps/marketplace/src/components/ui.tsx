import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react"

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070A]"

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
  search:
    "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm4.2-.5L14 14",
  chevronRight: "M6 3.5 10.5 8 6 12.5",
  download: "M8 2v8m0 0 3-3m-3 3-3-3M3 13.5h10",
  warning:
    "M8 1.5 15 14H1L8 1.5Zm0 4.5v3.5m0 2v.1",
  lock: "M4.5 7V5a3.5 3.5 0 1 1 7 0v2m-8 0h9a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z",
  arrowLeft: "M13 8H3m0 0 4-4M3 8l4 4",
  grid: "M2.5 2.5h4.5v4.5H2.5V2.5Zm6.5 0h4.5v4.5H9V2.5ZM2.5 9h4.5v4.5H2.5V9Zm6.5 0h4.5v4.5H9V9Z",
  terminal: "M2.5 3.5h11v9h-11v-9Zm2 2.5 2 2-2 2m3.5.5H11",
  spark: "M8 1.5 9.5 6 14 7.5 9.5 9 8 13.5 6.5 9 2 7.5 6.5 6 8 1.5Z",
  user: "M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Zm-5.5 6c.5-2.9 2.75-4.5 5.5-4.5s5 1.6 5.5 4.5",
  clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Zm0-9.5V8l2.5 1.5",
  wrench:
    "M9.5 5.5a3 3 0 0 1 4-2.8L11.5 4.7l1.8 1.8 2-2a3 3 0 0 1-3.9 3.9L5 14.8a1.5 1.5 0 0 1-2.1-2.1l6.4-6.4c.1-.3.2-.5.2-.8Z",
  sliders:
    "M2.5 4.5h6m3 0h2m-11 7h2m3 0h6M11 2.5v4m-5 3v4",
  key: "M9.5 11.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 3.3 4.7L14 10.4V13h-2.5l-.7-.7a3.5 3.5 0 0 1-1.3-.8Z",
  layout:
    "M2.5 2.5h11v11h-11v-11Zm0 4h11m-4 0v7",
  message: "M14 10.5a1 1 0 0 1-1 1H5l-3 3v-11a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7Z",
  plug: "M6 1.5v3m4-3v3M4 4.5h8v3a4 4 0 0 1-8 0v-3Zm4 7v3",
  github: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
} as const

type ButtonVariant = "primary" | "secondary" | "danger" | "link"
type ButtonSize = "sm" | "md" | "lg"

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-[-0.01em] transition-all duration-150 select-none active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-[linear-gradient(180deg,#D8FF5C,#C8FF2E)] text-[#1A2000] shadow-[0_0_0_1px_rgba(200,255,46,0.3),0_8px_24px_-8px_rgba(200,255,46,0.35)] hover:shadow-[0_0_24px_-4px_rgba(200,255,46,0.45)] hover:brightness-[1.04] active:brightness-[0.96]",
  secondary:
    "border border-[#2C3A4F] bg-[#0F141D] text-[#EDF2F7] hover:bg-[#141B26] hover:border-[#3A4A63]",
  danger:
    "border border-[rgba(255,92,92,0.35)] bg-[rgba(255,92,92,0.08)] text-[#FF8A8A] hover:bg-[rgba(255,92,92,0.14)]",
  link: "p-0 text-[#C8FF2E] hover:underline underline-offset-4 decoration-[#C8FF2E]/40",
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
  lg: "h-12 px-6 text-[15px]",
}

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className = "",
) {
  return [
    buttonBase,
    variant === "link" ? "" : buttonSizes[size],
    buttonVariants[variant],
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
  size?: ButtonSize
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

const badgeTones: Record<BadgeTone, { classes: string; led?: string }> = {
  pass: {
    classes:
      "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.12)] text-[#34D399]",
    led: "bg-[#34D399]",
  },
  pending: {
    classes:
      "border-[rgba(255,178,36,0.3)] bg-[rgba(255,178,36,0.12)] text-[#FFB224]",
    led: "bg-[#FFB224] animate-pulse",
  },
  danger: {
    classes:
      "border-[rgba(255,92,92,0.32)] bg-[rgba(255,92,92,0.12)] text-[#FF8A8A]",
  },
  dev: {
    classes:
      "border-[rgba(139,124,255,0.35)] bg-[rgba(139,124,255,0.14)] text-[#B3A8FF]",
  },
  neutral: {
    classes:
      "border-[#2C3A4F] bg-[rgba(147,161,184,0.12)] text-[#8B9CB8]",
  },
}

const badgeStatusMap: Record<string, BadgeTone> = {
  approved: "pass",
  pass: "pass",
  pending: "pending",
  rejected: "danger",
  concern: "danger",
  revoked: "danger",
  dev: "dev",
}

export function Badge({
  status,
  className = "",
}: {
  status: string
  className?: string
}) {
  const tone = badgeStatusMap[status.toLowerCase()] ?? "neutral"
  const def = badgeTones[tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${def.classes} ${className}`}
    >
      {def.led ? (
        <span className={`size-1.5 rounded-full ${def.led}`} />
      ) : null}
      {status}
    </span>
  )
}

export function Chip({
  variant = "tag",
  children,
  className = "",
}: {
  variant?: "category" | "tag"
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[7px] border border-[#1D2735] bg-[#0A0E14] px-2 py-[3px] text-[12px] font-medium text-[#8B9CB8] ${className}`}
    >
      {variant === "category" ? (
        <span className="size-1 rounded-full bg-[#C8FF2E]" />
      ) : null}
      {variant === "tag" ? <span className="text-[#5B6B84]">#</span> : null}
      {children}
    </span>
  )
}

export function VersionChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[7px] border border-[#1D2735] bg-[#0A0E14] px-2 py-[3px] font-mono text-[11px] font-medium text-[#8B9CB8]">
      {children}
    </span>
  )
}

export const inputClasses =
  "h-10 w-full rounded-[10px] border border-[#1D2735] bg-[#080C12] px-3.5 text-[14px] text-[#EDF2F7] placeholder:text-[#8B9CB8]/70 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] focus:border-[#8B7CFF] focus:ring-2 focus:ring-[#8B7CFF]/30 focus:outline-none transition-colors duration-150"

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClasses} ${className}`} {...rest} />
}

export function Card({
  href,
  interactive = false,
  spine = false,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  href?: string
  interactive?: boolean
  spine?: boolean
}) {
  const classes = [
    "relative rounded-[14px] border border-[#1D2735] bg-[#0F141D] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_30px_-12px_rgba(0,0,0,0.7)]",
    interactive
      ? "group block overflow-hidden transition-colors duration-200 hover:bg-[#141B26] hover:border-[#2C3A4F] hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(200,255,46,0.08)]"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")
  const body = (
    <>
      {spine ? (
        <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full bg-[#C8FF2E]/50 transition-all duration-200 group-hover:bg-[#C8FF2E] group-hover:shadow-[0_0_12px_rgba(200,255,46,0.5)]" />
      ) : null}
      {children}
    </>
  )
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {body}
      </a>
    )
  }
  return (
    <div className={classes} {...rest}>
      {body}
    </div>
  )
}

export function SectionHeading({
  label,
  right,
  className = "",
}: {
  label: string
  right?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 pb-3 border-b border-[#1D2735] ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="h-4 w-[3px] shrink-0 rounded-full bg-[#C8FF2E]" />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B9CB8] truncate">
          {label}
        </h2>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      onClick={() => {
        const clipboard = navigator.clipboard
        const done = () => {
          setCopied(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        }
        if (clipboard) {
          clipboard.writeText(text).then(done).catch(done)
        } else {
          const area = document.createElement("textarea")
          area.value = text
          document.body.appendChild(area)
          area.select()
          document.execCommand("copy")
          area.remove()
          done()
        }
      }}
      className={`rounded-[7px] border px-2.5 h-7 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF] ${
        copied
          ? "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.12)] text-[#34D399]"
          : "border-[#2C3A4F] bg-[#0F141D] text-[#8B9CB8] hover:text-[#EDF2F7] hover:border-[#3A4A63]"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function renderCommandLines(text: string) {
  return text.split("\n").map((line, index) => {
    if (line.startsWith("#")) {
      return (
        <span key={index} className="block text-[#8B9CB8]">
          {line}
        </span>
      )
    }
    const prompt = line.startsWith("$ ")
    const body = prompt ? line.slice(2) : line
    return (
      <span key={index} className="block whitespace-pre">
        {prompt ? <span className="font-bold text-[#C8FF2E]">$ </span> : null}
        {body}
      </span>
    )
  })
}

export function CommandBlock({
  label = "terminal — bash",
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
      className={`relative rounded-[12px] border border-[#1D2735] bg-[#080C12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] overflow-hidden ${className}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[linear-gradient(180deg,#C8FF2E,#5EEAD4)]" />
      <div className="flex items-center justify-between pl-4 pr-3 h-9 border-b border-[#1D2735] bg-[#0A0E14]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="size-2 rounded-full bg-[#FF5C5C]/60" />
            <span className="size-2 rounded-full bg-[#FFB224]/60" />
            <span className="size-2 rounded-full bg-[#34D399]/60" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B9CB8] truncate">
            {label}
          </span>
        </div>
        {copy && command ? <CopyButton text={command} /> : null}
      </div>
      <pre className="p-4 pl-5 font-mono text-[13px] leading-6 text-[#D4DCE8] overflow-x-auto">
        {children ?? renderCommandLines(command ?? "")}
      </pre>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[6px] border border-[#1D2735] bg-[#080C12] px-1.5 py-0.5 font-mono text-[12.5px] text-[#C8FF2E]">
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
        className={`${size} animate-spin rounded-full border-2 border-[#2C3A4F] border-t-[#C8FF2E]`}
      />
      {label ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B9CB8]">
          {label}
        </p>
      ) : null}
    </div>
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
    <div className="rounded-[14px] border border-dashed border-[#2C3A4F] bg-[#0A0E14] px-6 py-12 text-center">
      <Icon path={icon} className="mx-auto mb-3 size-8 text-[#5B6B84]" />
      <p className="text-[15px] font-semibold text-[#EDF2F7]">{title}</p>
      {children ? (
        <p className="mt-1 text-[14px] text-[#8B9CB8]">{children}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Beacon() {
  return (
    <div
      className="relative h-[2px] overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(200,255,46,0.18),rgba(94,234,212,0.18),rgba(139,124,255,0.18))]" />
      <div className="beacon-sweep absolute top-0 bottom-0 left-0 w-[120px] bg-[linear-gradient(90deg,transparent,#C8FF2E_50%,transparent)] shadow-[0_0_12px_rgba(200,255,46,0.6)] animate-[beaconSweep_6s_ease-in-out_infinite_alternate] will-change-transform" />
    </div>
  )
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative inline-grid size-8 shrink-0 place-items-center rounded-[10px] border border-[#2C3A4F] bg-[#0F141D] font-mono text-[15px] font-bold text-[#C8FF2E] ${className}`}
    >
      {">_"}
      <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-[#C8FF2E] border-2 border-[#05070A]" />
    </span>
  )
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3 min-w-0">
      <LogoMark />
      <span className="flex flex-col min-w-0">
        <span className="text-[15px] font-bold tracking-[-0.01em] leading-none text-[#EDF2F7]">
          open-bot <span className="text-[#8B9CB8] font-medium">plugins</span>
        </span>
        {!compact ? (
          <span className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] leading-none text-[#5B6B84]">
            built + maintained by agents
          </span>
        ) : null}
      </span>
    </span>
  )
}
