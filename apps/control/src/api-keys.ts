import type { Db, User } from "@open-bot/db"
import { keyVaultPublic, keyVaultSpecById } from "./key-vault"
import { pluginVaultKeys } from "./plugins-apply"
import { effectiveUserKey, teamMode } from "./team"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

// The agent reads provider keys and every plugin-declared vault slug its own
// installed manifests declare (permissions.vaultCreate ∪ vaultRead) — keys are
// per-user, so plugins sharing a slug share one key.
function agentPluginKeys(db: Db, user: User) {
  return pluginVaultKeys(db.installedPlugins(user.id))
}

// Team mode locks the shared provider slugs for every principal (the admin
// manages them on the Admin page's Team section); plugin-declared vault slugs
// stay per-user and writable by their owner.
export function keysTeamLocked(db: Db, slug: string): boolean {
  return teamMode(db) === "team" && Boolean(keyVaultSpecById(slug))
}

export function isKeysRequest(pathname: string, method: string): boolean {
  return (
    method === "GET" &&
    (pathname === "/api/keys" || pathname.startsWith("/api/keys/"))
  )
}

export function handleKeys(url: URL, db: Db, user: User): Response | null {
  const pluginKeys = agentPluginKeys(db, user)
  if (url.pathname === "/api/keys") {
    return json({
      keys: [
        ...keyVaultPublic().map((spec) => ({
          slug: spec.id,
          label: spec.label,
          chatProvider: spec.chatProvider,
          hasKey: (effectiveUserKey(db, user.id, spec.id)?.apiKey ?? "") !== "",
        })),
        ...pluginKeys.map((key) => ({
          slug: key.slug,
          label: `${key.pluginNames[0] ?? key.slug} · ${key.slug}`,
          chatProvider: false,
          plugin: true,
          hasKey: (db.getUserKey(user.id, key.slug)?.apiKey ?? "") !== "",
        })),
      ],
    })
  }
  let slug = ""
  try {
    slug = decodeURIComponent(url.pathname.slice("/api/keys/".length))
  } catch {
    return json({ error: "bad key slug" }, 400)
  }
  const spec = keyVaultSpecById(slug)
  const pluginKey = spec ? null : pluginKeys.find((key) => key.slug === slug)
  if (!spec && !pluginKey) {
    return json(
      {
        error: `unknown key slug: ${slug}`,
        slugs: [
          ...keyVaultPublic().map((item) => item.id),
          ...pluginKeys.map((item) => item.slug),
        ],
      },
      400,
    )
  }
  const key = spec
    ? effectiveUserKey(db, user.id, slug)
    : db.getUserKey(user.id, slug)
  if (!key || key.apiKey === "") {
    return json({ error: `no ${slug} key set` }, 404)
  }
  return json({
    slug,
    apiKey: key.apiKey,
    accountId: key.accountId,
    gatewayId: spec ? key.gatewayId : "",
    gatewayToken: spec ? key.gatewayToken : "",
    gatewaySlug: spec ? key.gatewaySlug : "",
    baseUrl: key.baseUrl,
  })
}
