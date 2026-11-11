// Which scheme a request really arrived over, and where an insecure
// browser visit should go instead (#105). The dashboard sets Secure-only
// session cookies (COOKIE_SECURE=1): on an http origin a login form is a
// dead end — the cookie never sticks — so the form must never be offered
// there. `x-forwarded-proto` is attacker-controlled on any directly
// reachable origin, so it only counts when the deployment says a trusted
// proxy sits in front (OPEN_BOT_TRUST_PROXY=1) or the request already
// arrived on the configured canonical host.

export type ProtoInput = {
  forwardedProto: string | null
  host: string | null
  protocol: string
}

export type ProtoTrust = {
  canonicalOrigin: string
  trustProxy: boolean
}

export function effectiveProto(input: ProtoInput, trust: ProtoTrust): string {
  const direct = input.protocol.replace(/:$/, "")
  const forwarded = (input.forwardedProto ?? "").split(",")[0]?.trim()
  if (!forwarded) return direct
  if (trust.trustProxy) return forwarded
  try {
    const canonical = new URL(trust.canonicalOrigin)
    if (input.host && input.host === canonical.host) return forwarded
  } catch {
    // no canonical origin configured — the header proves nothing
  }
  return direct
}

// The redirect for a browser page load on an insecure origin, or null.
// Only page GETs move (never API calls, never credential POSTs), and only
// to an https canonical origin. Credentials are never carried across:
// a GET redirect has no body to leak.
export function insecureRedirect(
  input: { method: string; pathname: string; search: string; proto: string },
  canonicalOrigin: string,
): string | null {
  if (input.method !== "GET") return null
  if (input.proto === "https") return null
  if (input.pathname.startsWith("/api/") || input.pathname === "/api")
    return null
  try {
    const canonical = new URL(canonicalOrigin)
    if (canonical.protocol !== "https:") return null
    return `${canonical.origin}${input.pathname}${input.search}`
  } catch {
    return null
  }
}
