import { buttonClasses } from "./ui"

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#FAFAF7] px-5 text-[#1A2333] antialiased">
      <div className="mx-auto max-w-[560px] py-24 text-center">
        <p className="text-[13px] font-semibold text-[#2B3DE8]">404</p>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.015em] text-[#1A2333]">
          This plugin does not exist.
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-6 text-[#5F6B80]">
          The id you requested was never published or was removed.
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
