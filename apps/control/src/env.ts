import { existsSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

export const root = join(import.meta.dir, "../../..")
export const dataDir = process.env.DATA_DIR ?? join(root, "data")
export const port = Number(process.env.PORT ?? 8787)
export const bindHosts = (process.env.BIND_HOST ?? "100.96.0.3,127.0.0.1")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean)
export const aiConfigPath =
  process.env.OPEN_BOT_AI_CONFIG ?? join(root, "config/ai.ts")
export const webDist = process.env.WEB_DIST ?? join(root, "apps/web/dist")
export const inDocker =
  existsSync("/.dockerenv") || process.env.OPEN_BOT_IN_DOCKER === "1"
export const controlName =
  process.env.CONTROL_CONTAINER ?? (inDocker ? hostname() : "")
export const idleMinutes = Number(process.env.IDLE_MINUTES ?? 15)
export const maxDesktops = Number(process.env.MAX_DESKTOPS ?? 4)
export const maxThreadScreens = Number(process.env.MAX_THREAD_SCREENS ?? 3)
export const opencodeImage =
  process.env.OPENCODE_IMAGE ?? "open-bot-opencode:local"
export const computerImage =
  process.env.COMPUTER_IMAGE ?? "open-bot-computer:local"
export const vikingImage =
  process.env.VIKING_IMAGE ?? "ghcr.io/volcengine/openviking:latest"
export const sandboxImage =
  process.env.SANDBOX_IMAGE ?? "open-bot-sandbox:local"
export const maxSandboxesPerUser = Number(
  process.env.MAX_SANDBOXES_PER_USER ?? 3,
)
export const maxSandboxesInstance = Number(process.env.MAX_SANDBOXES ?? 8)
export const cookieSecure = process.env.COOKIE_SECURE === "1"
// Set to "1" only when a trusted reverse proxy terminates TLS in front of
// the control plane; x-forwarded-proto is honored then (see origin-guard).
export const trustProxy = process.env.OPEN_BOT_TRUST_PROXY === "1"
export const marketplaceUrl = (
  process.env.OPEN_BOT_MARKETPLACE_URL ?? ""
).replace(/\/$/, "")
export const marketplaceToken = process.env.OPEN_BOT_MARKETPLACE_TOKEN ?? ""
export const githubToken = process.env.OPEN_BOT_GITHUB_TOKEN ?? ""
// GitHub repo that receives open-bot product-report issues (ob-improve).
export const openBotRepo =
  process.env.OPEN_BOT_GITHUB_REPO ?? "shpaw415/open-bot"
// Public origin of this instance (e.g. https://open-bot.example.com) — lets
// the agent CLI report shareable /hooks/... URLs. Empty when unset.
export function publicOrigin() {
  return (process.env.OPEN_BOT_PUBLIC_URL ?? "").replace(/\/+$/, "")
}

// Sign-in must never be offered on an insecure origin when session cookies
// are Secure-only (#105): the login "works" but cannot stick, and the user
// has typed credentials over HTTP. Document requests either redirect to
// the configured canonical https origin, or get an HTTPS-required page —
// the credential form is never rendered on http. APIs and static assets
// keep their own handling (the session endpoint already refuses with the
// same cause).
export function dashboardOriginGate(input: {
  method: string
  pathname: string
  proto: string
  secure: boolean
  publicUrl: string
}): { action: "redirect"; to: string } | { action: "block" } | null {
  if (input.method !== "GET" && input.method !== "HEAD") return null
  if (!input.secure || input.proto === "https") return null
  if (input.pathname.startsWith("/api/") || input.pathname.startsWith("/llm/"))
    return null
  const last = input.pathname.split("/").at(-1) ?? ""
  if (/\.[a-z0-9]+$/i.test(last)) return null
  const publicUrl = input.publicUrl.replace(/\/+$/, "")
  if (publicUrl.startsWith("https://"))
    return { action: "redirect", to: `${publicUrl}${input.pathname}` }
  return { action: "block" }
}

// Dedicated origin for plugin app iframes. When set, frames load from this
// host (same control plane, different site) so plugin JS cannot inherit the
// dashboard session. Empty falls back to a sandboxed same-host frame.
export function pagesOrigin() {
  const raw = (process.env.OPEN_BOT_PAGES_ORIGIN ?? "")
    .trim()
    .replace(/\/+$/, "")
  if (!raw) return ""
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    if (url.username || url.password || url.pathname !== "/") return ""
    return url.origin
  } catch {
    return ""
  }
}

export function userKey(userId: string) {
  return userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)
}

export function names(userId: string) {
  const key = userKey(userId)
  return {
    key,
    network: `ob${key}`,
    opencode: `ob-oc-${key}`,
    computer: `ob-pc-${key}`,
    viking: `ob-vk-${key}`,
    home: `ob-home-${key}`,
    usrLocal: `ob-local-${key}`,
    vikingData: `ob-viking-${key}`,
    x11: `ob-x11-${key}`,
  }
}
