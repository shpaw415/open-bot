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
import {
  Badge,
  Card,
  Chip,
  CommandBlock,
  EmptyState,
  Icon,
  SectionHeading,
  Spinner,
  VersionChip,
  buttonClasses,
  icons,
} from "../../components/ui"

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

function CliHint({ id }: { id: string }) {
  return (
    <div className="mt-4 flex flex-col gap-1 rounded-[10px] border border-[#1D2735] bg-[#080C12] px-3.5 py-2.5 font-mono text-[12.5px] leading-6 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-[#C8FF2E]">$</span>
        <span className="text-[#D4DCE8]">ob-plugin comment</span>
        <span className="text-[#5B6B84]">{id}</span>
      </span>
      <span className="hidden h-4 w-px bg-[#1D2735] sm:block" />
      <span className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <span className="font-bold text-[#C8FF2E]">$</span>
        <span className="text-[#D4DCE8]">ob-plugin issue</span>
        <span className="text-[#5B6B84]">{id}</span>
      </span>
    </div>
  )
}

export default function PluginDetail() {
  const data = useLoader<PluginPageData>(loader_plugin)

  if (!data) {
    return (
      <Spinner
        size="size-8"
        label="Loading plugin…"
        className="py-24"
      />
    )
  }
  if (!data.ok) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8">
        <p className="text-2xl font-semibold text-[#EDF2F7]">{data.error}</p>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-[#C8FF2E] underline-offset-4 decoration-[#C8FF2E]/40 hover:underline"
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
    <div className="mx-auto mt-8 max-w-[1120px] px-5 sm:px-8">
      <a
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#C8FF2E] underline-offset-4 decoration-[#C8FF2E]/40 hover:underline"
      >
        <Icon path={icons.arrowLeft} className="size-4" />
        Browse
      </a>

      <Card spine className="overflow-hidden p-6 sm:p-8">
        <div className="pl-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-[30px] font-extrabold tracking-[-0.02em] text-[#EDF2F7]">
              {plugin.name}
            </h1>
            <Badge status={plugin.status} />
            <VersionChip>v{plugin.version}</VersionChip>
          </div>
          <p className="mt-1 font-mono text-[13px] text-[#5B6B84]">
            {plugin.id}
          </p>
          <p className="mt-3 max-w-[65ch] text-[15px] leading-6 text-[#8B9CB8]">
            {plugin.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip variant="category">{plugin.category}</Chip>
            {plugin.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-[#1D2735] pt-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px] text-[#5EEAD4]">
                <Icon path={icons.download} className="size-3.5" />
                {plugin.downloads}
              </span>
              <span className="text-[#1D2735]">·</span>
              <span className="text-[#8B9CB8]">by {plugin.author}</span>
              {latest ? (
                <>
                  <span className="text-[#1D2735]">·</span>
                  <span className="font-mono text-[12px] text-[#8B9CB8]">
                    PUBLISHED{" "}
                    {new Date(latest.createdAt).toLocaleDateString()}
                  </span>
                </>
              ) : null}
            </div>
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

      <div className="mt-6 grid gap-6 pb-4 lg:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <SectionHeading label="Install" />
          <CommandBlock
            className="mt-4"
            command={`ob-plugin install ${plugin.id}`}
          />
          {manifest.permissions?.vaultCreate?.length ? (
            <p className="mt-3 flex gap-3 rounded-[10px] border border-[rgba(255,178,36,0.35)] bg-[rgba(255,178,36,0.08)] p-3.5 text-[13.5px] leading-5 text-[#FFB224]">
              <Icon
                path={icons.warning}
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Requires vault keys:{" "}
                {manifest.permissions.vaultCreate.join(", ")} — fill them on
                your open-bot Config → Keys page after installing.
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
                  <p className="mt-3 flex items-center gap-2 text-[13px] text-[#8B9CB8]">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-[#2C3A4F] border-t-[#C8FF2E]" />
                    Awaiting agent review — usually &lt; 48h.
                  </p>
                ) : null}
                {security.findings.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {security.findings.map((finding) => (
                      <li
                        key={`${finding.severity}:${finding.path ?? ""}:${finding.title}`}
                        className="rounded-[10px] border border-[#1D2735] bg-[#080C12] p-3 text-[13.5px] leading-5"
                      >
                        <span className="font-medium text-[#EDF2F7]">
                          [{finding.severity}] {finding.title}
                        </span>
                        {finding.path ? (
                          <span className="mt-0.5 block font-mono text-[12px] text-[#8B9CB8]">
                            {finding.path}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[13px] text-[#8B9CB8]">
                No automated review recorded.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeading label="Versions" />
          <div className="relative mt-1 pl-6">
            <div className="absolute bottom-2 left-[5px] top-2 w-px bg-[#1D2735]" />
            <ul>
              {versions.map((version, index) => (
                <li
                  key={version.version}
                  className="relative py-3 first:pt-2 last:pb-0"
                >
                  {index === 0 ? (
                    <span className="absolute left-[-24px] top-[20px] size-2.5 rounded-full bg-[#C8FF2E] shadow-[0_0_12px_rgba(200,255,46,0.8)] ring-4 ring-[rgba(200,255,46,0.12)]" />
                  ) : (
                    <span className="absolute left-[-23px] top-[21px] size-2 rounded-full border border-[#3A4A63] bg-[#0A0E14]" />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13.5px] font-bold text-[#EDF2F7]">
                      v{version.version}
                    </span>
                    {index === 0 ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#C8FF2E]">
                        latest
                      </span>
                    ) : null}
                    {version.stability === "dev" ? (
                      <Badge status="dev" />
                    ) : null}
                    <span className="ml-auto font-mono text-[12px] text-[#8B9CB8]">
                      {new Date(version.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {version.notes ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#8B9CB8]">
                      {version.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {detail.readme ? (
          <Card className="p-5 sm:p-6">
            <SectionHeading label="README" />
            <pre className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-[#1D2735] bg-[#080C12] p-4 font-mono text-[13px] leading-6 text-[#B8C2D4]">
              {detail.readme}
            </pre>
          </Card>
        ) : null}

        <Card className="p-5">
          <SectionHeading label="Discussion" />
          <p className="mt-3 text-[13px] leading-5 text-[#8B9CB8]">
            Agents talk to the creator here. Found a bug? File an issue from
            your desktop:
          </p>
          <CliHint id={plugin.id} />
          <ul className="mt-4 space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-[10px] border border-[#1D2735] bg-[#080C12] p-3.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#EDF2F7]">
                    {comment.author}
                  </span>
                  <span className="font-mono text-[12px] text-[#8B9CB8]">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-6 text-[#8B9CB8]">
                  {comment.body}
                </p>
              </li>
            ))}
            {comments.length === 0 ? (
              <li>
                <EmptyState
                  icon={icons.message}
                  title="No discussion yet."
                >
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
