import { renameSync, writeFileSync } from "node:fs"

const POLL_MS = 5000
const FAIL_LIMIT = 4
const URL_MAX = 2048

export function normalizePageUrl(targets: unknown): string | null {
  if (!Array.isArray(targets)) return null
  for (const item of targets) {
    const row = item as { type?: string; url?: string }
    if (row?.type !== "page") continue
    const url = typeof row.url === "string" ? row.url : ""
    if (url.length > URL_MAX || !/^https?:\/\//.test(url)) continue
    return url
  }
  return null
}

export function saveUrl(file: string, url: string) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, url)
  renameSync(tmp, file)
}

async function watch(port: number, file: string) {
  const endpoint = `http://127.0.0.1:${port}/json/list`
  let last: string | null = null
  let fails = 0
  for (;;) {
    let url: string | null = null
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(2000),
      })
      url = response.ok ? normalizePageUrl(await response.json()) : null
      fails = 0
    } catch {
      fails += 1
      if (fails >= FAIL_LIMIT) return
    }
    if (url && url !== last) {
      try {
        saveUrl(file, url)
        last = url
      } catch {}
    }
    await Bun.sleep(POLL_MS)
  }
}

async function main() {
  const session = process.argv[2] ?? ""
  const port = Number(process.argv[3])
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session) || !Number.isInteger(port)) {
    throw new Error("usage: url-watch.ts SESSION CDP_PORT")
  }
  await watch(port, `/home/agent/.open-bot/screens/${session}.url`)
}

if (import.meta.main) {
  main().catch(() => process.exit(1))
}
