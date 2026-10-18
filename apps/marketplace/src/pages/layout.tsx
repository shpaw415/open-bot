import type { JSX } from "react"
import { buttonClasses, LogoMark } from "../components/ui"
import { navMatches, usePath } from "../hooks/usePath"

// Admin review is a secondary, always-reachable entry: the public data model
// has no admin role, so it is not hidden behind a simulated persona.
const links = [
  { href: "/", label: "Browse" },
  { href: "/publish", label: "Publish" },
  { href: "/admin", label: "Admin review", secondary: true },
]

function NavLink({
  href,
  label,
  active,
  secondary = false,
  mobile = false,
}: {
  href: string
  label: string
  active: boolean
  secondary?: boolean
  mobile?: boolean
}) {
  const tone = active
    ? mobile
      ? "border-accent bg-accent text-white"
      : "bg-accent-soft text-ink after:absolute after:bottom-[4px] after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-accent"
    : secondary
      ? mobile
        ? "border-line bg-surface text-ink-2"
        : "text-ink-2 hover:bg-sunken hover:text-ink"
      : mobile
        ? "border-line bg-surface text-ink"
        : "text-ink-2 hover:bg-sunken hover:text-ink"
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex items-center rounded-[10px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
        mobile
          ? `h-9 shrink-0 rounded-full border px-3.5 text-[13px] ${tone}`
          : `h-9 px-3 text-[14px] ${tone}`
      }`}
    >
      {label}
    </a>
  )
}

export default function Layout({ children }: { children: JSX.Element }) {
  const path = usePath()
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-sm">
        <nav
          aria-label="Main"
          className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
        >
          <a
            href="/"
            className="flex min-w-0 items-center gap-2.5 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogoMark />
            <span className="truncate text-[15px] font-bold tracking-[-0.01em]">
              open-bot <span className="font-medium text-ink-2">plugins</span>
            </span>
          </a>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div className="hidden items-center gap-0.5 sm:flex">
              {links
                .filter((link) => !link.secondary)
                .map((link) => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                    active={navMatches(path, link.href)}
                  />
                ))}
            </div>
            <a
              href="/account"
              aria-current={navMatches(path, "/account") ? "page" : undefined}
              className={`${buttonClasses("secondary", "sm", "ml-1 max-sm:hidden")} ${
                navMatches(path, "/account")
                  ? "!border-accent !text-accent"
                  : ""
              }`}
            >
              Account
            </a>
            <a
              href="/admin"
              aria-current={navMatches(path, "/admin") ? "page" : undefined}
              className="hidden h-8 items-center rounded-[10px] px-2.5 text-[13px] font-medium text-ink-3 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-flex"
            >
              Admin review
            </a>
          </div>
        </nav>
        <div className="sm:hidden">
          <nav
            aria-label="Sections"
            className="mx-auto flex max-w-[1200px] gap-2 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {links.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={navMatches(path, link.href)}
                secondary={link.secondary}
                mobile
              />
            ))}
            <NavLink
              href="/account"
              label="Account"
              active={navMatches(path, "/account")}
              mobile
            />
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-3 px-4 py-6 text-[13px] text-ink-2 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p className="flex items-center gap-2">
            <LogoMark className="!size-5 !rounded-[6px]" />
            <span>
              open-bot plugins
              <span className="hidden sm:inline">
                {" "}
                — built and maintained by agents.
              </span>
            </span>
          </p>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-4 gap-y-1 font-medium"
          >
            <a href="/" className="hover:text-accent">
              Browse
            </a>
            <a href="/publish" className="hover:text-accent">
              Publish
            </a>
            <a href="/admin" className="hover:text-accent">
              Admin review
            </a>
            <a href="/account" className="hover:text-accent">
              Account
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
