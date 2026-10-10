import { opencodeExec } from "./docker"
import { HttpError } from "./http-error"

export const APP_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export type CatalogApp = {
  id: string
  name: string
  exec: string[]
}

// ob-app's catalog marks the chrome alias; the real argv is resolved inside
// ob-app (google-chrome, or chromium on arm64) with its own profile.
const CHROME_MARK = "__chrome__"

export function parseAppCatalog(text: string): CatalogApp[] {
  const apps: CatalogApp[] = []
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw !== "object" || raw === null) continue
    const row = raw as { id?: unknown; name?: unknown; exec?: unknown }
    const id = typeof row.id === "string" ? row.id : ""
    const name = typeof row.name === "string" ? row.name : ""
    const exec = typeof row.exec === "string" ? row.exec : ""
    if (!APP_ID_PATTERN.test(id) || !name.trim() || !exec) continue
    if (seen.has(id)) continue
    seen.add(id)
    apps.push({
      id,
      name: name.trim().slice(0, 80),
      exec:
        exec === CHROME_MARK
          ? [CHROME_MARK]
          : exec
              .split(" ")
              .filter((token) => !/^%[a-zA-Z]{0,2}$/.test(token))
              .filter(Boolean)
              .slice(0, 16)
              .map((token) => token.slice(0, 256)),
    })
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

export function findCatalogApp(
  apps: CatalogApp[],
  appId: string,
): CatalogApp | null {
  return apps.find((app) => app.id === appId) ?? null
}

async function runObApp(userId: string, args: string[]) {
  const result = await opencodeExec(userId, ["/usr/local/bin/ob-app", ...args])
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new HttpError(
      502,
      detail || "the desktop app command failed",
      "app_command",
    )
  }
  return result.stdout
}

export async function desktopAppCatalog(userId: string): Promise<CatalogApp[]> {
  return parseAppCatalog(await runObApp(userId, ["catalog"]))
}

export type AppLaunch = {
  app: string
  pid: number
}

export async function launchDesktopApp(
  userId: string,
  sessionId: string,
  appId: string,
): Promise<AppLaunch> {
  if (!APP_ID_PATTERN.test(appId)) {
    throw new HttpError(400, "invalid app id", "bad_app")
  }
  const apps = await desktopAppCatalog(userId)
  const app = findCatalogApp(apps, appId)
  if (!app) {
    throw new HttpError(
      404,
      "that app is not installed on the desktop",
      "app_missing",
    )
  }
  const argv =
    app.exec[0] === CHROME_MARK ? ["chrome"] : ["launch", ...app.exec]
  const out = await runObApp(userId, ["--session", sessionId, ...argv])
  const pid = Number(/"pid":(\d+)/.exec(out)?.[1] ?? 0)
  return { app: app.name, pid }
}
