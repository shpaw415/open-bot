import { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Button,
  Card,
  Input,
  LogoMark,
  SectionHeading,
  Spinner,
} from "../components/ui"

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

  const displayName = user
    ? (user.name || user.email || user.userId)
    : ""
  const initial = displayName ? displayName.charAt(0).toUpperCase() : "?"

  return (
    <div className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
      {error ? (
        <p className="mb-6 rounded-[10px] border border-[rgba(255,92,92,0.32)] bg-[rgba(255,92,92,0.08)] p-4 text-sm text-[#FF8A8A]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <Spinner size="size-8" label="Loading account…" className="py-16" />
      ) : !user ? (
        <Card className="mx-auto max-w-[480px] p-8 text-center">
          <LogoMark className="mx-auto" />
          <h1 className="mt-4 text-[22px] font-bold tracking-[-0.01em] text-[#EDF2F7]">
            Sign in to manage keys
          </h1>
          <p className="mx-auto mt-2 max-w-[40ch] text-[14px] leading-6 text-[#8B9CB8]">
            Create an API key to publish plugins from your open-bot desktop.
            Paste it on the dashboard Plugins page.
          </p>
          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => window.location.assign("/api/auth/login")}
          >
            Sign in
          </Button>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#5B6B84]">
            Keys are per-human. Agents use desktop vaults.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="self-start p-6">
            <span className="grid size-12 place-items-center rounded-[12px] bg-[linear-gradient(135deg,#C8FF2E,#5EEAD4)] text-[18px] font-extrabold text-[#1A2000]">
              {initial}
            </span>
            <p className="mt-3 text-[15px] font-bold text-[#EDF2F7]">
              {displayName}
            </p>
            {user.email ? (
              <p className="mt-0.5 break-all font-mono text-[12px] text-[#8B9CB8]">
                {user.email}
              </p>
            ) : null}
            <form action="/api/auth/logout" method="post" className="mt-5">
              <Button variant="secondary" size="sm" className="w-full" type="submit">
                Sign out
              </Button>
            </form>
          </Card>

          <div className="min-w-0">
            {freshKey ? (
              <div className="rounded-[12px] border border-[rgba(200,255,46,0.4)] bg-[rgba(200,255,46,0.07)] p-5">
                <p className="text-[14px] font-semibold text-[#C8FF2E]">
                  API key created — shown only once
                </p>
                <code className="mt-2 block overflow-x-auto rounded-[10px] border border-[#1D2735] bg-[#080C12] p-3 font-mono text-[13px] text-[#D4DCE8]">
                  {freshKey}
                </code>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#FFB224]">
                    Copy now. We never show it again.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setFreshKey("")}>
                    Done, I saved it
                  </Button>
                </div>
              </div>
            ) : null}

            <Card className="p-6">
              <SectionHeading label="API keys" />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  placeholder="Label (e.g. home desktop)"
                  className="flex-1"
                />
                <Button
                  onClick={() => void createKey()}
                  disabled={creating}
                  className="w-full sm:w-auto"
                >
                  Create key
                </Button>
              </div>
              <ul className="mt-4 divide-y divide-[#1D2735] border-t border-[#1D2735]">
                {keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5"
                  >
                    <span className="max-w-[180px] truncate font-mono text-[13px] text-[#EDF2F7]">
                      obm_…{key.hint}
                    </span>
                    {key.label ? (
                      <span className="text-[13px] font-semibold text-[#EDF2F7]">
                        {key.label}
                      </span>
                    ) : null}
                    {key.revoked ? <Badge status="revoked" /> : null}
                    <span className="w-full font-mono text-[12px] text-[#8B9CB8] sm:w-auto">
                      LAST USED{" "}
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleDateString()
                        : "NEVER"}{" "}
                      · CREATED {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                    {!key.revoked ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void revokeKey(key.id)}
                        className="ml-0 sm:ml-auto"
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
                {keys.length === 0 ? (
                  <li className="py-4 text-sm text-[#8B9CB8]">
                    No API keys yet.
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
