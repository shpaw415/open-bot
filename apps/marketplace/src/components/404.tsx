import { buttonClasses } from "./ui"

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-ink">
      <div className="mx-auto max-w-[560px] py-20 text-center">
        <p className="text-[13px] font-semibold text-accent">404</p>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.015em] text-ink">
          This page does not exist.
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-6 text-ink-2">
          The address was never published, the plugin was removed, or the link
          is mistyped.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/" className={buttonClasses("primary", "md")}>
            Browse plugins
          </a>
          <a href="/publish" className={buttonClasses("secondary", "md")}>
            Publish one
          </a>
        </div>
      </div>
    </div>
  )
}
