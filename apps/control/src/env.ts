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
export const opencodeImage =
  process.env.OPENCODE_IMAGE ?? "open-bot-opencode:local"
export const computerImage =
  process.env.COMPUTER_IMAGE ?? "open-bot-computer:local"
export const vikingImage =
  process.env.VIKING_IMAGE ?? "ghcr.io/volcengine/openviking:latest"
export const cookieSecure = process.env.COOKIE_SECURE === "1"

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
    vikingData: `ob-viking-${key}`,
    x11: `ob-x11-${key}`,
  }
}
