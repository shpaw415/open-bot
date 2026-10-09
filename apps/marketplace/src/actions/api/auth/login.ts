"no action"

import {
  createPkcePair,
  oauthConfig,
  oauthCookie,
  randomToken,
} from "../../../lib/auth"

export async function onRequestGet(context: EventContext<Env, never, never>) {
  const config = oauthConfig(context.env, context.request)
  if (!config) {
    return Response.json(
      { error: "marketplace login is not configured" },
      { status: 503 },
    )
  }
  const state = randomToken(16)
  const { verifier, challenge } = await createPkcePair()
  const authorize = new URL(`${config.issuer}/authorize`)
  authorize.searchParams.set("client_id", config.clientID)
  authorize.searchParams.set("redirect_uri", config.redirectURI)
  authorize.searchParams.set("response_type", "code")
  authorize.searchParams.set("state", state)
  authorize.searchParams.set("code_challenge", challenge)
  authorize.searchParams.set("code_challenge_method", "S256")
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "set-cookie": oauthCookie(state, verifier),
    },
  })
}
