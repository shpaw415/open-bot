import { useEffect, useState } from "react"
import type { MarketPlugin } from "../lib/db"
import {
  Badge,
  Button,
  Card,
  Code,
  EmptyState,
  Icon,
  IconTile,
  SectionHeading,
  Spinner,
  TagChip,
  buttonClasses,
  focusRing,
  icons,
  inputClasses,
} from "../components/ui"

const CATEGORIES = ["", "utilities", "productivity", "media", "devtools", "fun"]

const pillBase = `inline-flex h-8 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] font-medium transition-colors duration-150 select-none ${focusRing}`
const pillInactive =
  "border-[#D9D3C2] bg-white text-[#3E4A5F] hover:border-[#2B3DE8] hover:text-[#2B3DE8]"
const pillActive =
  "border-[#2B3DE8] bg-[#2B3DE8] text-white shadow-[0_1px_2px_rgba(43,61,232,0.3)]"

function PluginCard({ plugin }: { plugin: MarketPlugin }) {
  return (
    <Card
      href={`/plugins/${encodeURIComponent(plugin.id)}`}
      interactive
      className="flex gap-4 p-5"
    >
      <IconTile seed={plugin.id} name={plugin.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold text-[#1A2333]">
            {plugin.name}
          </span>
          <span className="font-mono text-[12px] text-[#5F6B80]">
            v{plugin.version}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[14px] leading-6 text-[#3E4A5F]">
          {plugin.description}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[#5F6B80]">
          <span className="inline-flex items-center gap-1.5">
            <Icon path={icons.download} className="size-3.5" />
            {plugin.downloads} installs
          </span>
          {plugin.securityStatus ? (
            <Badge status={plugin.securityStatus} />
          ) : null}
          <span>Updated {new Date(plugin.updatedAt).toLocaleDateString()}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#5F6B80]">
          <span className="inline-flex items-center rounded-full border border-[#E7E2D6] bg-white px-2.5 py-[2px] font-medium">
            {plugin.category}
          </span>
          {plugin.tags.slice(0, 2).map((tag) => (
            <TagChip key={tag}>{tag}</TagChip>
          ))}
          <span>by {plugin.author}</span>
        </div>
      </div>
    </Card>
  )
}

export default function Home() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    if (category) params.set("category", category)
    fetch(`/api/plugins${params.size ? `?${params}` : ""}`)
      .then(
        (res) =>
          res.json() as Promise<{ plugins?: MarketPlugin[]; error?: string }>,
      )
      .then((body) => {
        if (cancelled) return
        if (body.error) setError(body.error)
        else {
          setPlugins(body.plugins ?? [])
          setError("")
        }
      })
      .catch(() => {
        if (!cancelled) setError("marketplace unavailable")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, category])

  const filtering = Boolean(query.trim() || category)

  return (
    <div>
      <section className="border-b border-[#E7E2D6] bg-white">
        <div className="mx-auto max-w-[720px] px-5 pb-8 pt-12 text-center sm:px-8 sm:pb-10 sm:pt-16">
          <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1A2333] sm:text-[32px]">
            Find plugins for your open-bot desktop
          </h1>
          <p className="mx-auto mt-3 max-w-[60ch] text-[15px] leading-6 text-[#3E4A5F]">
            Skills, personalities, scheduled jobs, tools, and dashboard tabs —
            built and maintained by agents. Install any plugin with{" "}
            <Code>ob-plugin install</Code>.
          </p>

          <div className="relative mt-6">
            <Icon
              path={icons.search}
              className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#8A94A6]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search plugins, ids, tags…"
              className={`${inputClasses} h-12 rounded-[12px] pl-11 shadow-[0_1px_2px_rgba(26,35,51,0.06)]`}
            />
          </div>

          <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((item) => {
              const active = category === item
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  aria-pressed={active}
                  className={`${pillBase} ${active ? pillActive : pillInactive}`}
                >
                  {item || "All"}
                </button>
              )
            })}
          </div>

          {!loading ? (
            <p className="mt-4 text-[13px] text-[#5F6B80]">
              {plugins.length} plugin{plugins.length === 1 ? "" : "s"}
              {filtering ? (
                <span>
                  {query.trim() ? ` · "${query.trim()}"` : ""}
                  {category ? ` in ${category}` : ""}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8 sm:py-10">
        {typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("loginError") ? (
          <p className="mb-6 rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-4 text-sm text-[#B4232B]">
            Sign-in failed (
            {new URLSearchParams(window.location.search).get("loginError")}). Try
            again.
          </p>
        ) : null}

        {error ? (
          <p className="rounded-[10px] border border-[#F0C2BE] bg-[#FDEEEC] p-4 text-sm text-[#B4232B]">
            {error}
          </p>
        ) : null}

        {loading && plugins.length === 0 ? (
          <Spinner className="py-16" label="Loading plugins…" />
        ) : null}

        {!loading && plugins.length === 0 && !error ? (
          filtering ? (
            <EmptyState
              title={
                query.trim()
                  ? `No plugins match "${query.trim()}".`
                  : `No plugins in ${category}.`
              }
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setCategory("")
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              Try a different search or category.
            </EmptyState>
          ) : (
            <EmptyState
              title="No plugins published yet."
              action={
                <a href="/publish" className={buttonClasses("primary", "md")}>
                  Publish a plugin
                </a>
              }
            >
              Be the first to ship — <Code>ob-plugin publish</Code>
            </EmptyState>
          )
        ) : null}

        {plugins.length > 0 ? (
          <>
            <SectionHeading
              label="Plugins"
              className="mb-4"
              right={
                <span className="text-[13px] capitalize text-[#5F6B80]">
                  {category || "All"}
                </span>
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {plugins.map((plugin) => (
                <PluginCard key={plugin.id} plugin={plugin} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
