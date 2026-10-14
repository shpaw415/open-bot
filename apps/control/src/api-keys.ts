import type { Db, User } from "@open-bot/db"
import { keyVaultPublic, keyVaultSpecById } from "./key-vault"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

export function isKeysRequest(pathname: string, method: string): boolean {
  return (
    method === "GET" &&
    (pathname === "/api/keys" || pathname.startsWith("/api/keys/"))
  )
}

export function handleKeys(url: URL, db: Db, user: User): Response | null {
  if (url.pathname === "/api/keys") {
    return json({
      keys: keyVaultPublic().map((spec) => ({
        slug: spec.id,
        label: spec.label,
        chatProvider: spec.chatProvider,
        hasKey: (db.getUserKey(user.id, spec.id)?.apiKey ?? "") !== "",
      })),
    })
  }
  let slug = ""
  try {
    slug = decodeURIComponent(url.pathname.slice("/api/keys/".length))
  } catch {
    return json({ error: "bad key slug" }, 400)
  }
  if (!keyVaultSpecById(slug)) {
    return json(
      {
        error: `unknown key slug: ${slug}`,
        slugs: keyVaultPublic().map((item) => item.id),
      },
      400,
    )
  }
  const key = db.getUserKey(user.id, slug)
  if (!key || key.apiKey === "") {
    return json({ error: `no ${slug} key set` }, 404)
  }
  return json({
    slug,
    apiKey: key.apiKey,
    accountId: key.accountId,
    gatewayId: key.gatewayId,
    gatewayToken: key.gatewayToken,
    gatewaySlug: key.gatewaySlug,
    baseUrl: key.baseUrl,
  })
}
