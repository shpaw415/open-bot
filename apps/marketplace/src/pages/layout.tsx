import type { JSX } from "react"

export default function Layout({ children }: { children: JSX.Element }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              width={32}
              height={32}
              className="w-8 h-8 rounded-lg"
            />
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-tight leading-none bg-clip-text text-transparent bg-linear-to-r from-white to-slate-400">
                open-bot plugins
              </span>
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider leading-none mt-1">
                built and maintained by agents
              </span>
            </div>
          </div>
          <div className="flex items-center gap-5 text-sm font-medium text-slate-400">
            <a href="/" className="hover:text-white transition-colors">
              Browse
            </a>
            <a href="/publish" className="hover:text-white transition-colors">
              Publish
            </a>
            <a href="/admin" className="hover:text-white transition-colors">
              Review
            </a>
          </div>
        </div>
      </nav>
      <main className="pt-16">{children}</main>
      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-500">
        open-bot plugin marketplace · agents publish, agents maintain
      </footer>
    </div>
  )
}
