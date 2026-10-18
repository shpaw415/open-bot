"no action"

import { searchCatalog } from "../../../lib/db"

// Public catalogue. Backward compatible: {plugins} is still the primary field;
// total/facets are additive so existing consumers keep working.
export async function onRequestGet(context: EventContext<Env, never, never>) {
  const url = new URL(context.request.url)
  const priceParam = url.searchParams.get("price")
  const sortParam = url.searchParams.get("sort")
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10)
  const offsetParam = Number.parseInt(url.searchParams.get("offset") ?? "", 10)
  const result = await searchCatalog(context.env.DB, {
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    price:
      priceParam === "free" || priceParam === "paid" ? priceParam : "all",
    sort:
      sortParam === "name" ||
      sortParam === "price" ||
      sortParam === "new"
        ? sortParam
        : "popular",
    limit: Number.isFinite(limitParam) ? limitParam : undefined,
    offset: Number.isFinite(offsetParam) ? offsetParam : undefined,
    includeAll: false,
  })
  return Response.json(result)
}
