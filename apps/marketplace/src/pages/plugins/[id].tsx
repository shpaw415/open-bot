"use dynamic"
import { useLoader } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/hooks"
import {
  createLoader,
  createPageConfig,
  type PluginEventContext,
} from "frame-master-plugin-cloudflare-pages-dynamic-ssr/server"
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

export default function PluginDetail() {
  const data = useLoader<PluginPageData>(loader_plugin)

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
      </div>
    )
  }
  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-2xl font-semibold">{data.error}</p>
        <a href="/" className="mt-4 inline-block text-blue-400 hover:underline">
          Browse plugins
        </a>
      </div>
    )
  }

  const { detail, comments } = data
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
                {security.findings.map((finding) => (
                  <li
                    key={`${finding.severity}:${finding.path ?? ""}:${finding.title}`}
                  >
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
              {version.stability === "dev" ? (
                <span className="rounded border border-amber-700/60 px-1.5 text-xs uppercase tracking-wide text-amber-500">
                  dev
                </span>
              ) : null}
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
