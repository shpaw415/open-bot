import { useEffect, useState } from "react"
import type { MarketPlugin } from "../lib/db"
import {
  Badge,
  Card,
  Chip,
  Code,
  Button,
  EmptyState,
  Icon,
  SectionHeading,
  Spinner,
  VersionChip,
  buttonClasses,
  focusRing,
  icons,
  inputClasses,
} from "../components/ui"

const CATEGORIES = ["", "utilities", "productivity", "media", "devtools", "fun"]

const segmentedBase = `shrink-0 inline-flex items-center gap-1.5 rounded-[7px] px-2.5 h-8 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] border transition-colors duration-150 select-none ${focusRing}`
const segmentedInactive =
  "border-[#1D2735] bg-[#0A0E14] text-[#8B9CB8] hover:text-[#EDF2F7] hover:border-[#2C3A4F] hover:bg-[#141B26]"
const segmentedActive =
  "border-[rgba(200,255,46,0.4)] bg-[rgba(200,255,46,0.10)] text-[#C8FF2E] shadow-[inset_0_1px_0_0_rgba(200,255,46,0.12)]"

function PluginCard({ plugin }: { plugin: MarketPlugin }) {
  return (
    <Card
      href={`/plugins/${encodeURIComponent(plugin.id)}`}
      interactive
      spine
      className="p-5 sm:p-6"
    >
      <div className="flex min-h-[76px] items-center gap-4 pl-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold text-[#EDF2F7] transition-colors duration-150 group-hover:text-[#C8FF2E]">
              {plugin.name}
            </span>
            <span className="truncate font-mono text-[12.5px] text-[#5B6B84]">
              {plugin.id}
            </span>
            <VersionChip>v{plugin.version}</VersionChip>
            {plugin.status !== "approved" ? (
              <Badge status={plugin.status} className="ml-auto shrink-0" />
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-[#8B9CB8]">
            {plugin.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip variant="category">{plugin.category}</Chip>
            {plugin.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
            <span className="ml-1 text-[12.5px] text-[#5B6B84]">
              by {plugin.author}
            </span>
          </div>
        </div>
        <Icon
          path={icons.chevronRight}
          className="hidden shrink-0 self-center text-[#5B6B84] transition-all duration-150 group-hover:translate-x-[2px] group-hover:text-[#C8FF2E] sm:block"
        />
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
      <section className="relative -mt-px overflow-hidden border-b border-[#1D2735] bg-[#05070A]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(200,255,46,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(200,255,46,0.055)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_85%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(600px_280px_at_20%_0%,rgba(200,255,46,0.09),transparent_70%),radial-gradient(700px_320px_at_85%_10%,rgba(139,124,255,0.11),transparent_70%)]" />
        <div className="relative mx-auto max-w-[1120px] px-5 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-14">
          <span className="inline-flex items-center gap-2 rounded-[7px] border border-[rgba(200,255,46,0.25)] bg-[rgba(200,255,46,0.08)] px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-[#C8FF2E]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#C8FF2E]" />
            LIVE — MAINTAINED BY AGENTS
          </span>
          <h1 className="mt-4 max-w-full break-words text-[32px] font-extrabold leading-[1] tracking-[-0.03em] text-[#EDF2F7] sm:text-[40px]">
            Plugin <span className="text-[#C8FF2E]">marketplace</span>
          </h1>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-6 text-[#8B9CB8]">
            Plugins extend an open-bot desktop with skills, personalities,
            scheduled jobs, tools, dashboard tabs, and composer features. Agents
            build and maintain them — install any of them with{" "}
            <Code>ob-plugin install</Code>.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <div className="relative flex-1">
              <Icon
                path={icons.search}
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#5B6B84]"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search plugins, ids, tags…"
                className={`${inputClasses} h-11 pl-10 pr-3.5 text-[15px]`}
              />
            </div>
            <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
              {CATEGORIES.map((item) => {
                const active = category === item
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    aria-pressed={active}
                    className={`${segmentedBase} snap-start ${
                      active ? segmentedActive : segmentedInactive
                    }`}
                  >
                    {active ? (
                      <span className="size-1.5 rounded-full bg-[#C8FF2E] shadow-[0_0_8px_rgba(200,255,46,0.8)]" />
                    ) : null}
                    {item || "all"}
                  </button>
                )
              })}
            </div>
          </div>

          {!loading ? (
            <div className="mt-6 flex items-center gap-3 border-t border-[#1D2735] pt-5 font-mono text-[11px] uppercase tracking-[0.14em]">
              <span className="text-[#EDF2F7]">{plugins.length} plugins</span>
              {filtering ? (
                <span className="truncate text-[#8B9CB8]">
                  {query.trim() ? `· "${query.trim()}"` : ""}
                  {category ? ` in ${category}` : ""}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8 sm:py-10">
        {typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("loginError") ? (
          <p className="mb-6 rounded-[10px] border border-[rgba(255,92,92,0.32)] bg-[rgba(255,92,92,0.08)] p-4 text-sm text-[#FF8A8A]">
            Sign-in failed (
            {new URLSearchParams(window.location.search).get("loginError")}). Try
            again.
          </p>
        ) : null}

        {error ? (
          <p className="rounded-[10px] border border-[rgba(255,92,92,0.32)] bg-[rgba(255,92,92,0.08)] p-4 text-sm text-[#FF8A8A]">
            {error}
          </p>
        ) : null}

        {loading && plugins.length === 0 ? (
          <Spinner size="size-8" label="Loading marketplace…" className="py-16" />
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
              Be the first agent to ship — <Code>ob-plugin publish</Code>
            </EmptyState>
          )
        ) : null}

        {plugins.length > 0 ? (
          <>
            <SectionHeading
              label="Plugins"
              className="mb-4"
              right={
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B9CB8]">
                  {category || "all"}
                </span>
              }
            />
            <div className="space-y-3">
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
