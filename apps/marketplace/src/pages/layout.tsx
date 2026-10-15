import type { JSX } from "react"
import { buttonClasses, LogoMark } from "../components/ui"
import { usePath } from "../hooks/usePath"

const links = [
  { href: "/", label: "Browse" },
  { href: "/publish", label: "Publish" },
  { href: "/admin", label: "Review" },
]

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href)
}

function DesktopLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <a
      href={href}
      className={`relative inline-flex h-9 items-center rounded-[10px] px-3 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3DE8] ${
        active
          ? "bg-[#F1EFE8] text-[#1A2333] after:absolute after:bottom-[5px] after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-[#2B3DE8]"
          : "text-[#3E4A5F] hover:bg-[#F1EFE8] hover:text-[#1A2333]"
      }`}
    >
      {label}
    </a>
  )
}

function MobileLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3DE8] ${
        active
          ? "border-[#2B3DE8] bg-[#2B3DE8] text-white"
          : "border-[#E7E2D6] bg-white text-[#3E4A5F]"
      }`}
    >
      {label}
    </a>
  )
}

export default function Layout({ children }: { children: JSX.Element }) {
  const path = usePath()
  return (
    <div className="min-h-screen bg-[#FAFAF7] text-[#1A2333] antialiased">
      <header className="sticky top-0 z-40 border-b border-[#E7E2D6] bg-white">
        <nav className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-8">
          <a
            href="/"
            className="flex min-w-0 items-center gap-2.5 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3DE8]"
          >
            <LogoMark />
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-bold leading-tight tracking-[-0.01em]">
                open-bot{" "}
                <span className="font-medium text-[#5F6B80]">plugins</span>
              </span>
              <span className="hidden text-[12.5px] leading-tight text-[#5F6B80] min-[380px]:block">
                Built and maintained by agents.
              </span>
            </span>
          </a>
          <div className="hidden items-center gap-1 sm:flex">
            {links.map((link) => (
              <DesktopLink
                key={link.href}
                {...link}
                active={isActive(path, link.href)}
              />
            ))}
            <a
              href="/account"
              className={`${buttonClasses("secondary", "sm", "ml-2")}`}
            >
              Account
            </a>
          </div>
        </nav>
        <div className="sm:hidden">
          <div className="mx-auto -mx-5 flex max-w-[1120px] gap-2 overflow-x-auto px-5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {links.map((link) => (
              <MobileLink
                key={link.href}
                {...link}
                active={isActive(path, link.href)}
              />
            ))}
            <MobileLink
              href="/account"
              label="Account"
              active={isActive(path, "/account")}
            />
          </div>
        </div>
      </header>
      <main className="animate-[fadeUp_200ms_ease-out]">{children}</main>
      <footer className="border-t border-[#C7CDF6] bg-[#EDF1FC]">
        <div className="mx-auto max-w-[1120px] px-5 py-12 sm:px-8">
          <div className="grid gap-8 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="flex items-center gap-2.5">
                <LogoMark />
                <span className="text-[15px] font-bold tracking-[-0.01em] text-[#1A2333]">
                  open-bot{" "}
                  <span className="font-medium text-[#5F6B80]">plugins</span>
                </span>
              </div>
              <p className="mt-4 font-mono text-[13px] text-[#1A2333]">
                market.open-bot.app
              </p>
              <p className="mt-1 text-[13.5px] text-[#5F6B80]">
                Built and maintained by agents.
              </p>
            </div>
            <div className="flex gap-5 text-[13.5px] text-[#3E4A5F]">
              <a href="/" className="transition-colors hover:text-[#2B3DE8]">
                Browse
              </a>
              <a
                href="/publish"
                className="transition-colors hover:text-[#2B3DE8]"
              >
                Publish
              </a>
              <a
                href="/admin"
                className="transition-colors hover:text-[#2B3DE8]"
              >
                Review
              </a>
              <a
                href="/account"
                className="transition-colors hover:text-[#2B3DE8]"
              >
                Account
              </a>
            </div>
          </div>
          <div className="mt-10 border-t border-[#D6DEF6] pt-6 text-[12.5px] text-[#5F6B80]">
            Plugin directory for open-bot desktops.
          </div>
        </div>
      </footer>
    </div>
  )
}
