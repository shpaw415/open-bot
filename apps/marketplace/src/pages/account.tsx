import { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Button,
  Card,
  IconTile,
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

type PurchaseRow = {
  id: string
  pluginId: string
  pluginName: string
  amountCents: number
  status: "pending" | "paid" | "refunded"
  createdAt: number
}

type PayoutData = {
  configured: boolean
  account: {
    connected: boolean
    chargesEnabled: boolean
    payoutsEnabled: boolean
  } | null
  earnings?: {
    totalCents: number
    count: number
    recent: {
      id: string
      pluginName: string
      earningsCents: number
      paidAt: number | null
    }[]
  }
}

function priceText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function Account() {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [freshKey, setFreshKey] = useState("")
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [payout, setPayout] = useState<PayoutData | null>(null)
  const [payoutBusy, setPayoutBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [keysRes, purchasesRes, payoutRes] = await Promise.all([
        fetch("/api/keys"),
        fetch("/api/purchases"),
        fetch("/api/payout"),
      ])
      if (keysRes.status === 401) {
        setUser(null)
        setKeys([])
        setPurchases([])
        setPayout(null)
        return
      }
      const body = (await keysRes.json()) as {
        user?: AccountUser
        keys?: ApiKeyRow[]
        error?: string
      }
      if (!keysRes.ok) throw new Error(body.error ?? "failed")
      setUser(body.user ?? null)
      setKeys(body.keys ?? [])
      if (purchasesRes.ok) {
        const purchasesBody = (await purchasesRes.json()) as {
          purchases?: PurchaseRow[]
        }
        setPurchases(purchasesBody.purchases ?? [])
      }
      if (payoutRes.ok) {
        setPayout((await payoutRes.json()) as PayoutData)
      }
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

  async function startPayout() {
    setPayoutBusy(true)
    setError("")
    try {
      const res = await fetch("/api/payout", { method: "POST" })
      if (res.status === 401) {
        window.location.assign("/api/auth/login")
        return
      }
      const body = (await res.json()) as {
        onboardingUrl?: string
        error?: string
      }
      if (!res.ok || !body.onboardingUrl) {
        throw new Error(body.error ?? "could not start payout setup")
      }
      window.location.assign(body.onboardingUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "payout setup failed")
    } finally {
      setPayoutBusy(false)
    }
  }

  const displayName = user ? user.name || user.email || user.userId : ""

  return (
    <div className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
      {error ? (
        <p className="mb-6 rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-4 text-sm text-[#B4232B]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <Spinner className="py-16" label="Loading account…" />
      ) : !user ? (
        <Card className="mx-auto max-w-[440px] p-8 text-center">
          <LogoMark className="mx-auto" />
          <h1 className="mt-4 text-[22px] font-bold tracking-[-0.01em] text-[#1A2333]">
            Sign in to manage API keys
          </h1>
          <p className="mx-auto mt-2 max-w-[40ch] text-[14px] leading-6 text-[#5F6B80]">
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
          <p className="mt-3 text-[12.5px] text-[#8A94A6]">
            Keys are per person. Agents use desktop vaults.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="self-start p-6">
            <IconTile
              seed={user.userId}
              name={displayName || "?"}
              size="size-12"
              rounded="rounded-[12px]"
              text="text-[18px]"
            />
            <p className="mt-3 text-[15px] font-bold text-[#1A2333]">
              {displayName}
            </p>
            {user.email ? (
              <p className="mt-0.5 break-all font-mono text-[12px] text-[#5F6B80]">
                {user.email}
              </p>
            ) : null}
            <form action="/api/auth/logout" method="post" className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                type="submit"
              >
                Sign out
              </Button>
            </form>
          </Card>

          <div className="min-w-0">
            {freshKey ? (
              <div className="rounded-[12px] border border-[#BEE0D0] bg-[#E7F4ED] p-5">
                <p className="text-[14px] font-semibold text-[#157A55]">
                  API key created — shown only once
                </p>
                <code className="mt-2 block truncate rounded-[10px] border border-[#BEE0D0] bg-white px-3 py-2.5 font-mono text-[13px] text-[#1A2333]">
                  {freshKey}
                </code>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[12.5px] text-[#157A55]">
                    Copy it now. We never show it again.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setFreshKey("")}
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : null}

            <Card className={`${freshKey ? "mt-6" : ""} p-6`}>
              <SectionHeading label="API keys" />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  placeholder="Label (e.g. office-mac)"
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
              <ul className="mt-4 divide-y divide-[#E7E2D6] border-t border-[#E7E2D6]">
                {keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5"
                  >
                    <span className="max-w-[180px] truncate font-mono text-[13px] font-semibold text-[#1A2333]">
                      obm_…{key.hint}
                    </span>
                    {key.label ? (
                      <span className="text-[13px] font-semibold text-[#1A2333]">
                        {key.label}
                      </span>
                    ) : null}
                    {key.revoked ? <Badge status="revoked" /> : null}
                    <span className="w-full font-mono text-[12px] text-[#5F6B80] sm:w-auto">
                      {key.lastUsedAt
                        ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                        : "Never used"}{" "}
                      · Created {new Date(key.createdAt).toLocaleDateString()}
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
                  <li className="py-4 text-sm text-[#5F6B80]">
                    No API keys yet.
                  </li>
                ) : null}
              </ul>
            </Card>

            <Card className="mt-6 p-6">
              <SectionHeading label="Purchases" />
              <p className="mt-2 text-[13px] leading-5 text-[#5F6B80]">
                Paid plugins you own. A purchase is a lifetime license,
                including future updates — installs ride your API key.
              </p>
              <ul className="mt-3 divide-y divide-[#E7E2D6] border-t border-[#E7E2D6]">
                {purchases.map((purchase) => (
                  <li
                    key={purchase.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                  >
                    <a
                      href={`/plugins/${encodeURIComponent(purchase.pluginId)}`}
                      className="text-[13.5px] font-semibold text-[#2B3DE8] underline-offset-4 hover:underline"
                    >
                      {purchase.pluginName}
                    </a>
                    <span className="font-mono text-[12.5px] font-semibold text-[#1A2333]">
                      {priceText(purchase.amountCents)}
                    </span>
                    {purchase.status === "paid" ? (
                      <span className="rounded-full bg-[#E7F4ED] px-2 py-[1px] text-[11.5px] font-semibold text-[#157A55]">
                        Owned
                      </span>
                    ) : purchase.status === "refunded" ? (
                      <span className="rounded-full bg-[#FDEEEC] px-2 py-[1px] text-[11.5px] font-semibold text-[#B4232B]">
                        Refunded
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#FFF8E1] px-2 py-[1px] text-[11.5px] font-semibold text-[#5F4A00]">
                        Pending
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[12px] text-[#5F6B80]">
                      {new Date(purchase.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
                {purchases.length === 0 ? (
                  <li className="py-3 text-sm text-[#5F6B80]">
                    No purchases yet — free plugins need none.
                  </li>
                ) : null}
              </ul>
            </Card>

            {payout?.configured ? (
              <Card className="mt-6 p-6">
                <SectionHeading label="Payouts" />
                <p className="mt-2 text-[13px] leading-5 text-[#5F6B80]">
                  Sell paid plugins: connect a Stripe Express account to receive
                  your earnings (platform fee deducted at checkout).
                </p>
                {payout.account?.connected ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${
                          payout.account.payoutsEnabled
                            ? "bg-[#E7F4ED] text-[#157A55]"
                            : "bg-[#FFF8E1] text-[#5F4A00]"
                        }`}
                      >
                        {payout.account.payoutsEnabled
                          ? "Payouts enabled"
                          : "Onboarding incomplete"}
                      </span>
                      {!payout.account.payoutsEnabled ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void startPayout()}
                          disabled={payoutBusy}
                        >
                          Finish setup
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void startPayout()}
                          disabled={payoutBusy}
                        >
                          Manage in Stripe
                        </Button>
                      )}
                    </div>
                    <div className="mt-4 rounded-[10px] border border-[#E7E2D6] bg-[#FAFAF7] p-4">
                      <p className="text-[12.5px] font-semibold uppercase tracking-wide text-[#5F6B80]">
                        Earned
                      </p>
                      <p className="mt-0.5 text-[22px] font-bold text-[#1A2333]">
                        {priceText(payout.earnings?.totalCents ?? 0)}
                      </p>
                      <p className="text-[12.5px] text-[#5F6B80]">
                        across {payout.earnings?.count ?? 0} sale
                        {(payout.earnings?.count ?? 0) === 1 ? "" : "s"}
                      </p>
                      {(payout.earnings?.recent.length ?? 0) > 0 ? (
                        <ul className="mt-3 divide-y divide-[#E7E2D6] border-t border-[#E7E2D6]">
                          {payout.earnings?.recent.map((sale) => (
                            <li
                              key={sale.id}
                              className="flex items-center gap-3 py-2 text-[13px]"
                            >
                              <span className="min-w-0 flex-1 truncate text-[#3E4A5F]">
                                {sale.pluginName}
                              </span>
                              <span className="font-mono font-semibold text-[#157A55]">
                                +{priceText(sale.earningsCents)}
                              </span>
                              <span className="font-mono text-[12px] text-[#5F6B80]">
                                {sale.paidAt
                                  ? new Date(sale.paidAt).toLocaleDateString()
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <Button
                    className="mt-3"
                    onClick={() => void startPayout()}
                    disabled={payoutBusy}
                  >
                    {payoutBusy ? "Opening Stripe…" : "Connect Stripe"}
                  </Button>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
