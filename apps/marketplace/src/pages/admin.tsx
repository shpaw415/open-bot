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
  Skeleton,
} from "../components/ui"
import { usePageTitle } from "../hooks/usePath"
import type { MarketPlugin } from "../lib/db"
import { dateText, priceText, reviewLabel } from "../lib/format"

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
  isGift?: boolean
}

type StatusFilter = "all" | "pending" | "approved" | "rejected"

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
]

const filterChip = (active: boolean) =>
  `inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active
      ? "border-accent bg-accent text-white"
      : "border-line-strong bg-surface text-ink-2 hover:border-accent hover:text-accent"
  }`

function QueueSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex gap-4 rounded-(--radius-card) border border-line bg-surface p-5 shadow-(--shadow-card)"
        >
          <Skeleton className="size-11 rounded-(--radius-tile)" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-full max-w-[380px]" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-8 w-24 rounded-[10px]" />
              <Skeleton className="h-8 w-24 rounded-[10px]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Admin() {
  usePageTitle("Admin review")
  const [token, setToken] = useState("")
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [reviewing, setReviewing] = useState("")
  const [reviewError, setReviewError] = useState("")
  const [refunding, setRefunding] = useState("")

  const load = useCallback(async (value: string) => {
    setError("")
    setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem("ob-market-admin")
    if (saved) {
      setToken(saved)
      void load(saved)
    }
  }, [load])

  async function review(id: string, status: "approved" | "rejected") {
    setReviewing(`${id}:${status}`)
    setReviewError("")
    try {
      const res = await fetch("/api/admin/plugins", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          body?.error ??
            `could not ${status === "approved" ? "approve" : "reject"} ${id}`,
        )
      }
      await load(token)
    } catch (caught) {
      setReviewError(
        caught instanceof Error ? caught.message : "review action failed",
      )
    } finally {
      setReviewing("")
    }
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
  const visible =
    filter === "all" ? plugins : plugins.filter((p) => p.status === filter)

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <h1 className="text-[24px] font-bold tracking-[-0.015em] text-ink">
        Admin review
      </h1>
      <p className="mt-2 max-w-[62ch] text-[14px] leading-6 text-ink-2">
        Instance administrators approve or reject plugins. The automated
        security review already runs on publish — a passing version is approved
        automatically; use this queue to intervene. The admin token is the
        marketplace's ADMIN_TOKEN secret.
      </p>

      {error ? (
        <p
          className="mt-6 rounded-[10px] border border-bad-line bg-bad-soft p-4 text-sm text-bad"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!loaded ? (
        <Card className="mt-8 p-6 text-center">
          <Icon path={icons.lock} className="mx-auto size-6 text-warn" />
          <h2 className="mt-3 text-[16px] font-bold text-ink">
            Review queue is locked
          </h2>
          <p className="mt-1 text-[14px] text-ink-2">
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
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? "Checking…" : "Unlock"}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-8">
          <SectionHeading
            label={
              pending > 0 ? `Review queue — ${pending} pending` : "Review queue"
            }
            className="mb-3"
            right={
              <span className="text-[13px] text-ink-2">
                {plugins.length} registered
              </span>
            }
          />
          <div className="mb-4 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={filter === entry.key}
                onClick={() => setFilter(entry.key)}
                className={filterChip(filter === entry.key)}
              >
                {entry.label}
                {entry.key !== "all" ? (
                  <span className="ml-1.5 font-mono text-[11.5px] opacity-70">
                    {plugins.filter((p) => p.status === entry.key).length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {reviewError ? (
            <p
              className="mb-4 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] text-bad"
              role="alert"
            >
              {reviewError}
            </p>
          ) : null}

          {loading ? (
            <QueueSkeleton />
          ) : (
            <div className="space-y-4">
              {visible.map((plugin) => (
                <Card key={plugin.id} className="flex gap-4 p-5">
                  <IconTile seed={plugin.id} name={plugin.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/plugins/${encodeURIComponent(plugin.id)}`}
                        className="text-[15px] font-semibold text-ink hover:text-accent"
                      >
                        {plugin.name}
                      </a>
                      <span className="font-mono text-[12px] text-ink-2">
                        v{plugin.version}
                      </span>
                      <Badge status={plugin.status} />
                      {plugin.securityStatus ? (
                        <Badge
                          status={plugin.securityStatus}
                          label={reviewLabel(plugin.securityStatus)}
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-ink-2">
                      {plugin.description}
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <Button
                        size="sm"
                        onClick={() => void review(plugin.id, "approved")}
                        disabled={reviewing !== ""}
                        className="w-full sm:w-auto"
                      >
                        {reviewing === `${plugin.id}:approved`
                          ? "Approving…"
                          : "Approve"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void review(plugin.id, "rejected")}
                        disabled={reviewing !== ""}
                        className="w-full sm:w-auto"
                      >
                        {reviewing === `${plugin.id}:rejected`
                          ? "Rejecting…"
                          : "Reject"}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
              {visible.length === 0 ? (
                <EmptyState icon={icons.grid} title="Nothing here.">
                  {filter === "all"
                    ? "No plugins registered yet."
                    : `No ${filter} plugins.`}
                </EmptyState>
              ) : null}
            </div>
          )}

          <SectionHeading label="Purchases" className="mb-3 mt-10" />
          <p className="mb-4 max-w-[70ch] text-[13px] leading-5 text-ink-2">
            Paid-plugin purchases. Refund a purchase to return the buyer's money
            (Stripe pulls the author's earnings back) and revoke the plugin
            license — the installed copy keeps running, but reinstall and
            updates are blocked.
          </p>
          {purchases.length === 0 ? (
            <EmptyState title="No purchases yet." />
          ) : (
            <>
              {/* Compact rows on mobile, table from sm up. */}
              <ul className="space-y-3 sm:hidden">
                {purchases.map((purchase) => (
                  <li
                    key={purchase.id}
                    className="rounded-(--radius-card) border border-line bg-surface p-4 shadow-(--shadow-card)"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={`/plugins/${encodeURIComponent(purchase.pluginId)}`}
                        className="min-w-0 truncate text-[14px] font-semibold text-accent underline-offset-4 hover:underline"
                      >
                        {purchase.pluginName}
                      </a>
                      <span
                        className={`shrink-0 rounded-full px-2 py-[2px] text-[11.5px] font-semibold ${
                          purchase.status === "paid"
                            ? "bg-good-soft text-good"
                            : purchase.status === "refunded"
                              ? "bg-bad-soft text-bad"
                              : "bg-warn-soft text-warn"
                        }`}
                      >
                        {purchase.status}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between font-mono text-[12px] text-ink-2">
                      <span>
                        {purchase.isGift
                          ? "gift"
                          : priceText(purchase.amountCents)}
                      </span>
                      <span>{dateText(purchase.createdAt)}</span>
                    </div>
                    {purchase.status === "paid" && !purchase.isGift ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void refund(purchase.id)}
                        disabled={refunding === purchase.id}
                        className="mt-3 w-full"
                      >
                        {refunding === purchase.id
                          ? "Refunding…"
                          : `Refund ${priceText(purchase.amountCents)}`}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Card className="hidden overflow-x-auto p-0 sm:block">
                <table className="w-full min-w-[640px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-2">
                      <th className="px-4 py-3 font-semibold">Plugin</th>
                      <th className="px-4 py-3 font-semibold">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {purchases.map((purchase) => (
                      <tr key={purchase.id}>
                        <td className="px-4 py-3">
                          <a
                            href={`/plugins/${encodeURIComponent(purchase.pluginId)}`}
                            className="font-semibold text-accent underline-offset-4 hover:underline"
                          >
                            {purchase.pluginName}
                          </a>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {purchase.isGift
                            ? "gift"
                            : priceText(purchase.amountCents)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-[2px] text-[11.5px] font-semibold ${
                              purchase.status === "paid"
                                ? "bg-good-soft text-good"
                                : purchase.status === "refunded"
                                  ? "bg-bad-soft text-bad"
                                  : "bg-warn-soft text-warn"
                            }`}
                          >
                            {purchase.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-2">
                          {dateText(purchase.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {purchase.status === "paid" && !purchase.isGift ? (
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
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
