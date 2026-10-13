import {
  type CdpSocket,
  evaluate,
  listPageTargets,
  openSocket,
  type PageTarget,
  pickPageTarget,
  present,
} from "./cdp"

const USAGE =
  "usage: chrome.ts PORT navigate URL | url | back | forward | reload"

export type PageState = { url: string; title: string; via?: string }

export function normalizeTarget(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (/^[\w-]+(\.[\w-]+)+/.test(value)) return `https://${value}`
  return null
}

const STATE_SCRIPT = "({url:location.href,title:document.title})"

export function shapeState(raw: unknown): PageState {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    url: String(row.url ?? ""),
    title: String(row.title ?? ""),
  }
}

async function readState(socket: CdpSocket): Promise<PageState> {
  return shapeState(await evaluate(socket, STATE_SCRIPT))
}

async function resolvePage(
  port: number,
): Promise<{ target: PageTarget; socket: CdpSocket }> {
  const targets = await listPageTargets(port)
  const target = pickPageTarget(targets)
  if (!target) throw new Error("no page on this screen")
  const socket = await openSocket(target.webSocketDebuggerUrl)
  return { target, socket }
}

async function front(socket: CdpSocket) {
  await present(socket).catch(() => undefined)
}

// One Page.navigate plus a bounded settle loop. The per-call ws timeout in
// cdp.ts turns a crashed renderer into a throw, which is what triggers the
// /json/new fallback below.
async function navigateLive(
  url: string,
  socket: CdpSocket,
): Promise<PageState> {
  await socket.call("Page.navigate", { url })
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      const href = await evaluate(socket, "location.href")
      if (typeof href === "string" && href && !href.startsWith("about:")) break
    } catch (error) {
      // A call timeout means the renderer is gone; a plain context error is
      // the normal navigation teardown and just waits for the next poll.
      if (error instanceof Error && /timed out/i.test(error.message))
        throw error
    }
    if (Date.now() > deadline) break
    await Bun.sleep(250)
  }
  const state = await readState(socket).catch(() => ({ url, title: "" }))
  await front(socket)
  return state
}

async function openFreshTab(
  port: number,
  url: string,
  dead?: PageTarget,
): Promise<PageState> {
  let made: Response
  try {
    made = await fetch(
      `http://127.0.0.1:${port}/json/new?url=${encodeURIComponent(url)}`,
      { method: "PUT", signal: AbortSignal.timeout(4000) },
    )
  } catch {
    throw new Error("chrome is not reachable on this screen")
  }
  if (!made.ok) {
    throw new Error("page is unresponsive and a fresh tab could not be opened")
  }
  // The dead tab would keep winning target selection; close just the one
  // that stopped answering. Other windows stay untouched.
  if (dead) {
    await fetch(`http://127.0.0.1:${port}/json/close/${dead.id}`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined)
  }
  try {
    const target = (await made.json()) as { webSocketDebuggerUrl?: string }
    if (target.webSocketDebuggerUrl) {
      const socket = await openSocket(target.webSocketDebuggerUrl)
      try {
        await front(socket)
      } finally {
        socket.close()
      }
    }
  } catch {}
  return { url, title: "", via: "new-tab" }
}

async function navigate(port: number, raw: string): Promise<PageState> {
  const url = normalizeTarget(raw)
  if (!url) throw new Error(USAGE)
  try {
    const { socket } = await resolvePage(port)
    try {
      return await navigateLive(url, socket)
    } finally {
      socket.close()
    }
  } catch {
    let dead: PageTarget | undefined
    try {
      dead = pickPageTarget(await listPageTargets(port)) ?? undefined
    } catch {}
    return openFreshTab(port, url, dead)
  }
}

async function current(port: number): Promise<PageState> {
  const { socket } = await resolvePage(port)
  try {
    return await readState(socket)
  } finally {
    socket.close()
  }
}

async function history(port: number, delta: -1 | 1): Promise<PageState> {
  const { socket } = await resolvePage(port)
  try {
    await evaluate(socket, `history.go(${delta})`)
    await Bun.sleep(800)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

async function reload(port: number): Promise<PageState> {
  const { socket } = await resolvePage(port)
  try {
    await socket
      .call("Page.reload")
      .catch(() => evaluate(socket, "location.reload()"))
    await Bun.sleep(900)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

export function verbFrom(argv: string[]): {
  verb: string
  url?: string
} {
  const [verb = "", ...rest] = argv
  if (verb === "navigate") {
    let url = ""
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index]
      if (arg === "--url") url = rest[index + 1] ?? ""
      else if (arg.startsWith("--url=")) url = arg.slice(6)
      else if (!arg.startsWith("--") && !url) url = arg
    }
    return { verb, url }
  }
  return { verb }
}

async function main() {
  const port = Number(process.argv[2])
  const { verb, url } = verbFrom(process.argv.slice(3))
  if (!Number.isInteger(port) || !verb) throw new Error(USAGE)
  let state: PageState
  if (verb === "navigate") state = await navigate(port, url ?? "")
  else if (verb === "url") state = await current(port)
  else if (verb === "back") state = await history(port, -1)
  else if (verb === "forward") state = await history(port, 1)
  else if (verb === "reload") state = await reload(port)
  else throw new Error(USAGE)
  console.log(JSON.stringify(state))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const raw = error instanceof Error ? error.message : "chrome failed"
    let message = raw
    if (/unable to connect|econnrefused|fetch failed/i.test(raw)) {
      message = "chrome is not reachable on this screen"
    }
    console.error(
      /timed out|unresponsive/i.test(message)
        ? `${message}. Recover with ob-chrome --session SESSION navigate URL`
        : message,
    )
    process.exit(1)
  })
}
