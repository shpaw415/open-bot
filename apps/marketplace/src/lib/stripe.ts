// Minimal Stripe REST client for paid plugins: Checkout (one-time purchase,
// destination charge to the author's Connect Express account), refunds, and
// Express onboarding. Hand-rolled on fetch — the marketplace runs on
// Cloudflare Pages, so there is no Node http client for the official SDK.
// All money moves as integer cents; the platform cut comes from the
// PLATFORM_FEE_BPS var (basis points, default 15%).

export const DEFAULT_FEE_BPS = 1500

export function platformFeeBps(env: Env): number {
  const raw = Number(env.PLATFORM_FEE_BPS)
  if (!Number.isFinite(raw) || raw < 0 || raw > 5000) return DEFAULT_FEE_BPS
  return Math.round(raw)
}

// Splits a gross price into the platform application fee and the author's
// transfer. Stripe's own processing fee is deducted from the application fee
// on destination charges (platform bears it).
export function feeSplit(
  amountCents: number,
  bps: number,
): { feeCents: number; earningsCents: number } {
  const feeCents = Math.max(
    0,
    Math.min(amountCents, Math.round((amountCents * bps) / 10_000)),
  )
  return { feeCents, earningsCents: amountCents - feeCents }
}

export function stripeConfigured(env: Env): boolean {
  return (
    typeof env.STRIPE_SECRET_KEY === "string" && env.STRIPE_SECRET_KEY !== ""
  )
}

// Stripe's form encoding: bracketed keys carry the nesting; values are
// strings/numbers (booleans encoded as "true"/"false" by String()).
type StripeParams = Record<string, string | number | boolean | undefined>

function formEncode(params: StripeParams): string {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value))
  }
  return form.toString()
}

class StripeError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function stripeRequest(
  env: Env,
  method: "GET" | "POST",
  path: string,
  params?: StripeParams,
): Promise<Record<string, unknown>> {
  const key = env.STRIPE_SECRET_KEY ?? ""
  if (!key) throw new StripeError("stripe is not configured", 503)
  const query = method === "GET" && params ? `?${formEncode(params)}` : ""
  let response: Response
  try {
    response = await fetch(`https://api.stripe.com/v1${path}${query}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(method === "POST"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: method === "POST" && params ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new StripeError(
      `stripe unreachable: ${error instanceof Error ? error.message : "request failed"}`,
      502,
    )
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new StripeError(
      body.error?.message?.slice(0, 300) ?? `stripe error ${response.status}`,
      response.status === 402 || response.status === 400 ? 400 : 502,
    )
  }
  return body
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return diff === 0
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

// Verifies the Stripe-Signature header (t=…,v1=…) over `${timestamp}.${body}`
// with a 5-minute replay tolerance.
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false
  const parts = header.split(",").map((part) => part.trim().split("="))
  const timestamp = parts.find((pair) => pair[0] === "t")?.[1]
  const signatures = parts
    .filter((pair) => pair[0] === "v1")
    .map((pair) => pair[1] ?? "")
  if (!timestamp || signatures.length === 0) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false
  const expected = await hmacHex(`${timestamp}.${payload}`, secret)
  const expectedBytes = new TextEncoder().encode(expected)
  for (const signature of signatures) {
    if (timingSafeEqual(new TextEncoder().encode(signature), expectedBytes)) {
      return true
    }
  }
  return false
}

export async function createCheckoutSession(
  env: Env,
  opts: {
    purchaseId: string
    pluginId: string
    pluginName: string
    amountCents: number
    feeCents: number
    destinationAccount: string
    origin: string
  },
): Promise<{ id: string; url: string }> {
  const session = await stripeRequest(env, "POST", "/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": opts.amountCents,
    "line_items[0][price_data][product_data][name]": `open-bot plugin: ${opts.pluginName}`,
    "line_items[0][price_data][product_data][description]": `Lifetime license for the ${opts.pluginId} plugin (incl. updates)`,
    "payment_intent_data[application_fee_amount]": opts.feeCents,
    "payment_intent_data[transfer_data][destination]": opts.destinationAccount,
    "payment_intent_data[description]": `open-bot plugin purchase: ${opts.pluginId}`,
    "metadata[purchase_id]": opts.purchaseId,
    "metadata[plugin_id]": opts.pluginId,
    "payment_intent_data[metadata][purchase_id]": opts.purchaseId,
    "payment_intent_data[metadata][plugin_id]": opts.pluginId,
    success_url: `${opts.origin}/plugins/${encodeURIComponent(opts.pluginId)}?purchase=success`,
    cancel_url: `${opts.origin}/plugins/${encodeURIComponent(opts.pluginId)}?purchase=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  })
  const id = typeof session.id === "string" ? session.id : ""
  const url = typeof session.url === "string" ? session.url : ""
  if (!id || !url) throw new StripeError("checkout session missing fields", 502)
  return { id, url }
}

export async function createRefund(
  env: Env,
  paymentIntentId: string,
): Promise<{ id: string; status: string }> {
  const refund = await stripeRequest(env, "POST", "/refunds", {
    payment_intent: paymentIntentId,
    // Pull the author's transfer back out of their Connect balance and return
    // the application fee. Stripe keeps its own processing fee either way.
    reverse_transfer: true,
    refund_application_fee: true,
  })
  return {
    id: typeof refund.id === "string" ? refund.id : "",
    status: typeof refund.status === "string" ? refund.status : "unknown",
  }
}

export async function createExpressAccount(
  env: Env,
  email: string | null,
): Promise<{ id: string }> {
  const account = await stripeRequest(env, "POST", "/accounts", {
    type: "express",
    // Country defaults to the platform's; payouts stay manual so the author
    // initiates each payout from their Express dashboard.
    email: email ?? undefined,
    "capabilities[transfers][requested]": true,
    "settings[payouts][schedule][interval]": "manual",
    business_type: "individual",
  })
  return { id: typeof account.id === "string" ? account.id : "" }
}

export async function createAccountLink(
  env: Env,
  accountId: string,
  origin: string,
): Promise<{ url: string }> {
  const link = await stripeRequest(env, "POST", "/account_links", {
    account: accountId,
    refresh_url: `${origin}/account?payout=refresh`,
    return_url: `${origin}/account?payout=done`,
    type: "account_onboarding",
  })
  return { url: typeof link.url === "string" ? link.url : "" }
}

export async function retrieveAccount(
  env: Env,
  accountId: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const account = await stripeRequest(env, "GET", `/accounts/${accountId}`)
  return {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
  }
}
