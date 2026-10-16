import { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  IconTile,
  Input,
  icons,
  SectionHeading,
} from "../components/ui"
import type { MarketPlugin } from "../lib/db"

type PurchaseRow = {
  id: string
  pluginId: string
  pluginName: string
  amountCents: number
  feeCents: number
  earningsCents: number
  status: "pending" | "paid" | "refunded"
  createdAt: number
  paidAt: number | null
}

function priceText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function Admin() {
  const [token, setToken] = useState("")
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [refunding, setRefunding] = useState("")

  const load = useCallback(async (value: string) => {
    setError("")
    try {
      const [pluginsRes, purchasesRes] = await Promise.all([
        fetch("/api/admin/plugins", {
          headers: { authorization: `Bearer ${value}` },
        }),
        fetch("/api/admin/purchases", {
          headers: { authorization: `Bearer ${value}` },
        }),
      ])
      const body = (await pluginsRes.json()) as {
        plugins?: MarketPlugin[]
        error?: string
      }
      if (!pluginsRes.ok) throw new Error(body.error ?? "unauthorized")
      setPlugins(body.plugins ?? [])
      if (purchasesRes.ok) {
        const purchasesBody = (await purchasesRes.json()) as {
          purchases?: PurchaseRow[]
        }
        setPurchases(purchasesBody.purchases ?? [])
      }
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

  async function refund(purchaseId: string) {
    if (
      !window.confirm(
        "Refund this purchase? The buyer's license is revoked and the author's earnings are pulled back via Stripe.",
      )
    ) {
      return
    }
    setRefunding(purchaseId)
    setError("")
    try {
      const res = await fetch(
        `/api/purchases/${encodeURIComponent(purchaseId)}/refund`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: "admin refund (admin page)" }),
        },
      )
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? "refund failed")
      await load(token)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "refund failed")
    } finally {
      setRefunding("")
    }
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
            label={
              pending > 0 ? `Review queue — ${pending} pending` : "Review queue"
            }
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

          <SectionHeading label="Purchases" className="mb-4 mt-10" />
          <p className="mb-4 max-w-[70ch] text-[13px] leading-5 text-[#5F6B80]">
            Paid-plugin purchases. Refund a purchase to return the buyer's money
            (Stripe pulls the author's earnings back) and revoke the plugin
            license — the installed copy keeps running, but reinstall and
            updates are blocked.
          </p>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[#E7E2D6] text-[12px] uppercase tracking-wide text-[#5F6B80]">
                  <th className="px-4 py-3 font-semibold">Plugin</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E2D6]">
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="px-4 py-3">
                      <a
                        href={`/plugins/${encodeURIComponent(purchase.pluginId)}`}
                        className="font-semibold text-[#2B3DE8] underline-offset-4 hover:underline"
                      >
                        {purchase.pluginName}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {priceText(purchase.amountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-[2px] text-[11.5px] font-semibold ${
                          purchase.status === "paid"
                            ? "bg-[#E7F4ED] text-[#157A55]"
                            : purchase.status === "refunded"
                              ? "bg-[#FDEEEC] text-[#B4232B]"
                              : "bg-[#FFF8E1] text-[#5F4A00]"
                        }`}
                      >
                        {purchase.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#5F6B80]">
                      {new Date(purchase.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {purchase.status === "paid" ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void refund(purchase.id)}
                          disabled={refunding === purchase.id}
                        >
                          {refunding === purchase.id
                            ? "Refunding…"
                            : `Refund ${priceText(purchase.amountCents)}`}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-[#5F6B80]">
                      No purchases yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  )
}
