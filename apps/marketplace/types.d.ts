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
}

// The build injects PUBLIC_ env vars at build time (@cf-process-env.js).
declare const process: {
  env: { NODE_ENV?: string; [key: string]: string | undefined }
}
