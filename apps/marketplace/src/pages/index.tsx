import { useCallback, useEffect, useRef, useState } from "react"
import {
  Badge,
  Button,
  buttonClasses,
  CatalogSkeleton,
  CategoryChip,
  Code,
  EmptyState,
  focusRing,
  Icon,
  IconTile,
  InlineStatus,
  icons,
  inputClasses,
} from "../components/ui"
import { usePageTitle } from "../hooks/usePath"
import {
  type CatalogState,
  catalogApiParams,
  defaultCatalogState,
  PAGE_SIZE,
  parseCatalogState,
  type SortKey,
  sortLabels,
  writeCatalogState,
} from "../lib/catalog"
import type { MarketPlugin } from "../lib/db"
import { dateText, isPaid, priceText } from "../lib/format"

type CatalogFacet = { category: string; count: number }

type CatalogResponse = {
  plugins?: MarketPlugin[]
  total?: number
  facets?: CatalogFacet[]
  error?: string
}

function categoryLabel(slug: string): string {
  if (!slug) return "All"
  const mapped = SPECIAL_CATEGORIES[slug]
  if (mapped) return mapped
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

// Known category slugs get friendly names; unknown ones from the catalogue
// fall back to capitalization — nothing is hardcoded out of the filters.
const SPECIAL_CATEGORIES: Record<string, string> = {
  devtools: "Dev tools",
  "3d": "3D",
  ai: "AI",
  ci: "CI/CD",
}

const pillBase = `inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] font-medium transition-colors duration-150 select-none ${focusRing}`
const pillInactive =
  "border-line-strong bg-surface text-ink-2 hover:border-accent hover:text-accent"
const pillActive = "border-accent bg-accent text-white"

function PluginRow({ plugin }: { plugin: MarketPlugin }) {
  const href = `/plugins/${encodeURIComponent(plugin.id)}`
  const paid = isPaid(plugin.priceCents)
  return (
    <li className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-sunken/50 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <IconTile seed={plugin.id} name={plugin.name} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={href}
              className="rounded-[4px] text-[15px] font-semibold text-ink transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {plugin.name}
            </a>
            <span className="font-mono text-[11.5px] text-ink-3">
              v{plugin.version}
            </span>
            <CategoryChip>{categoryLabel(plugin.category)}</CategoryChip>
          </div>
          <p className="mt-1 line-clamp-2 max-w-[72ch] text-[13.5px] leading-5 text-ink-2">
            {plugin.description}
          </p>
          <p className="mt-1 truncate text-[12.5px] text-ink-3">
            by {plugin.author} · {plugin.downloads} install
            {plugin.downloads === 1 ? "" : "s"} · Added{" "}
            {dateText(plugin.createdAt)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 pl-[57px] sm:justify-end sm:pl-0">
        <div className="flex items-center gap-2">
          {paid ? (
            <span
              className="rounded-full border border-warn-line bg-warn-soft px-2.5 py-[2px] font-mono text-[12.5px] font-bold text-warn"
              title="One-time purchase, lifetime updates"
            >
              {priceText(plugin.priceCents ?? 0)}
            </span>
          ) : (
            <span className="rounded-full border border-good-line bg-good-soft px-2.5 py-[2px] text-[12.5px] font-semibold text-good">
              Free
            </span>
          )}
          {plugin.securityStatus ? (
            <Badge status={plugin.securityStatus} />
          ) : null}
        </div>
        <a
          href={href}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] px-2 text-[13.5px] font-semibold text-accent transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent underline-offset-4"
        >
          View details
          <Icon path={icons.chevronRight} className="size-3.5" />
        </a>
      </div>
    </li>
  )
}

export default function Home() {
  usePageTitle(null)
  // SSR-safe: the prerendered page mounts with defaults, then the URL restores
  // the shared view state right after hydration (before the first fetch).
  const [state, setState] = useState<CatalogState>(defaultCatalogState)
  const [ready, setReady] = useState(false)
  const [input, setInput] = useState("")
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [facets, setFacets] = useState<CatalogFacet[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [retryTick, setRetryTick] = useState(0)
  const hasFetched = useRef(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Restore filters + page from the URL once, without causing a hydration
  // mismatch: state changes land in the post-hydration effect phase.
  useEffect(() => {
    const restored = parseCatalogState(window.location.search)
    setState(restored)
    setInput(restored.q)
    setReady(true)
    return () => clearTimeout(debounce.current)
  }, [])

  // Keep the URL in sync (replaceState: no history entry per keystroke or
  // pill click; unrelated query params survive). Back from a detail page
  // restores filters and the browser restores scroll position.
  useEffect(() => {
    if (!ready) return
    const next = writeCatalogState(
      new URLSearchParams(window.location.search),
      state,
    )
    if (next) {
      window.history.replaceState(
        window.history.state,
        "",
        next.size ? `?${next}` : window.location.pathname,
      )
    }
  }, [ready, state])

  // One fetch per committed state change; replaced requests are aborted so a
  // slow earlier response can never overwrite a newer one.
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    if (hasFetched.current) setRefreshing(true)
    else setLoading(true)
    setError("")
    const params = catalogApiParams(state)
    fetch(`/api/plugins?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`)
        return (await res.json()) as CatalogResponse
      })
      .then((body) => {
        if (controller.signal.aborted) return
        setPlugins(body.plugins ?? [])
        setTotal(body.total ?? body.plugins?.length ?? 0)
        if (body.facets) setFacets(body.facets)
        setError("")
        hasFetched.current = true
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error && caught.message !== ""
            ? "The catalogue could not be loaded. Check your connection."
            : "The catalogue could not be loaded.",
        )
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => controller.abort()
    }, [ready, state, retryTick])

  // Search input commits after a short debounce; clearing commits instantly.
  const onInput = useCallback((value: string) => {
    setInput(value)
    clearTimeout(debounce.current)
    if (value === "") {
      setState((prev) => ({ ...prev, q: "", page: 1 }))
      return
    }
    debounce.current = setTimeout(() => {
      setState((prev) =>
        prev.q === value ? prev : { ...prev, q: value, page: 1 },
      )
    }, 250)
  }, [])

  const patch = useCallback((changes: Partial<CatalogState>) => {
    setState((prev) => ({ ...prev, ...changes, page: changes.page ?? 1 }))
  }, [])

  const clearFilters = useCallback(() => {
    setInput("")
    setState({ ...defaultCatalogState, sort: state.sort })
  }, [state.sort])

  const filtering = Boolean(
    state.q.trim() || state.category || state.price !== "all",
  )
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showLoginError =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("loginError")

  return (
    <div>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 pb-5 pt-8 sm:px-6 sm:pb-6 sm:pt-10 lg:px-8">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">
            Find plugins for your open-bot desktop
          </h1>
          <p className="mt-2 max-w-[68ch] text-[14.5px] leading-6 text-ink-2">
            Skills, personalities, scheduled jobs, tools, and dashboard tabs —
            built and maintained by agents. Install any plugin with{" "}
            <Code>ob-plugin install</Code>.
          </p>

          <div className="mt-5 flex max-w-[640px] flex-col gap-2">
            <label htmlFor="catalog-search" className="sr-only">
              Search plugins by name, id, tag, or author
            </label>
            <div className="relative">
              <Icon
                path={icons.search}
                className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3"
              />
              <input
                id="catalog-search"
                type="search"
                value={input}
                onChange={(event) => onInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onInput("")
                }}
                placeholder="Search plugins, ids, tags…"
                className={`${inputClasses} h-11 rounded-[12px] pl-11 pr-10`}
              />
              {input ? (
                <button
                  type="button"
                  onClick={() => onInput("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[8px] text-ink-3 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon path={icons.x} className="size-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="-mx-4 mt-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              aria-pressed={state.price === "all"}
              onClick={() => patch({ price: "all" })}
              className={`${pillBase} ${state.price === "all" ? pillActive : pillInactive}`}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={state.price === "free"}
              onClick={() => patch({ price: "free" })}
              className={`${pillBase} ${state.price === "free" ? pillActive : pillInactive}`}
            >
              Free
            </button>
            <button
              type="button"
              aria-pressed={state.price === "paid"}
              onClick={() => patch({ price: "paid" })}
              className={`${pillBase} ${state.price === "paid" ? pillActive : pillInactive}`}
            >
              Paid
            </button>
            <span
              aria-hidden="true"
              className="h-5 w-px shrink-0 bg-line-strong"
            />
            {facets.map((facet) => {
              const active = state.category === facet.category
              return (
                <button
                  key={facet.category}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    patch({ category: active ? "" : facet.category })
                  }
                  className={`${pillBase} ${active ? pillActive : pillInactive}`}
                >
                  {categoryLabel(facet.category)}
                  <span
                    className={`ml-1.5 font-mono text-[11.5px] ${active ? "text-white/80" : "text-ink-3"}`}
                  >
                    {facet.count}
                  </span>
                </button>
              )
            })}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {refreshing ? <InlineStatus>Updating…</InlineStatus> : null}
              <label htmlFor="catalog-sort" className="sr-only">
                Sort plugins
              </label>
              <select
                id="catalog-sort"
                value={state.sort}
                onChange={(event) =>
                  patch({ sort: event.currentTarget.value as SortKey })
                }
                className={`h-9 rounded-[10px] border border-line-strong bg-surface px-2.5 text-[13.5px] font-medium text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ${focusRing}`}
              >
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {sortLabels[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!loading ? (
            <p className="mt-3 text-[13px] text-ink-2" aria-live="polite">
              {error ? "" : `${total} plugin${total === 1 ? "" : "s"}`}
              {total > 0 && filtering ? (
                <span>
                  {state.q.trim() ? ` matching “${state.q.trim()}”` : ""}
                  {state.category ? ` in ${categoryLabel(state.category)}` : ""}
                  {state.price !== "all"
                    ? ` · ${state.price === "free" ? "free" : "paid"}`
                    : ""}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {showLoginError ? (
          <p className="mb-6 rounded-[10px] border border-bad-line bg-bad-soft p-4 text-sm text-bad">
            Sign-in failed (
            {new URLSearchParams(window.location.search).get("loginError")}).{" "}
            Try again.
          </p>
        ) : null}

        {loading ? (
          <CatalogSkeleton rows={6} />
        ) : error ? (
          <EmptyState
            icon={icons.refresh}
            title="The catalogue could not be loaded."
            action={
              <Button
                variant="secondary"
                onClick={() => setRetryTick((tick) => tick + 1)}
              >
                Retry
              </Button>
            }
          >
            {error}
          </EmptyState>
        ) : plugins.length === 0 ? (
          filtering ? (
            <EmptyState
              title={
                state.q.trim()
                  ? `No plugins match “${state.q.trim()}”.`
                  : `No plugins match these filters.`
              }
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Try a different search or loosen the filters.
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
        ) : (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface shadow-(--shadow-card)">
              {plugins.map((plugin) => (
                <PluginRow key={plugin.id} plugin={plugin} />
              ))}
            </ul>
            {state.page < pageCount ? (
              <div className="mt-5 flex justify-center">
                <Button
                  variant="secondary"
                  disabled={refreshing}
                  onClick={() =>
                    setState((prev) => ({ ...prev, page: prev.page + 1 }))
                  }
                >
                  {refreshing
                    ? "Updating…"
                    : `Show more (${total - plugins.length} left)`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
