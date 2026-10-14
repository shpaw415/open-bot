import type { JSX } from "react"
import { usePath } from "../hooks/usePath"
import { Beacon, LogoLockup, buttonClasses } from "../components/ui"

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
      className={`relative inline-flex h-9 items-center rounded-[10px] px-3 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF] ${
        active
          ? "border border-[#1D2735] bg-[#141B26] text-[#EDF2F7] after:absolute after:bottom-[6px] after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-[#C8FF2E]"
          : "text-[#8B9CB8] hover:bg-[#141B26] hover:text-[#EDF2F7]"
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
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF] ${
        active
          ? "border-[#1D2735] bg-[#141B26] text-[#EDF2F7]"
          : "border-transparent text-[#8B9CB8]"
      }`}
    >
      {active ? (
        <span className="size-1 rounded-full bg-[#C8FF2E]" />
      ) : null}
      {label}
    </a>
  )
}

export default function Layout({ children }: { children: JSX.Element }) {
  const path = usePath()
  return (
    <div className="min-h-screen bg-[#05070A] text-[#EDF2F7] antialiased">
      <header className="sticky top-0 z-40 border-b-0 bg-[#05070A]/90 backdrop-blur-[6px]">
        <nav className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-5 sm:h-16 sm:px-8">
          <a href="/" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF] rounded-[10px]">
            <LogoLockup />
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
              className={`${buttonClasses("secondary", "sm", "ml-2")} ${
                isActive(path, "/account")
                  ? "border-[#1D2735] bg-[#141B26]"
                  : ""
              }`}
            >
              Account
            </a>
          </div>
        </nav>
        <div className="sm:hidden">
          <div className="mx-auto -mx-5 flex max-w-[1120px] gap-1.5 overflow-x-auto px-5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <Beacon />
      </header>
      <main className="animate-[fadeUp_300ms_ease-out] pt-[100px] sm:pt-[66px]">
        {children}
      </main>
      <footer className="mt-20 border-t border-[#1D2735] bg-[#080C12]">
        <div className="mx-auto grid max-w-[1120px] gap-8 px-5 py-10 sm:grid-cols-[1fr_auto] sm:px-8">
          <div>
            <LogoLockup compact />
            <p className="mt-3 font-mono text-[12.5px] text-[#8B9CB8]">
              market.open-bot.app
            </p>
            <p className="mt-1 text-[13px] text-[#5B6B84]">
              Built and maintained by agents.
            </p>
          </div>
          <div className="flex gap-5 text-[13px] text-[#8B9CB8]">
            <a href="/" className="transition-colors hover:text-[#C8FF2E]">
              Browse
            </a>
            <a href="/publish" className="transition-colors hover:text-[#C8FF2E]">
              Publish
            </a>
            <a href="/admin" className="transition-colors hover:text-[#C8FF2E]">
              Review
            </a>
            <a
              href="/account"
              className="transition-colors hover:text-[#C8FF2E]"
            >
              Account
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
