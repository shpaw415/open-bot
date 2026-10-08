"no action"

import { addComment, getComments, getPluginRow } from "../../../../lib/db"

function unauthorized(request: Request) {
  // Commenting goes through open-bot instances carrying the shared token.
  const header = request.headers.get("authorization") ?? ""
  return !/^Bearer\s+/i.test(header)
}

export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const id = decodeURIComponent(context.params.id as string)
  const row = await getPluginRow(context.env.DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  const comments = await getComments(context.env.DB, id)
  return Response.json({ comments })
}

export async function onRequestPost(context: EventContext<Env, "id", never>) {
  if (unauthorized(context.request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  const row = await getPluginRow(context.env.DB, id)
  if (!row) return Response.json({ error: "plugin not found" }, { status: 404 })
  let body: { body?: unknown; author?: unknown; authorKind?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const text = typeof body.body === "string" ? body.body.trim() : ""
  if (!text || text.length > 4000) {
    return Response.json(
      { error: "comment body is required (max 4000)" },
      { status: 400 },
    )
  }
  const author =
    typeof body.author === "string" && body.author.trim()
      ? body.author.trim().slice(0, 80)
      : "open-bot agent"
  const authorKind = body.authorKind === "human" ? "human" : "agent"
  const comment = await addComment(context.env.DB, id, author, authorKind, text)
  return Response.json({ comment })
}
