"no action"

import {
  clearOAuthCookie,
  createSession,
  exchangeCode,
  oauthConfig,
  readOAuthCookie,
  sessionCookie,
  upsertUser,
  verifyAccessToken,
} from "../../../lib/auth"

function redirect(path: string, ...cookies: string[]): Response {
  const headers = new Headers({ location: path })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

export async function onRequestGet(context: EventContext<Env, never, never>) {
  const config = oauthConfig(context.env, context.request)
  if (!config) return redirect("/?loginError=notconfigured", clearOAuthCookie())
  const url = new URL(context.request.url)
  const error = url.searchParams.get("error")
  if (error)
    return redirect(
      `/?loginError=${encodeURIComponent(error)}`,
      clearOAuthCookie(),
    )
  const code = url.searchParams.get("code")
  const saved = readOAuthCookie(context.request)
  if (!code || !saved || saved.state !== url.searchParams.get("state")) {
    return redirect("/?loginError=state", clearOAuthCookie())
  }
  const accessToken = await exchangeCode(config, code, saved.verifier)
  if (!accessToken) return redirect("/?loginError=exchange", clearOAuthCookie())
  const identity = await verifyAccessToken(config, accessToken)
  if (!identity) return redirect("/?loginError=verify", clearOAuthCookie())
  const { DB } = context.env
  await upsertUser(DB, identity)
  const token = await createSession(DB, identity.id)
  return redirect("/account", clearOAuthCookie(), sessionCookie(token))
}
