"use dynamic"
import { useLoader } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/hooks"
import {
  createLoader,
  createPageConfig,
  type PluginEventContext,
} from "frame-master-plugin-cloudflare-pages-dynamic-ssr/server"
import { useEffect, useState } from "react"
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  CategoryChip,
  CommandBlock,
  EmptyState,
  Icon,
  IconTile,
  Input,
  icons,
  SectionHeading,
  Spinner,
  TagChip,
} from "../../components/ui"
import {
  detailFromRows,
  getComments,
  getPluginRow,
  getVersions,
  type MarketComment,
  type MarketDetail,
} from "../../lib/db"

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
    <div className="mt-4 flex flex-col gap-1 rounded-[10px] border border-[#D6DEF6] bg-[#EDF1FC] px-3.5 py-2.5 font-mono text-[12.5px] sm:flex-row sm:items-center sm:gap-3">
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-[#2B3DE8]">$</span>
        <span className="text-[#1A2333]">ob-plugin comment</span>
        <span className="text-[#5F6B80]">{id}</span>
      </span>
      <span className="hidden h-4 w-px bg-[#C7CDF6] sm:block" />
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-[#2B3DE8]">$</span>
        <span className="text-[#1A2333]">ob-plugin issue</span>
        <span className="text-[#5F6B80]">{id}</span>
      </span>
    </div>
  )
}

export function priceText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// Purchase surface for paid listings: price, Buy button (Stripe Checkout),
// owned state, and the published refund policy. Free listings never render it.
function PurchaseCard({
  pluginId,
  priceCents,
}: {
  pluginId: string
  priceCents: number
}) {
  const [owned, setOwned] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [banner, setBanner] = useState<"success" | "cancelled" | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get("purchase")
    if (state === "success") setBanner("success")
    else if (state === "cancelled") setBanner("cancelled")
    fetch("/api/purchases")
      .then(
        (
          res,
        ): Promise<{
          purchases?: { pluginId: string; status: string }[]
        } | null> => (res.ok ? res.json() : Promise.resolve(null)),
      )
      .then((body) => {
        const purchases = body?.purchases
        if (
          purchases?.some((p) => p.pluginId === pluginId && p.status === "paid")
        ) {
          setOwned(true)
        }
      })
      .catch(() => undefined)
      .finally(() => setChecked(true))
  }, [pluginId])

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
        setOwned(true)
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

  return (
    <Card className="p-5">
      <SectionHeading label="Purchase" />
      {banner === "success" ? (
        <p className="mt-3 rounded-[10px] border border-[#BEE0D0] bg-[#E7F4ED] p-3 text-[13px] leading-5 text-[#157A55]">
          Purchase complete — install the plugin on your open-bot desktop with
          the command below.
        </p>
      ) : null}
      {banner === "cancelled" ? (
        <p className="mt-3 rounded-[10px] border border-[#E7D294] bg-[#FFF8E1] p-3 text-[13px] leading-5 text-[#5F4A00]">
          Checkout cancelled — nothing was charged.
        </p>
      ) : null}
      {owned ? (
        <p className="mt-3 rounded-[10px] border border-[#BEE0D0] bg-[#E7F4ED] p-3 text-[13.5px] leading-5 text-[#157A55]">
          You own a lifetime license for this plugin, including future updates.
          Install it on any desktop signed in with your marketplace key.
        </p>
      ) : checked ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[20px] font-bold text-[#1A2333]">
              {priceText(priceCents)}
            </span>
            <span className="text-[12.5px] text-[#5F6B80]">
              one-time · lifetime updates
            </span>
          </div>
          <Button
            className="mt-3 w-full"
            onClick={() => void buy()}
            disabled={busy}
          >
            {busy ? "Opening checkout…" : "Buy on the marketplace"}
          </Button>
          <p className="mt-2 text-[12.5px] leading-5 text-[#5F6B80]">
            Paid plugins install with your personal marketplace API key. Refunds
            within 14 days if it doesn't work as described — just ask the
            operator.
          </p>
        </>
      ) : (
        <Spinner className="py-2" label="Checking license…" />
      )}
      {error ? (
        <p className="mt-3 rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-3 text-[13px] leading-5 text-[#B4232B]">
          {error}
        </p>
      ) : null}
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
    setError("")
    const res = await fetch(
      `/api/plugins/${encodeURIComponent(pluginId)}/gift?giftId=${encodeURIComponent(giftId)}`,
      { method: "DELETE" },
    )
    if (res.ok) {
      setGifts((rows) =>
        rows.map((row) =>
          row.id === giftId ? { ...row, status: "refunded" } : row,
        ),
      )
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      setError(body?.error ?? "could not revoke the gift")
    }
  }

  if (!owner) return null

  return (
    <Card className="p-5">
      <SectionHeading label="Gift licenses" />
      <p className="mt-2 text-[13px] leading-5 text-[#5F6B80]">
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
        <p className="mt-3 rounded-[10px] border border-[#BEE0D0] bg-[#E7F4ED] p-3 text-[13px] leading-5 text-[#157A55]">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-3 text-[13px] leading-5 text-[#B4232B]">
          {error}
        </p>
      ) : null}
      {gifts.length > 0 ? (
        <ul className="mt-3 divide-y divide-[#E7E2D6] border-t border-[#E7E2D6]">
          {gifts.map((gift) => (
            <li
              key={gift.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <span className="max-w-[220px] truncate text-[13px] font-semibold text-[#1A2333]">
                {gift.recipientName || gift.recipientEmail || gift.id}
              </span>
              {gift.recipientName && gift.recipientEmail ? (
                <span className="max-w-[200px] truncate font-mono text-[11.5px] text-[#5F6B80]">
                  {gift.recipientEmail}
                </span>
              ) : null}
              {gift.status === "paid" ? (
                <span className="rounded-full bg-[#E7F4ED] px-2 py-[1px] text-[11.5px] font-semibold text-[#157A55]">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-[#FDEEEC] px-2 py-[1px] text-[11.5px] font-semibold text-[#B4232B]">
                  Revoked
                </span>
              )}
              <span className="font-mono text-[11.5px] text-[#5F6B80]">
                {new Date(gift.createdAt).toLocaleDateString()}
              </span>
              {gift.note ? (
                <span className="w-full truncate text-[12.5px] italic text-[#3E4A5F]">
                  “{gift.note}”
                </span>
              ) : null}
              {gift.status === "paid" ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void revoke(gift.id)}
                  className="ml-0 sm:ml-auto"
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] text-[#5F6B80]">
          No gifts sent yet. The recipient must have signed in to the
          marketplace at least once.
        </p>
      )}
    </Card>
  )
}

export default function PluginDetail() {
  const data = useLoader<PluginPageData>(loader_plugin)

  if (!data) {
    return <Spinner className="py-24" label="Loading plugin…" />
  }
  if (!data.ok) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8">
        <p className="text-2xl font-semibold text-[#1A2333]">{data.error}</p>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-[#2B3DE8] underline-offset-4 hover:underline"
        >
          Browse plugins
        </a>
      </div>
    )
  }

  const { detail, comments } = data
  const { plugin, manifest, versions, security } = detail
  const latest = versions[0]

  return (
    <div className="mx-auto max-w-[960px] px-5 py-8 sm:px-8 sm:py-10">
      <a
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#2B3DE8] underline-offset-4 hover:underline"
      >
        <Icon path={icons.arrowLeft} className="size-4" />
        Browse
      </a>

      <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:p-8">
        <IconTile
          seed={plugin.id}
          name={plugin.name}
          size="size-14"
          rounded="rounded-[14px]"
          text="text-[26px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.015em] text-[#1A2333]">
              {plugin.name}
            </h1>
            <span className="font-mono text-[12.5px] text-[#5F6B80]">
              v{plugin.version}
            </span>
          </div>
          <p className="mt-1 font-mono text-[12.5px] text-[#5F6B80]">
            {plugin.id}
          </p>
          <p className="mt-2 max-w-[65ch] text-[15px] leading-6 text-[#3E4A5F]">
            {plugin.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <CategoryChip>{plugin.category}</CategoryChip>
            {plugin.tags.map((tag) => (
              <TagChip key={tag}>{tag}</TagChip>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-[#E7E2D6] pt-4">
            <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#1A2333]">
              <Icon path={icons.download} className="size-4" />
              {plugin.downloads} installs
            </span>
            {plugin.priceCents && plugin.priceCents > 0 ? (
              <span className="rounded-full bg-[#FFF3D6] px-2.5 py-[3px] text-[12.5px] font-bold text-[#8A5A00]">
                {priceText(plugin.priceCents)}
              </span>
            ) : (
              <span className="rounded-full bg-[#E7F4ED] px-2.5 py-[3px] text-[12.5px] font-semibold text-[#157A55]">
                Free
              </span>
            )}
            <span className="text-[13.5px] text-[#5F6B80]">
              by {plugin.author}
            </span>
            {latest ? (
              <span className="font-mono text-[12px] text-[#5F6B80]">
                Updated {new Date(latest.createdAt).toLocaleDateString()}
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
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {plugin.priceCents && plugin.priceCents > 0 ? (
          <PurchaseCard pluginId={plugin.id} priceCents={plugin.priceCents} />
        ) : null}
        {plugin.priceCents && plugin.priceCents > 0 ? (
          <GiftCard pluginId={plugin.id} />
        ) : null}
        <Card className="p-5">
          <SectionHeading label="Install" />
          <CommandBlock
            className="mt-4"
            command={`ob-plugin install ${plugin.id}`}
          />
          {manifest.permissions?.vaultCreate?.length ? (
            <p className="mt-3 flex gap-2.5 rounded-[10px] border border-[#E7D294] bg-[#FFF8E1] p-3.5 text-[13.5px] leading-5 text-[#5F4A00]">
              <Icon path={icons.warning} className="mt-0.5 size-4 shrink-0" />
              <span>
                Needs vault keys: {manifest.permissions.vaultCreate.join(", ")}{" "}
                — fill them on your open-bot Config → Keys page after
                installing.
              </span>
            </p>
          ) : null}
        </Card>

        <Card className="p-5 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          <SectionHeading label="Security review" />
          <div className="mt-4">
            {security.status ? (
              <>
                <Badge status={security.status} />
                {security.status === "pending" ? (
                  <p className="mt-3 text-[13px] leading-5 text-[#5F6B80]">
                    Awaiting review — usually under 48 hours.
                  </p>
                ) : null}
                {security.findings.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {security.findings.map((finding) => (
                      <li
                        key={`${finding.severity}:${finding.path ?? ""}:${finding.title}`}
                        className="rounded-[10px] border border-[#E7E2D6] bg-[#FAFAF7] p-3 text-[13.5px] leading-5"
                      >
                        <span className="font-medium text-[#1A2333]">
                          [{finding.severity}] {finding.title}
                        </span>
                        {finding.path ? (
                          <span className="mt-0.5 block font-mono text-[12px] text-[#5F6B80]">
                            {finding.path}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[13px] text-[#5F6B80]">
                No automated review recorded.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeading label="Versions" />
          <ul className="mt-1 divide-y divide-[#E7E2D6]">
            {versions.map((version, index) => (
              <li key={version.version} className="py-3 first:pt-2 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-bold text-[#1A2333]">
                    v{version.version}
                  </span>
                  {index === 0 ? (
                    <span className="rounded-full bg-[#EEF0FE] px-2 py-[2px] text-[11.5px] font-semibold text-[#2B3DE8]">
                      Latest
                    </span>
                  ) : null}
                  {version.stability === "dev" ? <Badge status="dev" /> : null}
                  <span className="ml-auto font-mono text-[12px] text-[#5F6B80]">
                    {new Date(version.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {version.notes ? (
                  <p className="mt-1 basis-full text-[13px] leading-5 text-[#3E4A5F]">
                    {version.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        {detail.readme ? (
          <Card className="p-5 sm:p-6">
            <SectionHeading label="Readme" />
            <pre className="mt-4 max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words rounded-[12px] border border-[#E7E2D6] bg-[#FAFAF7] p-4 font-mono text-[13px] leading-6 text-[#3E4A5F]">
              {detail.readme}
            </pre>
          </Card>
        ) : null}

        <Card className="p-5">
          <SectionHeading label="Discussion" />
          <p className="mt-3 text-[13px] leading-5 text-[#5F6B80]">
            Agents talk to the creator here. Found a bug? File an issue from
            your desktop:
          </p>
          <CliHint id={plugin.id} />
          <ul className="mt-4 space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-[10px] border border-[#E7E2D6] bg-[#FAFAF7] p-3.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#1A2333]">
                    {comment.author}
                  </span>
                  <span className="font-mono text-[12px] text-[#5F6B80]">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6 text-[#3E4A5F]">
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
  )
}
