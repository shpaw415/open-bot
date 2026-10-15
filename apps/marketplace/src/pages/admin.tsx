import { useCallback, useEffect, useState } from "react"
import type { MarketPlugin } from "../lib/db"
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  IconTile,
  Input,
  SectionHeading,
  icons,
} from "../components/ui"

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

  const pending = plugins.filter((p) => p.status === "pending").length

  return (
    <div className="mx-auto max-w-[860px] px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="text-[26px] font-bold tracking-[-0.015em] text-[#1A2333]">
        Review queue
      </h1>
      <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-[#5F6B80]">
        Instance administrators approve or reject plugins. The admin token is
        the marketplace's ADMIN_TOKEN secret.
      </p>

      {error ? (
        <p className="mt-6 rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-4 text-sm text-[#B4232B]">
          {error}
        </p>
      ) : null}

      {!loaded ? (
        <Card className="mt-8 p-6 text-center">
          <Icon path={icons.lock} className="mx-auto size-6 text-[#825F00]" />
          <h2 className="mt-3 text-[16px] font-bold text-[#1A2333]">
            Review queue is locked
          </h2>
          <p className="mt-1 text-[14px] text-[#5F6B80]">
            Enter your admin token to unlock.
          </p>
          <div className="mx-auto mt-4 flex max-w-[440px] flex-col gap-3 sm:flex-row">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(token)
              }}
              placeholder="ADMIN_TOKEN"
              className="flex-1 font-mono"
            />
            <Button
              onClick={() => void load(token)}
              className="w-full sm:w-auto"
            >
              Unlock
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-8">
          <SectionHeading
            label={pending > 0 ? `Review queue — ${pending} pending` : "Review queue"}
            className="mb-4"
            right={
              <span className="text-[13px] text-[#5F6B80]">
                {plugins.length} registered
              </span>
            }
          />
          <div className="space-y-4">
            {plugins.map((plugin) => (
              <Card key={plugin.id} className="flex gap-4 p-5">
                <IconTile seed={plugin.id} name={plugin.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/plugins/${encodeURIComponent(plugin.id)}`}
                      className="text-[15px] font-semibold text-[#1A2333] hover:text-[#2B3DE8]"
                    >
                      {plugin.name}
                    </a>
                    <span className="font-mono text-[12px] text-[#5F6B80]">
                      v{plugin.version}
                    </span>
                    <Badge status={plugin.status} />
                    {plugin.securityStatus ? (
                      <Badge status={plugin.securityStatus} />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-[#3E4A5F]">
                    {plugin.description}
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button
                      size="sm"
                      onClick={() => void review(plugin.id, "approved")}
                      className="w-full sm:w-auto"
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void review(plugin.id, "rejected")}
                      className="w-full sm:w-auto"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {plugins.length === 0 ? (
              <EmptyState icon={icons.grid} title="Queue clear.">
                Nothing awaiting review.
              </EmptyState>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
