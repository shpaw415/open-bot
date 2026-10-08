"no action"

import { detailFromRows, getPluginRow, getVersions } from "../../../lib/db"
export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const id = decodeURIComponent(context.params.id as string)
  if (!id)
    return Response.json({ error: "plugin id is required" }, { status: 400 })
  const row = await getPluginRow(context.env.DB, id)
  if (!row || row.status === "rejected") {
    return Response.json({ error: "plugin not found" }, { status: 404 })
  }
  if (row.status !== "approved") {
    return Response.json({ error: "plugin is pending review" }, { status: 403 })
  }
  const url = new URL(context.request.url)
  const versions = await getVersions(context.env.DB, id)
  const detail = detailFromRows(
    row,
    versions,
    url.searchParams.get("version") ?? undefined,
  )
  if (!detail) {
    return Response.json({ error: "version not found" }, { status: 404 })
  }
  return Response.json(detail)
}
