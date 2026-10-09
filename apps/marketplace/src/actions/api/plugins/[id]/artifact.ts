"no action"

import { apiKeyAuth, touchApiKey } from "../../../../lib/auth"
import { getPluginRow, getVersions } from "../../../../lib/db"

// Streams the security-reviewed release tarball stored in R2 at publish time
// to open-bot instances, which extract the manifest's declared payload files
// from it at install. Auth: instance token or a marketplace user API key.
export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const { DB, MARKETPLACE_TOKEN, RELEASES } = context.env
  const apiKey = await apiKeyAuth(DB, context.request)
  if (apiKey) void touchApiKey(DB, apiKey.keyId).catch(() => undefined)
  const header = context.request.headers.get("authorization") ?? ""
  const tokened =
    /^Bearer\s+/i.test(header) &&
    header.replace(/^Bearer\s+/i, "") === MARKETPLACE_TOKEN
  if (!tokened && !apiKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  const row = await getPluginRow(DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  const url = new URL(context.request.url)
  const version = url.searchParams.get("version") ?? row.latest_version
  const versions = await getVersions(DB, id)
  const match = versions.find((item) => item.version === version)
  if (!match) {
    return Response.json({ error: "version not found" }, { status: 404 })
  }
  if (!match.artifact_key || !RELEASES) {
    return Response.json(
      { error: "no reviewed artifact stored for this version" },
      { status: 404 },
    )
  }
  const object = await RELEASES.get(match.artifact_key)
  if (!object) {
    return Response.json({ error: "artifact missing" }, { status: 404 })
  }
  const headers = new Headers()
  headers.set("content-type", "application/gzip")
  headers.set("x-artifact-version", match.version)
  if (match.artifact_sha256) {
    headers.set("x-artifact-sha256", match.artifact_sha256)
  }
  return new Response(object.body, { headers })
}
