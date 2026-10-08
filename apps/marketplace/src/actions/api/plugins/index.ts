"no action"

import { searchPlugins } from "../../../lib/db"

export async function onRequestGet(context: EventContext<Env, never, never>) {
  const url = new URL(context.request.url)
  const plugins = await searchPlugins(context.env.DB, {
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    includeAll: false,
  })
  return Response.json({ plugins })
}
