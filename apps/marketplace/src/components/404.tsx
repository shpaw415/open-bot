export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-6xl font-bold text-blue-500">404</p>
        <p className="mt-3 text-slate-400">This plugin does not exist.</p>
        <a
          href="/"
          className="mt-6 inline-block rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold hover:bg-blue-500"
        >
          Browse plugins
        </a>
      </div>
    </div>
  )
}
