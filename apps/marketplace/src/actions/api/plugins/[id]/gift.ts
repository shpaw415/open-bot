"no action"

import { getSessionUser } from "../../../../lib/auth"
import { getPluginRow } from "../../../../lib/db"
import { revalidatePluginPage } from "../../../../lib/page-cache"
import {
  createGift,
  hasLicense,
  listPluginGifts,
  revokeGift,
} from "../../../../lib/purchases"

// Plugin gifting: the owner comps a lifetime license to a registered
// marketplace user. Session auth; every mutation re-checks ownership against
// plugins.owner_user_id — the same identity the publish flow enforces.

async function ownerPlugin(
  db: D1Database,
  request: Request,
  id: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const user = await getSessionUser(db, request)
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    }
  }
  const plugin = await getPluginRow(db, id)
  if (!plugin || plugin.status !== "approved") {
    return {
      ok: false,
      response: Response.json({ error: "plugin not found" }, { status: 404 }),
    }
  }
  if (plugin.owner_user_id !== user.userId) {
    return {
      ok: false,
      response: Response.json(
        { error: "not the plugin owner" },
        { status: 403 },
      ),
    }
  }
  return { ok: true, userId: user.userId }
}

// Owner view: the plugin's gift list. A 403 tells the plugin page the viewer
// is not the owner, so the gift card stays hidden.
export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const { DB } = context.env
  const id = decodeURIComponent(context.params.id as string)
  const gate = await ownerPlugin(DB, context.request, id)
  if (!gate.ok) return gate.response
  const gifts = await listPluginGifts(DB, id)
  return Response.json({ ok: true, gifts })
}

export async function onRequestPost(context: EventContext<Env, "id", never>) {
  const { DB } = context.env
  const id = decodeURIComponent(context.params.id as string)
  const gate = await ownerPlugin(DB, context.request, id)
  if (!gate.ok) return gate.response
  const plugin = await getPluginRow(DB, id)
  if (!plugin) {
    return Response.json({ error: "plugin not found" }, { status: 404 })
  }
  if ((plugin.price_cents ?? 0) <= 0) {
    return Response.json(
      { error: "free plugins need no license to gift" },
      { status: 400 },
    )
  }
  let body: { email?: unknown; note?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return Response.json(
      { error: "enter the recipient's marketplace email" },
      { status: 400 },
    )
  }
  const note = typeof body.note === "string" ? body.note : undefined
  // Registered users only: the account must have signed in at least once so
  // it exists in market_users; most recent login wins on a shared email.
  const recipient = await DB.prepare(
    `SELECT id, email, name FROM market_users
     WHERE lower(email) = ?1 ORDER BY last_login_at DESC LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string; email: string | null; name: string | null }>()
  if (!recipient) {
    return Response.json(
      {
        error:
          "no marketplace account with that email has signed in yet — ask them to sign in at market.open-bot.app first",
      },
      { status: 404 },
    )
  }
  if (recipient.id === gate.userId) {
    return Response.json(
      { error: "you already have a license as the author" },
      { status: 400 },
    )
  }
  if (await hasLicense(DB, recipient.id, id)) {
    return Response.json({ ok: true, alreadyOwned: true, recipient })
  }
  const versions = await DB.prepare(
    "SELECT version FROM plugin_versions WHERE plugin_id = ?1 ORDER BY created_at DESC",
  )
    .bind(id)
    .first<{ version: string }>()
  await createGift(DB, {
    plugin,
    version: versions?.version ?? plugin.latest_version,
    fromUserId: gate.userId,
    toUserId: recipient.id,
    note,
  })
  await revalidatePluginPage(id, context).catch(() => undefined)
  return Response.json({ ok: true, recipient })
}

export async function onRequestDelete(context: EventContext<Env, "id", never>) {
  const { DB } = context.env
  const id = decodeURIComponent(context.params.id as string)
  const gate = await ownerPlugin(DB, context.request, id)
  if (!gate.ok) return gate.response
  const giftId = new URL(context.request.url).searchParams.get("giftId") ?? ""
  if (!giftId) {
    return Response.json({ error: "giftId is required" }, { status: 400 })
  }
  const gift = await revokeGift(DB, giftId, gate.userId)
  if (!gift || gift.status !== "refunded") {
    return Response.json({ error: "gift not found" }, { status: 404 })
  }
  await revalidatePluginPage(id, context).catch(() => undefined)
  return Response.json({ ok: true, gift })
}
