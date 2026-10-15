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
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3DE8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAFAF7]"

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
} as const

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 h-10 text-[14px] font-semibold transition-colors duration-150 select-none active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-[#2B3DE8] text-white shadow-[0_1px_2px_rgba(43,61,232,0.3)] hover:bg-[#2130C4] active:bg-[#1A27A3]",
  secondary:
    "border border-[#D9D3C2] bg-white text-[#1A2333] hover:bg-[#F5F4EE] hover:border-[#C4BDA8]",
  quiet:
    "h-auto p-0 text-[#2B3DE8] hover:underline underline-offset-4 active:translate-y-0",
  danger:
    "border border-[#F0C2BE] bg-[#FDEEEC] text-[#B4232B] hover:bg-[#FBD9D5]",
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
  pass: "border-[#BEE0D0] bg-[#E7F4ED] text-[#157A55]",
  pending: "border-[#E7D294] bg-[#FFF4D1] text-[#825F00]",
  danger: "border-[#F0C2BE] bg-[#FDEEEC] text-[#B4232B]",
  dev: "border-[#C6C6EC] bg-[#ECECFB] text-[#4B4BB5]",
  neutral: "border-[#D5DBE3] bg-[#EEF0F3] text-[#5F6B80]",
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
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-[3px] text-[12.5px] font-medium ${badgeTones[tone]} ${className}`}
    >
      {tone === "pass" ? (
        <Icon path={icons.check} className="size-3.5" />
      ) : null}
      {status}
    </span>
  )
}

export function TagChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[6px] border border-[#E7E2D6] bg-[#F1EFE8] px-1.5 py-[2px] text-[12.5px] text-[#5F6B80]">
      <span className="opacity-70">#</span>
      {children}
    </span>
  )
}

export function CategoryChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#E7E2D6] bg-white px-2.5 py-[2px] text-[12.5px] font-medium text-[#3E4A5F]">
      {children}
    </span>
  )
}

export const inputClasses =
  "h-11 w-full rounded-[10px] border border-[#D9D3C2] bg-white px-3.5 text-[15px] text-[#1A2333] placeholder:text-[#5F6B80]/80 focus:border-[#2B3DE8] focus:ring-2 focus:ring-[#2B3DE8]/20 focus:outline-none transition-colors duration-150"

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClasses} ${className}`} {...rest} />
}

const cardShadow =
  "shadow-[0_1px_2px_rgba(26,35,51,0.05),0_8px_24px_-12px_rgba(26,35,51,0.12)]"

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
    "rounded-[16px] border border-[#E7E2D6] bg-white",
    cardShadow,
    interactive
      ? "block transition-all duration-150 hover:border-[#D9D3C2] hover:shadow-[0_2px_4px_rgba(26,35,51,0.06),0_12px_32px_-12px_rgba(26,35,51,0.18)]"
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
        <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[#1A2333]">
          {label}
        </h2>
        {sub ? <p className="mt-1 text-[14px] text-[#5F6B80]">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0 pb-0.5">{right}</div> : null}
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
      className={`h-7 rounded-[8px] border px-2.5 font-mono text-[12.5px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3DE8] ${
        copied
          ? "border-[#BEE0D0] bg-[#E7F4ED] text-[#157A55]"
          : "border-[#C7CDF6] bg-white text-[#2B3DE8] hover:bg-[#EEF0FE]"
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
        <span key={index} className="block text-[#5F6B80]">
          {line}
        </span>
      )
    }
    const prompt = line.startsWith("$ ")
    const body = prompt ? line.slice(2) : line
    return (
      <span key={index} className="block whitespace-pre">
        {prompt ? <span className="font-bold text-[#2B3DE8]">$ </span> : null}
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
      className={`relative overflow-hidden rounded-[12px] border border-[#D6DEF6] bg-[#EDF1FC] ${className}`}
    >
      <div className="flex h-10 items-center justify-between border-b border-[#D6DEF6] px-4">
        <span className="font-mono text-[12px] font-medium text-[#5F6B80]">
          {label}
        </span>
        {copy && command ? <CopyButton text={command} /> : null}
      </div>
      <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[13.5px] leading-6 text-[#1A2333]">
        {children ?? renderCommandLines(command ?? "")}
      </pre>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[6px] border border-[#E7E2D6] bg-[#F5F4EE] px-1.5 py-0.5 font-mono text-[12.5px] text-[#1A2333]">
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
        className={`${size} animate-spin rounded-full border-2 border-[#D9D3C2] border-t-[#2B3DE8]`}
      />
      {label ? (
        <p className="mt-3 text-[13px] text-[#5F6B80]">{label}</p>
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
    <div className="rounded-[16px] border border-[#E7E2D6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(26,35,51,0.05)]">
      <Icon path={icon} className="mx-auto mb-3 size-8 text-[#8A94A6]" />
      <p className="text-[15px] font-semibold text-[#1A2333]">{title}</p>
      {children ? (
        <p className="mt-1 text-[14px] text-[#5F6B80]">{children}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

const TILE_PAIRS = [
  "#FFE3C7,#FFC79A",
  "#D9E9FF,#AACBFF",
  "#D3F2E2,#9BDFC0",
  "#E6E1FF,#C3B8FF",
  "#FFF0B8,#F5D67A",
  "#FFD9DE,#F5A9B5",
  "#CFF5F0,#8FE0D4",
  "#EDE6D3,#D3C8A8",
] as const

export function IconTile({
  seed,
  name,
  size = "size-11",
  rounded = "rounded-[12px]",
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
      <span className={`font-sans font-bold text-[#1A2333]/80 ${text}`}>
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
