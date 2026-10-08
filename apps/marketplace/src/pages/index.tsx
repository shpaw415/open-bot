import { useEffect, useState } from "react"
import type { MarketPlugin } from "../lib/db"

const CATEGORIES = ["", "utilities", "productivity", "media", "devtools", "fun"]

function PluginRow({ plugin }: { plugin: MarketPlugin }) {
  return (
    <a
      href={`/plugins/${encodeURIComponent(plugin.id)}`}
      className="block rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-colors hover:border-blue-500/40 hover:bg-slate-900"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-white">{plugin.name}</span>
        <span className="text-xs font-mono text-slate-500">
          {plugin.id} · v{plugin.version}
        </span>
        {plugin.status !== "approved" ? (
          <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">
            {plugin.status}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-slate-400">{plugin.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-800 px-2 py-0.5">
          {plugin.category}
        </span>
        {plugin.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-slate-800 px-2 py-0.5">
            #{tag}
          </span>
        ))}
        <span className="ml-auto">{plugin.author}</span>
      </div>
    </a>
  )
}

export default function Home() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    if (category) params.set("category", category)
    fetch(`/api/plugins${params.size ? `?${params}` : ""}`)
      .then(
        (res) =>
          res.json() as Promise<{ plugins?: MarketPlugin[]; error?: string }>,
      )
      .then((body) => {
        if (cancelled) return
        if (body.error) setError(body.error)
        else {
          setPlugins(body.plugins ?? [])
          setError("")
        }
      })
      .catch(() => {
        if (!cancelled) setError("marketplace unavailable")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, category])

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Plugin marketplace</h1>
        <a
          href="/account"
          className="mt-1 rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
        >
          Account
        </a>
      </div>
      <p className="mt-2 text-slate-400">
        Plugins extend an open-bot desktop with skills, personalities, scheduled
        jobs, tools, dashboard tabs, and composer features. Agents build and
        maintain them; this marketplace distributes them.
      </p>

      {typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("loginError") ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Sign-in failed ({new URLSearchParams(window.location.search).get("loginError")}). Try again.
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search plugins…"
          className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm outline-none focus:border-blue-500"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value)}
          className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
        >
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item || "all categories"}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-8 grid gap-4">
        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {loading && plugins.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : null}
        {!loading && plugins.length === 0 && !error ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No plugins yet. An agent can publish the first one with{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
              ob-plugin publish
            </code>
            .
          </p>
        ) : null}
        {plugins.map((plugin) => (
          <PluginRow key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </div>
  )
}
