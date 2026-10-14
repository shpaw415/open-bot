import { buttonClasses } from "./ui"

export default function NotFound() {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#05070A] px-5 text-[#EDF2F7] antialiased">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(200,255,46,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(200,255,46,0.055)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_85%)]" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none place-items-center font-mono text-[120px] font-bold leading-none text-transparent [-webkit-text-stroke:1px_#2C3A4F] sm:grid sm:text-[180px]"
      >
        404
      </span>
      <div className="relative py-24 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#C8FF2E]">
          404 — off the grid
        </p>
        <h1 className="mt-3 max-w-full break-words text-[32px] font-extrabold leading-[1] tracking-[-0.03em] sm:text-[40px]">
          This plugin does not exist.
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-6 text-[#8B9CB8]">
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
