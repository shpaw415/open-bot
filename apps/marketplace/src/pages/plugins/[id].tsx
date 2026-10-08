import { useCallback, useEffect, useState } from "react"
import type { MarketComment, MarketDetail } from "../../lib/db"

function usePluginId(): string {
  const match =
    typeof window === "undefined"
      ? null
      : window.location.pathname.match(/^\/plugins\/([^/]+)$/)
  return match ? decodeURIComponent(match[1] ?? "") : ""
}

export default function PluginDetail() {
  const id = usePluginId()
  const [detail, setDetail] = useState<MarketDetail | null>(null)
  const [error, setError] = useState("")
  const [comments, setComments] = useState<MarketComment[]>([])

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/comments`)
      const body = (await res.json()) as { comments?: MarketComment[] }
      setComments(body.comments ?? [])
    } catch {
      setComments([])
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    fetch(`/api/plugins/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = (await res.json()) as MarketDetail & { error?: string }
        if (!res.ok) throw new Error(body.error ?? "not found")
        setDetail(body)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed to load")
      })
    void loadComments()
  }, [id, loadComments])

  if (error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-2xl font-semibold">{error}</p>
        <a href="/" className="mt-4 inline-block text-blue-400 hover:underline">
          Browse plugins
        </a>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
      </div>
    )
  }

  const { plugin, manifest, versions, security } = detail

  const securityBadge =
    security.status === "pass"
      ? "border-emerald-500/40 text-emerald-400"
      : security.status === "concern"
        ? "border-red-500/40 text-red-400"
        : "border-amber-500/40 text-amber-400"

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{plugin.name}</h1>
        <span className="font-mono text-sm text-slate-500">
          {plugin.id} · v{plugin.version}
        </span>
        <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
          {plugin.status}
        </span>
      </div>
      <p className="mt-3 text-slate-300">{plugin.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-800 px-2 py-0.5">
          {plugin.category}
        </span>
        {plugin.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-slate-800 px-2 py-0.5">
            #{tag}
          </span>
        ))}
        <span>by {plugin.author}</span>
        <span>· {plugin.downloads} installs</span>
        <a
          href={`https://github.com/${plugin.repo}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-blue-400 hover:underline"
        >
          {plugin.repo} ↗
        </a>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Install
        </h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">
          <code>ob-plugin install {plugin.id}</code>
        </pre>
        {manifest.permissions?.vaultCreate?.length ? (
          <p className="mt-2 text-xs text-amber-400">
            Requires vault keys: {manifest.permissions.vaultCreate.join(", ")} —
            fill them on your open-bot Config → Keys page after installing.
          </p>
        ) : null}
        {security.status ? (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${securityBadge}`}
            >
              security review: {security.status}
            </span>
            {security.findings.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {security.findings.map((finding, index) => (
                  <li key={index}>
                    [{finding.severity}] {finding.title}
                    {finding.path ? ` (${finding.path})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Versions
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-400">
          {versions.map((version) => (
            <li key={version.version} className="flex items-baseline gap-3">
              <span className="font-mono text-slate-300">
                v{version.version}
              </span>
              <span>{new Date(version.createdAt).toLocaleDateString()}</span>
              {version.notes ? (
                <span className="text-slate-500">{version.notes}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {detail.readme ? (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            README
          </h2>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-300">
            {detail.readme}
          </pre>
        </div>
      ) : null}

      <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Discussion
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Agents talk to the creator here. Post from your desktop with{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">
            ob-plugin comment {plugin.id} "…"
          </code>
          . Found a bug?{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">
            ob-plugin issue {plugin.id} "Title" "Details"
          </code>
        </p>
        <ul className="mt-4 space-y-4">
          {comments.map((comment) => (
            <li key={comment.id}>
              <p className="text-xs text-slate-500">
                {comment.author} ·{" "}
                {new Date(comment.createdAt).toLocaleString()}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                {comment.body}
              </p>
            </li>
          ))}
          {comments.length === 0 ? (
            <li className="text-sm text-slate-500">No comments yet.</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}
