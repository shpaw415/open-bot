import { useCallback, useEffect, useState } from "react"
import {
  AccountSkeleton,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  IconTile,
  Input,
  icons,
  LogoMark,
  SectionHeading,
} from "../components/ui"
import { usePageTitle } from "../hooks/usePath"
import { dateText, priceText } from "../lib/format"

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
  isGift?: boolean
  giftNote?: string | null
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

// Independent per-section state: a failing payout fetch must never make a
// signed-in account look signed out, and one error never blanks the page.
type Section<T> =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ok"; data: T }

function SectionError({
  onRetry,
  what,
}: {
  onRetry: () => void
  what: string
}) {
  return (
    <EmptyState
      icon={icons.refresh}
      title={`Couldn't load ${what}.`}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      The request failed — your data is unchanged.
    </EmptyState>
  )
}

function KeyRowSkeleton() {
  return (
    <li className="flex items-center gap-3 py-3.5" aria-hidden="true">
      <span className="h-4 w-40 animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
      <span className="ml-auto h-8 w-20 animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[8px] bg-sunken" />
    </li>
  )
}

export default function Account() {
  usePageTitle("Account")
  const [user, setUser] = useState<AccountUser | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [keys, setKeys] = useState<Section<ApiKeyRow[]>>({ phase: "loading" })
  const [purchases, setPurchases] = useState<Section<PurchaseRow[]>>({
    phase: "loading",
  })
  const [payout, setPayout] = useState<Section<PayoutData>>({
    phase: "loading",
  })
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState("")
  const [revoking, setRevoking] = useState("")
  const [revokeError, setRevokeError] = useState("")
  const [freshKey, setFreshKey] = useState("")
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutError, setPayoutError] = useState("")

  const loadKeys = useCallback(async () => {
    setKeys({ phase: "loading" })
    try {
      const res = await fetch("/api/keys")
      if (res.status === 401) {
        setSignedOut(true)
        setKeys({ phase: "ok", data: [] })
        return
      }
      const body = (await res.json()) as {
        user?: AccountUser
        keys?: ApiKeyRow[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? "failed to load keys")
      setUser(body.user ?? null)
      setKeys({ phase: "ok", data: body.keys ?? [] })
    } catch {
      setKeys({ phase: "error" })
    }
  }, [])

  const loadPurchases = useCallback(async () => {
    setPurchases({ phase: "loading" })
    try {
      const res = await fetch("/api/purchases")
      if (res.status === 401) {
        setPurchases({ phase: "ok", data: [] })
        return
      }
      if (!res.ok) throw new Error()
      const body = (await res.json()) as { purchases?: PurchaseRow[] }
      setPurchases({ phase: "ok", data: body.purchases ?? [] })
    } catch {
      setPurchases({ phase: "error" })
    }
  }, [])

  const loadPayout = useCallback(async () => {
    setPayout({ phase: "loading" })
    try {
      const res = await fetch("/api/payout")
      if (res.status === 401) {
        setPayout({ phase: "ok", data: { configured: false, account: null } })
        return
      }
      if (!res.ok) throw new Error()
      setPayout({
        phase: "ok",
        data: (await res.json()) as PayoutData,
      })
    } catch {
      setPayout({ phase: "error" })
    }
  }, [])

  useEffect(() => {
    void loadKeys()
    void loadPurchases()
    void loadPayout()
  }, [loadKeys, loadPurchases, loadPayout])

  const anyLoading =
    keys.phase === "loading" &&
    purchases.phase === "loading" &&
    payout.phase === "loading"

  async function createKey() {
    setCreating(true)
    setCreateError("")
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      const body = (await res.json()) as { key?: string; error?: string }
      if (!res.ok || !body.key)
        throw new Error(body.error ?? "could not create the key")
      setFreshKey(body.key)
      setLabel("")
      await loadKeys()
    } catch (caught) {
      setCreateError(
        caught instanceof Error ? caught.message : "could not create the key",
      )
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    if (
      !window.confirm(
        "Revoke this key? Desktops using it immediately lose marketplace access.",
      )
    ) {
      return
    }
    setRevoking(id)
    setRevokeError("")
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? "could not revoke the key")
      }
      await loadKeys()
    } catch (caught) {
      setRevokeError(
        caught instanceof Error ? caught.message : "could not revoke the key",
      )
    } finally {
      setRevoking("")
    }
  }

  async function startPayout() {
    setPayoutBusy(true)
    setPayoutError("")
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
      setPayoutError(
        caught instanceof Error ? caught.message : "payout setup failed",
      )
    } finally {
      setPayoutBusy(false)
    }
  }

  if (anyLoading && !signedOut) {
    return (
      <div aria-busy="true">
        <AccountSkeleton />
      </div>
    )
  }

  // The keys endpoint doubles as the sign-in check. If it failed outright
  // (network/5xx) and we never learned who the viewer is, say so instead of
  // rendering a broken half-account.
  if (!signedOut && !user && keys.phase === "error") {
    return (
      <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Card className="mx-auto max-w-[440px] p-8 text-center">
          <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">
            Couldn't load your account.
          </h1>
          <p className="mx-auto mt-2 max-w-[40ch] text-[14px] leading-6 text-ink-2">
            The request failed — this is a network or server error, not a
            signed-out state.
          </p>
          <Button className="mt-5" onClick={() => void loadKeys()}>
            Retry
          </Button>
        </Card>
      </div>
    )
  }

  const displayName = user ? user.name || user.email || user.userId : ""

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {signedOut ? (
        <Card className="mx-auto max-w-[440px] p-8 text-center">
          <LogoMark className="mx-auto" />
          <h1 className="mt-4 text-[22px] font-bold tracking-[-0.01em] text-ink">
            Sign in to manage API keys
          </h1>
          <p className="mx-auto mt-2 max-w-[40ch] text-[14px] leading-6 text-ink-2">
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
          <p className="mt-3 text-[12.5px] text-ink-3">
            Keys are per person. Agents use desktop vaults.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="self-start p-6">
            <IconTile
              seed={user?.userId ?? "?"}
              name={displayName || "?"}
              size="size-12"
              text="text-[18px]"
            />
            <p className="mt-3 break-words text-[15px] font-bold text-ink">
              {displayName}
            </p>
            {user?.email ? (
              <p className="mt-0.5 break-all font-mono text-[12px] text-ink-2">
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
              <div
                className="rounded-(--radius-card) border border-good-line bg-good-soft p-5 shadow-(--shadow-card)"
                role="alert"
              >
                <p className="text-[14px] font-semibold text-good">
                  API key created — shown only once
                </p>
                <code className="mt-2 block break-all rounded-[10px] border border-good-line bg-surface px-3 py-2.5 font-mono text-[13px] text-ink select-all">
                  {freshKey}
                </code>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px] text-good">
                    Copy it now and store it safely. We never show it again.
                  </p>
                  <div className="flex items-center gap-2">
                    <CopyButton text={freshKey} label="Copy key" />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setFreshKey("")}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <Card className={`${freshKey ? "mt-6" : ""} p-6`}>
              <SectionHeading
                label="API keys"
                sub="One key per machine. Publishes and paid installs ride it."
              />
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
                  {creating ? "Creating…" : "Create key"}
                </Button>
              </div>
              {createError ? (
                <p
                  className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] text-bad"
                  role="alert"
                >
                  {createError}
                </p>
              ) : null}
              {keys.phase === "loading" ? (
                <ul className="mt-4 border-t border-line">
                  <KeyRowSkeleton />
                  <KeyRowSkeleton />
                </ul>
              ) : keys.phase === "error" ? (
                <div className="mt-4">
                  <SectionError
                    what="your API keys"
                    onRetry={() => void loadKeys()}
                  />
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {keys.data.map((key) => (
                    <li
                      key={key.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5"
                    >
                      <span className="max-w-[180px] truncate font-mono text-[13px] font-semibold text-ink">
                        obm_…{key.hint}
                      </span>
                      {key.label ? (
                        <span className="text-[13px] font-semibold text-ink">
                          {key.label}
                        </span>
                      ) : null}
                      {key.revoked ? <Badge status="revoked" /> : null}
                      <span className="w-full font-mono text-[12px] text-ink-2 sm:w-auto">
                        {key.lastUsedAt
                          ? `Used ${dateText(key.lastUsedAt)}`
                          : "Never used"}{" "}
                        · Created {dateText(key.createdAt)}
                      </span>
                      {!key.revoked ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void revokeKey(key.id)}
                          disabled={revoking === key.id}
                          className="ml-0 sm:ml-auto"
                        >
                          {revoking === key.id ? "Revoking…" : "Revoke"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                  {keys.data.length === 0 ? (
                    <li className="py-4 text-sm text-ink-2">
                      No API keys yet — create one above.
                    </li>
                  ) : null}
                </ul>
              )}
              {revokeError ? (
                <p
                  className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] text-bad"
                  role="alert"
                >
                  {revokeError}
                </p>
              ) : null}
            </Card>

            <Card className="mt-6 p-6">
              <SectionHeading label="Purchases" />
              <p className="mt-2 text-[13px] leading-5 text-ink-2">
                Paid plugins you own. A purchase is a lifetime license,
                including future updates — installs ride your API key.
              </p>
              {purchases.phase === "loading" ? (
                <ul className="mt-3 border-t border-line" aria-hidden="true">
                  <li className="py-3">
                    <span className="block h-4 w-48 animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
                  </li>
                  <li className="py-3">
                    <span className="block h-4 w-36 animate-[skeletonPulse_1.6s_ease-in-out_infinite] rounded-[6px] bg-sunken" />
                  </li>
                </ul>
              ) : purchases.phase === "error" ? (
                <div className="mt-4">
                  <SectionError
                    what="your purchases"
                    onRetry={() => void loadPurchases()}
                  />
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {purchases.data.map((purchase) => (
                    <li
                      key={purchase.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                    >
                      <a
                        href={`/plugins/${encodeURIComponent(purchase.pluginId)}`}
                        className="text-[13.5px] font-semibold text-accent underline-offset-4 hover:underline"
                      >
                        {purchase.pluginName}
                      </a>
                      {purchase.isGift ? (
                        <span className="rounded-full bg-accent-soft px-2 py-[1px] text-[11.5px] font-semibold text-accent">
                          Gift
                        </span>
                      ) : (
                        <span className="font-mono text-[12.5px] font-semibold text-ink">
                          {priceText(purchase.amountCents)}
                        </span>
                      )}
                      {purchase.status === "paid" ? (
                        <span className="rounded-full bg-good-soft px-2 py-[1px] text-[11.5px] font-semibold text-good">
                          Owned
                        </span>
                      ) : purchase.status === "refunded" ? (
                        <span className="rounded-full bg-bad-soft px-2 py-[1px] text-[11.5px] font-semibold text-bad">
                          Refunded
                        </span>
                      ) : (
                        <span className="rounded-full bg-warn-soft px-2 py-[1px] text-[11.5px] font-semibold text-warn">
                          Pending
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[12px] text-ink-2">
                        {dateText(purchase.createdAt)}
                      </span>
                    </li>
                  ))}
                  {purchases.data.length === 0 ? (
                    <li className="py-3 text-sm text-ink-2">
                      No purchases yet — free plugins need none.
                    </li>
                  ) : null}
                </ul>
              )}
            </Card>

            {payout.phase === "loading" ? null : payout.phase === "error" ? (
              <Card className="mt-6 p-6">
                <SectionHeading label="Payouts" />
                <div className="mt-4">
                  <SectionError
                    what="payout settings"
                    onRetry={() => void loadPayout()}
                  />
                </div>
              </Card>
            ) : payout.data.configured ? (
              <Card className="mt-6 p-6">
                <SectionHeading label="Payouts" />
                <p className="mt-2 text-[13px] leading-5 text-ink-2">
                  Sell paid plugins: connect a Stripe Express account to receive
                  your earnings (platform fee deducted at checkout).
                </p>
                {payoutError ? (
                  <p
                    className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] text-bad"
                    role="alert"
                  >
                    {payoutError}
                  </p>
                ) : null}
                {payout.data.account?.connected ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${
                          payout.data.account.payoutsEnabled
                            ? "bg-good-soft text-good"
                            : "bg-warn-soft text-warn"
                        }`}
                      >
                        {payout.data.account.payoutsEnabled
                          ? "Payouts enabled"
                          : "Onboarding incomplete"}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void startPayout()}
                        disabled={payoutBusy}
                      >
                        {payout.data.account.payoutsEnabled
                          ? payoutBusy
                            ? "Opening Stripe…"
                            : "Manage in Stripe"
                          : payoutBusy
                            ? "Opening Stripe…"
                            : "Finish setup"}
                      </Button>
                    </div>
                    <div className="mt-4 rounded-[10px] border border-line bg-sunken p-4">
                      <p className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-2">
                        Earned
                      </p>
                      <p className="mt-0.5 text-[22px] font-bold text-ink">
                        {priceText(payout.data.earnings?.totalCents ?? 0)}
                      </p>
                      <p className="text-[12.5px] text-ink-2">
                        across {payout.data.earnings?.count ?? 0} sale
                        {(payout.data.earnings?.count ?? 0) === 1 ? "" : "s"}
                      </p>
                      {(payout.data.earnings?.recent.length ?? 0) > 0 ? (
                        <ul className="mt-3 divide-y divide-line border-t border-line">
                          {payout.data.earnings?.recent.map((sale) => (
                            <li
                              key={sale.id}
                              className="flex items-center gap-3 py-2 text-[13px]"
                            >
                              <span className="min-w-0 flex-1 truncate text-ink-2">
                                {sale.pluginName}
                              </span>
                              <span className="font-mono font-semibold text-good">
                                +{priceText(sale.earningsCents)}
                              </span>
                              <span className="font-mono text-[12px] text-ink-2">
                                {sale.paidAt ? dateText(sale.paidAt) : ""}
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
