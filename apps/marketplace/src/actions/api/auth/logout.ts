"no action"

import { clearSessionCookie, destroySession } from "../../../lib/auth"

export async function onRequestPost(context: EventContext<Env, never, never>) {
  await destroySession(context.env.DB, context.request)
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie() },
  })
}
