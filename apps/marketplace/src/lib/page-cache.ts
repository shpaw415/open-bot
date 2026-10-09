import { revalidate } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/revalidate"

export function pluginPagePath(id: string) {
  return `/plugins/${encodeURIComponent(id)}`
}

export async function revalidatePluginPage(
  id: string,
  context: EventContext<Env, string, unknown> | EventContext<Env, never, never>,
) {
  const data = context.data as { storeProvider?: unknown } | undefined
  if (!data?.storeProvider) return
  await revalidate(pluginPagePath(id), context as never)
}
