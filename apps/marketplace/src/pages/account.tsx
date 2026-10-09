import { useCallback, useEffect, useState } from "react"

type AccountUser = { userId: string; email: string | null; name: string | null }

type ApiKeyRow = {
  id: string
  label: string
  hint: string
  createdAt: number
  lastUsedAt: number | null
  revoked: boolean
}

export default function Account() {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [freshKey, setFreshKey] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/keys")
      if (res.status === 401) {
        setUser(null)
        setKeys([])
        return
      }
      const body = (await res.json()) as {
        user?: AccountUser
        keys?: ApiKeyRow[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? "failed")
      setUser(body.user ?? null)
      setKeys(body.keys ?? [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createKey() {
    setCreating(true)
    setError("")
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      const body = (await res.json()) as { key?: string; error?: string }
      if (!res.ok || !body.key) throw new Error(body.error ?? "failed")
      setFreshKey(body.key)
      setLabel("")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to create")
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" })
    await load()
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      <p className="mt-2 text-sm text-slate-400">
        Create an API key to publish plugins from your open-bot desktop. Paste
        it on the dashboard Plugins page.
      </p>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 py-10 text-center text-sm text-slate-500">
          Loading…
        </p>
      ) : !user ? (
        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
          <p className="text-slate-300">Sign in to manage your API keys.</p>
          <button
            type="button"
            onClick={() => window.location.assign("/api/auth/login")}
            className="mt-4 inline-block rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold hover:bg-blue-500"
          >
            Sign in
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div>
              <p className="font-semibold text-white">
                {user.name || user.email || user.userId}
              </p>
              {user.email ? (
                <p className="text-sm text-slate-500">{user.email}</p>
              ) : null}
            </div>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Sign out
              </button>
            </form>
          </div>

          {freshKey ? (
            <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5">
              <p className="text-sm font-semibold text-emerald-400">
                API key created — copy it now, it is shown only once
              </p>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">
                {freshKey}
              </code>
              <button
                type="button"
                onClick={() => setFreshKey("")}
                className="mt-2 text-xs text-slate-400 hover:text-white"
              >
                Done, I saved it
              </button>
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              API keys
            </h2>
            <div className="mt-3 flex gap-2">
              <input
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="Label (e.g. home desktop)"
                className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void createKey()}
                disabled={creating}
                className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
              >
                Create key
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3"
                >
                  <span className="font-mono text-sm text-slate-200">
                    obm_…{key.hint}
                  </span>
                  <span className="text-xs text-slate-500">{key.label}</span>
                  {key.revoked ? (
                    <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-400">
                      revoked
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {key.lastUsedAt
                        ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                        : "never used"}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-600">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </span>
                  {!key.revoked ? (
                    <button
                      type="button"
                      onClick={() => void revokeKey(key.id)}
                      className="rounded-full border border-red-500/50 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
              {keys.length === 0 ? (
                <li className="text-sm text-slate-500">No API keys yet.</li>
              ) : null}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
