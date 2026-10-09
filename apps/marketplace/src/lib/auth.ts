import { createRemoteJWKSet, jwtVerify } from "jose"

export const SESSION_COOKIE = "mkt_session"
const OAUTH_COOKIE = "mkt_oauth"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OAUTH_TTL_SECONDS = 600

export type SessionUser = {
  userId: string
  email: string | null
  name: string | null
}

export type OAuthConfig = {
  issuer: string
  clientID: string
  redirectURI: string
}

export function oauthConfig(env: Env, request: Request): OAuthConfig | null {
  const issuer = (env.OPENAUTH_ISSUER_URL ?? "").replace(/\/$/, "")
  const clientID = env.OPENAUTH_CLIENT_ID ?? ""
  if (!issuer || !clientID) return null
  const origin = new URL(request.url).origin
  return { issuer, clientID, redirectURI: `${origin}/api/auth/callback` }
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? ""
  const cookies: Record<string, string> = {}
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
  }
  return cookies
}

function cookieString(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function sessionCookie(token: string): string {
  return cookieString(SESSION_COOKIE, token, SESSION_TTL_MS / 1000)
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export type PkcePair = { verifier: string; challenge: string }

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(48)
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )
  return { verifier, challenge: base64url(digest) }
}

export function oauthCookie(state: string, verifier: string): string {
  const payload = JSON.stringify({ state, verifier })
  return cookieString(OAUTH_COOKIE, payload, OAUTH_TTL_SECONDS)
}

export function readOAuthCookie(
  request: Request,
): { state: string; verifier: string } | null {
  const raw = parseCookies(request)[OAUTH_COOKIE]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; verifier?: unknown }
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string")
      return null
    return { state: parsed.state, verifier: parsed.verifier }
  } catch {
    return null
  }
}

export function clearOAuthCookie(): string {
  return `${OAUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null

export type IssuerIdentity = {
  id: string
  email: string | null
  name: string | null
}

export async function verifyAccessToken(
  config: OAuthConfig,
  accessToken: string,
): Promise<IssuerIdentity | null> {
  try {
    if (!jwksCache)
      jwksCache = createRemoteJWKSet(
        new URL(`${config.issuer}/.well-known/jwks.json`),
      )
    const { payload } = await jwtVerify(accessToken, jwksCache, {
      issuer: config.issuer,
      audience: config.clientID,
    })
    const properties = payload.properties as
      | {
          id?: unknown
          data?: { email?: unknown; name?: unknown }
        }
      | undefined
    if (!properties || typeof properties.id !== "string") return null
    const email = properties.data?.email
    const name = properties.data?.name
    return {
      id: properties.id,
      email: typeof email === "string" ? email : null,
      name: typeof name === "string" ? name : null,
    }
  } catch {
    return null
  }
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${config.issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectURI,
        client_id: config.clientID,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const parsed = (await response.json()) as { access_token?: unknown }
    return typeof parsed.access_token === "string" ? parsed.access_token : null
  } catch {
    return null
  }
}

const API_KEY_PREFIX = "obm_"

export async function upsertUser(
  db: D1Database,
  identity: IssuerIdentity,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO market_users (id, email, name, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (id) DO UPDATE SET email = ?2, name = ?3, last_login_at = ?4`,
    )
    .bind(identity.id, identity.email, identity.name, now)
    .run()
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<string> {
  const token = randomToken(32)
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS)
    .run()
  return token
}

export async function getSessionUser(
  db: D1Database,
  request: Request,
): Promise<SessionUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT s.user_id, u.email, u.name FROM auth_sessions s
       JOIN market_users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first<{ user_id: string; email: string | null; name: string | null }>()
  if (!row) return null
  return { userId: row.user_id, email: row.email, name: row.name }
}

export async function destroySession(
  db: D1Database,
  request: Request,
): Promise<void> {
  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return
  await db
    .prepare("DELETE FROM auth_sessions WHERE token_hash = ?1")
    .bind(await sha256Hex(token))
    .run()
}

export async function generateApiKey(): Promise<{
  key: string
  hash: string
  hint: string
}> {
  const key = `${API_KEY_PREFIX}${randomToken(24)}`
  return { key, hash: await sha256Hex(key), hint: key.slice(-4) }
}

export function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
}

export async function marketplaceWriteAuth(
  db: D1Database,
  request: Request,
  instanceToken: string | undefined,
): Promise<{ keyId: string | null } | null> {
  const apiKey = await apiKeyAuth(db, request)
  if (apiKey) return { keyId: apiKey.keyId }
  const token = bearerToken(request)
  if (instanceToken && token === instanceToken) return { keyId: null }
  return null
}

export async function apiKeyAuth(
  db: D1Database,
  request: Request,
): Promise<{ userId: string; keyId: string } | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.replace(/^Bearer\s+/i, "").trim()
  if (!token.startsWith(API_KEY_PREFIX)) return null
  const row = await db
    .prepare(
      `SELECT id, user_id FROM api_keys
       WHERE key_hash = ?1 AND revoked_at IS NULL`,
    )
    .bind(await sha256Hex(token))
    .first<{ id: string; user_id: string }>()
  if (!row) return null
  return { userId: row.user_id, keyId: row.id }
}

export async function touchApiKey(
  db: D1Database,
  keyId: string,
): Promise<void> {
  await db
    .prepare("UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1")
    .bind(keyId, Date.now())
    .run()
}
