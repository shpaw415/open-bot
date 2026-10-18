"use dynamic"
import type { PluginManifest } from "@open-bot/plugin-kit"
import { useLoader } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/hooks"
import {
  createLoader,
  createPageConfig,
  type PluginEventContext,
} from "frame-master-plugin-cloudflare-pages-dynamic-ssr/server"
import { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  CategoryChip,
  CommandBlock,
  CopyButton,
  EmptyState,
  Icon,
  IconTile,
  Input,
  icons,
  LoadingRegion,
  PluginDetailSkeleton,
  SectionHeading,
  Spinner,
  TagChip,
} from "../../components/ui"
import { usePageTitle } from "../../hooks/usePath"
import {
  detailFromRows,
  getComments,
  getPluginRow,
  getVersions,
  type MarketComment,
  type MarketDetail,
} from "../../lib/db"
import {
  dateText,
  installCommand,
  isPaid,
  priceText,
  reviewLabel,
} from "../../lib/format"
import { Markdown } from "../../lib/markdown"

type PluginPageData =
  | { ok: false; error: string }
  | { ok: true; detail: MarketDetail; comments: MarketComment[] }

type GiftRow = {
  id: string
  recipientEmail: string | null
  recipientName: string | null
  note: string | null
  status: "pending" | "paid" | "refunded"
  createdAt: number
  revokedAt: number | null
}

function pluginId(params: { id?: string | string[] }) {
  const raw = params.id
  const id = Array.isArray(raw) ? raw[0] : raw
  return decodeURIComponent(id ?? "")
}

export const ssr_configs = createPageConfig({
  callback() {
    return { ttl: 60 }
  },
})

export const loader_plugin = createLoader({
  name: "plugin",
  async callback(ctx): Promise<PluginPageData> {
    const event = ctx as PluginEventContext<Env, "id", unknown>
    const id = pluginId(event.params)
    if (!id) return { ok: false, error: "plugin id is required" }
    const row = await getPluginRow(event.env.DB, id)
    if (!row || row.status === "rejected") {
      return { ok: false, error: "plugin not found" }
    }
    if (row.status !== "approved") {
      return { ok: false, error: "plugin is pending review" }
    }
    const versions = await getVersions(event.env.DB, id)
    const detail = detailFromRows(row, versions)
    if (!detail) return { ok: false, error: "version not found" }
    const comments = await getComments(event.env.DB, id)
    return { ok: true, detail, comments }
  },
})

function CliHint({ id }: { id: string }) {
  return (
    <div className="mt-4 flex flex-col gap-1 rounded-[10px] border border-accent-line bg-accent-soft px-3.5 py-2.5 font-mono text-[12.5px] sm:flex-row sm:items-center sm:gap-3">
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-accent">$</span>
        <span className="text-ink">ob-plugin comment</span>
        <span className="text-ink-2">{id}</span>
      </span>
      <span className="hidden h-4 w-px bg-accent-line sm:block" />
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-accent">$</span>
        <span className="text-ink">ob-plugin issue</span>
        <span className="text-ink-2">{id}</span>
      </span>
    </div>
  )
}

// License states for the paid action panel. The URL `?purchase=…` flag alone
// never proves a license — every owned state comes from a server check of the
// signed-in buyer's purchases (written by the Stripe webhook).
type LicenseCheck = "checking" | "owned" | "pending" | "available" | "error"

function PurchaseCard({
  pluginId,
  priceCents,
}: {
  pluginId: string
  priceCents: number
}) {
  const [check, setCheck] = useState<LicenseCheck>("checking")
  const [arrival, setArrival] = useState<"success" | "cancelled" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Read the checkout redirect flag once, then strip it so reloads and shared
  // links don't replay the banner. Verification below decides the real state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get("purchase")
    if (state === "success" || state === "cancelled") {
      setArrival(state)
      params.delete("purchase")
      const rest = params.toString()
      window.history.replaceState(
        window.history.state,
        "",
        rest ? `${window.location.pathname}?${rest}` : window.location.pathname,
      )
    }
  }, [])

  const verify = useCallback(() => {
    let cancelled = false
    setCheck("checking")
    setError("")
    fetch("/api/purchases")
      .then(async (res) => {
        if (cancelled) return
        // 401 = signed-out visitor: license data is simply not theirs to see.
        if (res.status === 401) {
          setCheck("available")
          return
        }
        if (!res.ok) throw new Error(`license check failed (${res.status})`)
        const body = (await res.json()) as {
          purchases?: { pluginId: string; status: string }[]
        }
        const row = body.purchases?.find(
          (purchase) => purchase.pluginId === pluginId,
        )
        if (row?.status === "paid") setCheck("owned")
        else if (row?.status === "pending") setCheck("pending")
        else setCheck("available")
      })
      .catch(() => {
        if (!cancelled) setCheck("error")
      })
    return () => {
      cancelled = true
    }
  }, [pluginId])

  useEffect(() => verify(), [verify])

  async function buy() {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/checkout`,
        { method: "POST" },
      )
      if (res.status === 401) {
        window.location.assign("/api/auth/login")
        return
      }
      const body = (await res.json()) as {
        checkoutUrl?: string
        alreadyOwned?: boolean
        error?: string
      }
      if (body.alreadyOwned) {
        setCheck("owned")
        return
      }
      if (!res.ok || !body.checkoutUrl) {
        throw new Error(body.error ?? "could not start checkout")
      }
      window.location.assign(body.checkoutUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "checkout failed")
    } finally {
      setBusy(false)
    }
  }

  const verifiedOwned = check === "owned"

  return (
    <Card className="p-5" data-testid="purchase-card">
      <SectionHeading
        label={verifiedOwned ? "License" : "Purchase"}
        right={
          <span className="font-mono text-[15px] font-bold text-ink">
            {priceText(priceCents)}
          </span>
        }
      />

      {arrival === "cancelled" && !verifiedOwned ? (
        <p className="mt-3 rounded-[10px] border border-warn-line bg-warn-soft p-3 text-[13px] leading-5 text-warn">
          Checkout cancelled — nothing was charged.
        </p>
      ) : null}

      {check === "checking" ? (
        <div className="mt-3" aria-live="polite">
          <Spinner size="size-5" className="py-1" />
          <p className="mt-2 text-[13px] text-ink-2">
            {arrival === "success"
              ? "Payment received — confirming your license…"
              : "Checking license…"}
          </p>
        </div>
      ) : null}

      {verifiedOwned ? (
        <>
          <p className="mt-3 rounded-[10px] border border-good-line bg-good-soft p-3 text-[13.5px] leading-5 text-good">
            You own a lifetime license for this plugin, including future
            updates. Install it on any desktop signed in with your marketplace
            key.
          </p>
          <CommandBlock
            className="mt-3"
            label="install"
            command={installCommand(pluginId)}
          />
        </>
      ) : null}

      {check === "pending" ? (
        <div className="mt-3 rounded-[10px] border border-warn-line bg-warn-soft p-3 text-[13px] leading-5 text-warn">
          <p>
            A payment for this plugin is still processing — the confirmation
            webhook can take a moment. Nothing is charged twice; check again in
            a minute.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={verify}
          >
            Check again
          </Button>
        </div>
      ) : null}

      {check === "error" ? (
        <div className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] leading-5 text-bad">
          <p>The license check failed. Your purchases are unaffected.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={verify}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {arrival === "success" && check === "available" ? (
        <div className="mt-3 rounded-[10px] border border-warn-line bg-warn-soft p-3 text-[13px] leading-5 text-warn">
          <p>
            We couldn't confirm a completed purchase on your account yet. If you
            just paid, the confirmation may still be arriving — verify before
            buying again.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={verify}
          >
            Verify again
          </Button>
        </div>
      ) : null}

      {check === "available" ? (
        <>
          <p className="mt-3 text-[12.5px] text-ink-2">
            One-time purchase · lifetime updates
          </p>
          <Button
            className="mt-2 w-full"
            onClick={() => void buy()}
            disabled={busy}
          >
            {busy ? "Opening checkout…" : "Buy on the marketplace"}
          </Button>
          <p className="mt-2 text-[12.5px] leading-5 text-ink-2">
            Paid plugins install with your personal marketplace API key. Refunds
            within 14 days if it doesn't work as described — just ask the
            operator.
          </p>
        </>
      ) : null}

      {error ? (
        <p
          className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] leading-5 text-bad"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Card>
  )
}

// Sidebar action panel for free plugins: price fact plus the real install
// command. There is no fake in-browser install — installs happen on a desktop
// through the CLI.
function FreeInstallCard({ pluginId }: { pluginId: string }) {
  return (
    <Card className="p-5">
      <SectionHeading
        label="Install"
        right={
          <span className="rounded-full border border-good-line bg-good-soft px-2.5 py-[2px] text-[12.5px] font-semibold text-good">
            Free
          </span>
        }
      />
      <CommandBlock
        className="mt-4"
        label="install"
        command={installCommand(pluginId)}
      />
      <p className="mt-2.5 text-[12.5px] leading-5 text-ink-2">
        Run this on your open-bot desktop (agent shell or terminal).
      </p>
    </Card>
  )
}

// Owner-only surface: gift a lifetime license to a registered marketplace
// user. Mounts only when the gift API answers 200 for the signed-in viewer —
// the publicly cached page itself never carries owner state.
function GiftCard({ pluginId }: { pluginId: string }) {
  const [gifts, setGifts] = useState<GiftRow[]>([])
  const [owner, setOwner] = useState(false)
  const [email, setEmail] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState("")
  const [error, setError] = useState("")
  const [banner, setBanner] = useState("")

  useEffect(() => {
    fetch(`/api/plugins/${encodeURIComponent(pluginId)}/gift`)
      .then(async (res) => {
        if (!res.ok) return
        const body = (await res.json()) as { gifts?: GiftRow[] }
        setGifts(body.gifts ?? [])
        setOwner(true)
      })
      .catch(() => undefined)
  }, [pluginId])

  async function send() {
    setBusy(true)
    setError("")
    setBanner("")
    try {
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/gift`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, note: note.trim() || undefined }),
        },
      )
      if (res.status === 401) {
        window.location.assign("/api/auth/login")
        return
      }
      const body = (await res.json()) as {
        ok?: boolean
        alreadyOwned?: boolean
        recipient?: { name?: string | null; email?: string | null }
        error?: string
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "could not send the gift")
      }
      if (body.alreadyOwned) {
        setBanner(
          `${body.recipient?.name || body.recipient?.email || "They"} already owns a license — nothing sent.`,
        )
      } else {
        setBanner(
          `Gift sent to ${body.recipient?.name || body.recipient?.email || email} — it appears in their Purchases on next sign-in.`,
        )
      }
      setEmail("")
      setNote("")
      const list = await fetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/gift`,
      )
      if (list.ok) {
        const fresh = (await list.json()) as { gifts?: GiftRow[] }
        setGifts(fresh.gifts ?? [])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "gift failed")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(giftId: string) {
    if (
      !window.confirm(
        "Revoke this gift? The recipient loses their license immediately.",
      )
    ) {
      return
    }
    setRevoking(giftId)
    setError("")
    try {
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/gift?giftId=${encodeURIComponent(giftId)}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? "could not revoke the gift")
      }
      setGifts((rows) =>
        rows.map((row) =>
          row.id === giftId ? { ...row, status: "refunded" } : row,
        ),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "could not revoke the gift",
      )
    } finally {
      setRevoking("")
    }
  }

  if (!owner) return null

  return (
    <Card className="p-5">
      <SectionHeading label="Gift licenses" />
      <p className="mt-2 text-[13px] leading-5 text-ink-2">
        You own this plugin. Gift a lifetime license to a registered marketplace
        user — they install it with their own API key, no payment.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="their-marketplace-email"
          type="email"
          className="flex-1"
        />
        <Button
          onClick={() => void send()}
          disabled={busy || !email.trim()}
          className="w-full sm:w-auto"
        >
          {busy ? "Sending…" : "Send gift"}
        </Button>
      </div>
      <Input
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
        placeholder="Optional note for the recipient"
        className="mt-2"
      />
      {banner ? (
        <p className="mt-3 rounded-[10px] border border-good-line bg-good-soft p-3 text-[13px] leading-5 text-good">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-3 rounded-[10px] border border-bad-line bg-bad-soft p-3 text-[13px] leading-5 text-bad"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {gifts.length > 0 ? (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {gifts.map((gift) => (
            <li
              key={gift.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <span className="max-w-[220px] truncate text-[13px] font-semibold text-ink">
                {gift.recipientName || gift.recipientEmail || gift.id}
              </span>
              {gift.recipientName && gift.recipientEmail ? (
                <span className="max-w-[200px] truncate font-mono text-[11.5px] text-ink-2">
                  {gift.recipientEmail}
                </span>
              ) : null}
              {gift.status === "paid" ? (
                <span className="rounded-full bg-good-soft px-2 py-[1px] text-[11.5px] font-semibold text-good">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-bad-soft px-2 py-[1px] text-[11.5px] font-semibold text-bad">
                  Revoked
                </span>
              )}
              <span className="font-mono text-[11.5px] text-ink-2">
                {dateText(gift.createdAt)}
              </span>
              {gift.note ? (
                <span className="w-full truncate text-[12.5px] italic text-ink-2">
                  “{gift.note}”
                </span>
              ) : null}
              {gift.status === "paid" ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void revoke(gift.id)}
                  disabled={revoking === gift.id}
                  className="ml-0 sm:ml-auto"
                >
                  {revoking === gift.id ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] text-ink-2">
          No gifts sent yet. The recipient must have signed in to the
          marketplace at least once.
        </p>
      )}
    </Card>
  )
}

// Security review panel: explicit status wording, review date, findings —
// and an honest disclaimer (automated review, not a certification).
function SecurityPanel({
  status,
  analyzedAt,
  findings,
}: {
  status: string | null
  analyzedAt: number | null
  findings: {
    title: string
    severity: string
    detail: string
    path: string | null
  }[]
}) {
  return (
    <Card className="p-5">
      <SectionHeading label="Security review" />
      <div className="mt-3">
        {status ? (
          <>
            <Badge status={status} label={reviewLabel(status)} />
            <p className="mt-1.5 text-[12px] text-ink-3">
              Automated review
              {analyzedAt ? ` · ${dateText(analyzedAt)}` : ""}
            </p>
            {status === "queued" || status === "running" ? (
              <p className="mt-2 text-[13px] leading-5 text-ink-2">
                The version is being reviewed before it can be approved —
                usually under 48 hours.
              </p>
            ) : null}
            {findings.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {findings.map((finding) => (
                  <li
                    key={`${finding.severity}:${finding.path ?? ""}:${finding.title}`}
                    className="rounded-[10px] border border-line bg-sunken p-3 text-[13px] leading-5"
                  >
                    <span className="font-medium text-ink">
                      [{finding.severity}] {finding.title}
                    </span>
                    {finding.path ? (
                      <span className="mt-0.5 block break-all font-mono text-[11.5px] text-ink-2">
                        {finding.path}
                      </span>
                    ) : null}
                    {finding.detail ? (
                      <span className="mt-1 block text-[12.5px] text-ink-2">
                        {finding.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-[11.5px] leading-4 text-ink-3">
              An automated scan of the manifest and payload files. It reduces
              risk; it is not a guarantee.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">
            No automated review recorded for this version.
          </p>
        )}
      </div>
    </Card>
  )
}

// Human-readable summary of what the manifest really declares — capabilities,
// vault slugs (names only, never values), runtime surfaces, setup commands.
function CapabilitiesPanel({ manifest }: { manifest: PluginManifest }) {
  const rows: { icon: string; label: string; detail: string }[] = []
  const skills = manifest.skills
  const personas = manifest.personas
  const tools = manifest.tools
  const configs = manifest.configs
  const mentions = manifest.dashboard?.mentions
  const manifestVersion =
    manifest.version && manifest.version.length > 0
      ? manifest.version
      : undefined

  if (skills?.length)
    rows.push({
      icon: icons.spark,
      label: `Skills (${skills.length})`,
      detail: skills.map((s) => s.name).join(", "),
    })
  if (personas?.length)
    rows.push({
      icon: icons.user,
      label: `Personas (${personas.length})`,
      detail: personas.map((p) => p.name).join(", "),
    })
  if (manifest.cron?.length)
    rows.push({
      icon: icons.clock,
      label: `Scheduled jobs (${manifest.cron.length})`,
      detail: "Runs on the desktop's control plane schedule.",
    })
  if (tools?.length)
    rows.push({
      icon: icons.wrench,
      label: `CLI tools (${tools.length})`,
      detail: tools.map((t) => t.name).join(", "),
    })
  if (manifest.files?.length)
    rows.push({
      icon: icons.copy,
      label: `Payload files (${manifest.files.length})`,
      detail: "Installed next to the plugin's tools at setup.",
    })
  if (configs?.length)
    rows.push({
      icon: icons.sliders,
      label: `Settings (${configs.length})`,
      detail: configs.map((c) => c.label).join(", "),
    })
  if (manifest.hooks?.length)
    rows.push({
      icon: icons.refresh,
      label: `Event hooks (${manifest.hooks.length})`,
      detail: "Reacts to desktop events (thread created, session idle).",
    })

  const permissions = manifest.permissions
  if (permissions?.vaultCreate?.length)
    rows.push({
      icon: icons.key,
      label: "Creates vault keys",
      detail: permissions.vaultCreate.join(", "),
    })
  if (permissions?.vaultRead?.length)
    rows.push({
      icon: icons.key,
      label: "Reads vault keys",
      detail: `${permissions.vaultRead.join(", ")} — values never appear in the manifest.`,
    })
  if (permissions?.desktopTools)
    rows.push({
      icon: icons.grid,
      label: "Desktop app launcher",
      detail: "Can register apps in the desktop catalog.",
    })
  if (permissions?.notifications)
    rows.push({
      icon: icons.message,
      label: "Dashboard notifications",
      detail: "Can post toasts and native notifications (rate-limited).",
    })

  const opencode = manifest.opencode
  if (opencode) {
    const parts: string[] = []
    if (opencode.plugin?.length) parts.push("runtime plugins")
    if (opencode.mcp && Object.keys(opencode.mcp).length)
      parts.push(`${Object.keys(opencode.mcp).length} MCP server(s)`)
    if (opencode.agents && Object.keys(opencode.agents).length)
      parts.push(`${Object.keys(opencode.agents).length} agent(s)`)
    if (opencode.agentTools && Object.keys(opencode.agentTools).length)
      parts.push("agent tool patches")
    if (opencode.agentsMd) parts.push("standing instructions")
    if (parts.length)
      rows.push({
        icon: icons.plug,
        label: "Agent runtime",
        detail: parts.join(", "),
      })
  }

  if (manifest.dashboard) {
    const parts: string[] = []
    if (manifest.dashboard.pages) parts.push("live page server")
    if (manifest.dashboard.tabs?.length)
      parts.push(`${manifest.dashboard.tabs.length} dashboard tab(s)`)
    if (mentions?.length)
      parts.push(`@mentions: ${mentions.map((m) => m.section).join(", ")}`)
    if (parts.length)
      rows.push({
        icon: icons.layout,
        label: "Dashboard surfaces",
        detail: parts.join(", "),
      })
  }
  if (manifest.textbox)
    rows.push({
      icon: icons.message,
      label: "Chat composer",
      detail: "Adds chat rendering or composer features.",
    })
  const setupCommands = manifest.setup?.commands
  if (setupCommands?.length)
    rows.push({
      icon: icons.warning,
      label: `Setup commands (${setupCommands.length})`,
      detail:
        "Runs as root on the desktop at install — shown at the consent prompt.",
    })

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        label="Capabilities"
        sub={
          manifestVersion ? `Manifest version ${manifestVersion}` : undefined
        }
      />
      {rows.length > 0 ? (
        <dl className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <dt className="flex shrink-0 items-center gap-2 text-[13.5px] font-semibold text-ink sm:w-[220px]">
                <Icon path={row.icon} className="size-4 text-accent" />
                {row.label}
              </dt>
              <dd className="min-w-0 break-words text-[13px] leading-5 text-ink-2">
                {row.detail}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-[13.5px] text-ink-2">
          No extra capabilities declared — this plugin ships documentation or
          skills only.
        </p>
      )}
    </Card>
  )
}

export default function PluginDetail() {
  const data = useLoader<PluginPageData>(loader_plugin)
  const title = data?.ok ? data.detail.plugin.name : null
  usePageTitle(title)

  if (!data) {
    return (
      <LoadingRegion label="Loading plugin">
        <PluginDetailSkeleton />
      </LoadingRegion>
    )
  }
  if (!data.ok) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8">
        <p className="text-2xl font-semibold text-ink">{data.error}</p>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-accent underline-offset-4 hover:underline"
        >
          Browse plugins
        </a>
      </div>
    )
  }

  const { detail, comments } = data
  const { plugin, manifest, versions, security } = detail
  // plugin.version is the listing version actually distributed right now;
  // versions[0] is only the most recently created row (it can be a newer dev
  // prerelease). All "current" facts anchor to the listing version.
  const current = versions.find((v) => v.version === plugin.version) ?? null
  const newest = versions[0] ?? null
  const newerDevVersion =
    newest && newest.version !== plugin.version && newest.stability === "dev"
      ? newest.version
      : null
  const paid = isPaid(plugin.priceCents)

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <a
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 rounded-[8px] text-[14px] font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon path={icons.arrowLeft} className="size-4" />
        Browse
      </a>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row">
          <IconTile
            seed={plugin.id}
            name={plugin.name}
            size="size-14"
            text="text-[26px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-ink sm:text-[26px]">
                {plugin.name}
              </h1>
              <span className="font-mono text-[12.5px] text-ink-2">
                v{plugin.version}
              </span>
              {paid ? (
                <span className="rounded-full border border-warn-line bg-warn-soft px-2.5 py-[2px] font-mono text-[12px] font-bold text-warn">
                  {priceText(plugin.priceCents ?? 0)}
                </span>
              ) : (
                <span className="rounded-full border border-good-line bg-good-soft px-2.5 py-[2px] text-[12px] font-semibold text-good">
                  Free
                </span>
              )}
              {plugin.securityStatus ? (
                <Badge
                  status={plugin.securityStatus}
                  label={reviewLabel(plugin.securityStatus)}
                />
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-[12.5px] text-ink-3">
                {plugin.id}
              </span>
              <CopyButton text={plugin.id} label="Copy id" />
            </div>
            <p className="mt-2 max-w-[70ch] text-[14.5px] leading-6 text-ink-2">
              {plugin.description}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <CategoryChip>{plugin.category}</CategoryChip>
              {plugin.tags.map((tag) => (
                <TagChip key={tag}>{tag}</TagChip>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5 text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <Icon path={icons.download} className="size-4" />
                {plugin.downloads} install{plugin.downloads === 1 ? "" : "s"}
              </span>
              <span className="text-ink-2">by {plugin.author}</span>
              {current ? (
                <span className="font-mono text-[12px] text-ink-2">
                  Released {dateText(current.createdAt)}
                </span>
              ) : null}
              {newerDevVersion ? (
                <span className="rounded-full border border-accent-line bg-accent-soft px-2.5 py-[2px] text-[11.5px] font-medium text-accent">
                  Newer prerelease: v{newerDevVersion}
                </span>
              ) : null}
              <a
                href={`https://github.com/${plugin.repo}`}
                target="_blank"
                rel="noreferrer"
                className={`${buttonClasses("secondary", "sm", "w-full justify-center sm:ml-auto sm:w-auto")}`}
              >
                <Icon path={icons.github} className="size-4" fill />
                Repo
              </a>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Action panel first in the DOM so mobile users reach it early. */}
        <div className="space-y-5 lg:order-2 lg:self-start">
          {paid ? (
            <PurchaseCard
              pluginId={plugin.id}
              priceCents={plugin.priceCents ?? 0}
            />
          ) : (
            <FreeInstallCard pluginId={plugin.id} />
          )}
          {manifest.permissions?.vaultCreate?.length ? (
            <p className="flex gap-2.5 rounded-[10px] border border-warn-line bg-warn-soft p-3.5 text-[13px] leading-5 text-warn">
              <Icon path={icons.warning} className="mt-0.5 size-4 shrink-0" />
              <span>
                Needs vault keys: {manifest.permissions.vaultCreate.join(", ")}{" "}
                — fill them on your open-bot Config → Keys page after
                installing.
              </span>
            </p>
          ) : null}
          <SecurityPanel
            status={security.status}
            analyzedAt={security.analyzedAt}
            findings={security.findings}
          />
          {paid ? <GiftCard pluginId={plugin.id} /> : null}
        </div>

        <div className="min-w-0 space-y-5 lg:order-1">
          {detail.readme ? (
            <Card className="p-5 sm:p-6">
              <SectionHeading label="Readme" />
              <div className="mt-3">
                <Markdown source={detail.readme} />
              </div>
            </Card>
          ) : null}

          <CapabilitiesPanel manifest={manifest} />

          <Card className="p-5">
            <SectionHeading
              label="Versions"
              sub="Dev prereleases are published for testing; the listing serves the current release."
            />
            <ul className="mt-2 divide-y divide-line">
              {versions.map((version) => {
                const isCurrent = version.version === plugin.version
                return (
                  <li
                    key={version.version}
                    className="py-3 first:pt-1 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-bold text-ink">
                        v{version.version}
                      </span>
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-[2px] text-[11.5px] font-semibold text-accent">
                          <Icon path={icons.check} className="size-3" />
                          Current release
                        </span>
                      ) : null}
                      {version.stability === "dev" ? (
                        <Badge status="dev" label="dev prerelease" />
                      ) : null}
                      {version.securityStatus && !isCurrent ? (
                        <Badge
                          status={version.securityStatus}
                          label={reviewLabel(version.securityStatus)}
                        />
                      ) : null}
                      <span className="ml-auto font-mono text-[12px] text-ink-2">
                        {dateText(version.createdAt) || "unknown date"}
                      </span>
                    </div>
                    {version.notes ? (
                      <p className="mt-1 text-[13px] leading-5 text-ink-2">
                        {version.notes}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card className="p-5">
            <SectionHeading label="Discussion" />
            <p className="mt-3 text-[13px] leading-5 text-ink-2">
              Agents talk to the creator here. Found a bug? File an issue from
              your desktop:
            </p>
            <CliHint id={plugin.id} />
            <ul className="mt-4 space-y-3">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-[10px] border border-line bg-sunken p-3.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">
                      {comment.author}
                    </span>
                    <span className="font-mono text-[12px] text-ink-2">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6 text-ink-2">
                    {comment.body}
                  </p>
                </li>
              ))}
              {comments.length === 0 ? (
                <li>
                  <EmptyState icon={icons.message} title="No discussion yet.">
                    Agents start it from the terminal — see commands above.
                  </EmptyState>
                </li>
              ) : null}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
