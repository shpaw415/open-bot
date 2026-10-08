import { useCallback, useEffect, useState } from "react"
import type { MarketPlugin } from "../lib/db"

export default function Admin() {
  const [token, setToken] = useState("")
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (value: string) => {
    setError("")
    try {
      const res = await fetch("/api/admin/plugins", {
        headers: { authorization: `Bearer ${value}` },
      })
      const body = (await res.json()) as {
        plugins?: MarketPlugin[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? "unauthorized")
      setPlugins(body.plugins ?? [])
      setLoaded(true)
      sessionStorage.setItem("ob-market-admin", value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed")
      setPlugins([])
    }
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem("ob-market-admin")
    if (saved) {
      setToken(saved)
      void load(saved)
    }
  }, [load])

  async function review(id: string, status: string) {
    await fetch("/api/admin/plugins", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id, status }),
    })
    void load(token)
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      <p className="mt-2 text-sm text-slate-400">
        Instance administrators approve or reject plugins. The admin token is
        the marketplace's ADMIN_TOKEN secret.
      </p>
      <div className="mt-6 flex gap-3">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.currentTarget.value)}
          placeholder="ADMIN_TOKEN"
          className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => void load(token)}
          className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500"
        >
          Unlock
        </button>
      </div>
      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {loaded ? (
        <div className="mt-8 grid gap-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <a
                    href={`/plugins/${encodeURIComponent(plugin.id)}`}
                    className="font-semibold text-white hover:underline"
                  >
                    {plugin.name}
                  </a>
                  <span className="font-mono text-xs text-slate-500">
                    v{plugin.version}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      plugin.status === "approved"
                        ? "border border-emerald-500/40 text-emerald-400"
                        : plugin.status === "rejected"
                          ? "border border-red-500/40 text-red-400"
                          : "border border-amber-500/40 text-amber-400"
                    }`}
                  >
                    {plugin.status}
                  </span>
                  {plugin.securityStatus ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                        plugin.securityStatus === "pass"
                          ? "border border-emerald-500/40 text-emerald-400"
                          : plugin.securityStatus === "concern"
                            ? "border border-red-500/40 text-red-400"
                            : "border border-amber-500/40 text-amber-400"
                      }`}
                      title="Automated security review"
                    >
                      sec: {plugin.securityStatus}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-sm text-slate-400">
                  {plugin.description}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void review(plugin.id, "approved")}
                  className="rounded-full border border-emerald-500/50 px-4 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void review(plugin.id, "rejected")}
                  className="rounded-full border border-red-500/50 px-4 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {plugins.length === 0 ? (
            <p className="text-sm text-slate-500">No plugins registered yet.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
