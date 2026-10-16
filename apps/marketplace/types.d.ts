interface Env {
  DB: D1Database
  DYNAMIC_PAGE_KV: KVNamespace
  AI?: Ai
  RELEASES?: R2Bucket
  SECURITY_REVIEW?: Queue<{
    pluginId: string
    version: string
    enqueuedAt: number
  }>
  SECURITY_REVIEW_ASYNC?: string
  OPENAUTH_ISSUER_URL?: string
  OPENAUTH_CLIENT_ID?: string
  MARKETPLACE_TOKEN?: string
  ADMIN_TOKEN?: string
  GITHUB_TOKEN?: string
  // Paid plugins: Stripe secret key (sk_…/rk_…) and the checkout-session
  // webhook signing secret (whsec_…). PLATFORM_FEE_BPS is the platform cut in
  // basis points (default 1500 = 15%).
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  PLATFORM_FEE_BPS?: string
}

// The build injects PUBLIC_ env vars at build time (@cf-process-env.js).
declare const process: {
  env: { NODE_ENV?: string; [key: string]: string | undefined }
}
