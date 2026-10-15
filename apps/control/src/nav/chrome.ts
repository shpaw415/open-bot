import {
  type CdpSocket,
  clearActiveTabId,
  evaluate,
  listPageTargets,
  openSocket,
  type PageTarget,
  pickPageTarget,
  present,
  readActiveTabId,
  writeActiveTabId,
} from "./cdp"

const USAGE =
  "usage: chrome.ts PORT SESSION navigate URL | newtab URL | tabs | switch N | closetab N | url | back | forward | reload"

export type PageState = {
  url: string
  title: string
  heading?: string
  text?: string
  via?: string
}

export function normalizeTarget(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (/^[\w-]+(\.[\w-]+)+/.test(value)) return `https://${value}`
  return null
}

// url, title, heading and the page body text ride back together so "navigate
// then read" is one call instead of two.
const STATE_SCRIPT =
  '({url:location.href,title:document.title,heading:(document.querySelector("h1")?document.querySelector("h1").textContent:"").replace(/\\s+/g," ").trim().slice(0,200),text:(document.body?document.body.innerText:"").replace(/\\s+/g," ").trim().slice(0,2500)})'

export function shapeState(raw: unknown): PageState {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    url: String(row.url ?? ""),
    title: String(row.title ?? ""),
    heading: String(row.heading ?? ""),
    text: String(row.text ?? ""),
  }
}

async function readState(socket: CdpSocket): Promise<PageState> {
  return shapeState(await evaluate(socket, STATE_SCRIPT))
}

async function resolvePage(
  port: number,
  session?: string,
): Promise<{ target: PageTarget; socket: CdpSocket }> {
  const targets = await listPageTargets(port)
  const target = pickPageTarget(targets, readActiveTabId(session))
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
    await Bun.sleep(120)
  }
  const state = await readState(socket).catch(() => ({ url, title: "" }))
  await front(socket)
  return state
}

async function jsonNew(port: number, url: string): Promise<Response> {
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
  return made
}

async function openFreshTab(
  port: number,
  session: string | undefined,
  url: string,
  dead?: PageTarget,
): Promise<PageState> {
  const made = await jsonNew(port, url)
  // The dead tab would keep winning target selection; close just the one
  // that stopped answering. Other windows stay untouched.
  if (dead) {
    await fetch(`http://127.0.0.1:${port}/json/close/${dead.id}`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined)
  }
  let id = ""
  try {
    const target = (await made.json()) as {
      id?: string
      webSocketDebuggerUrl?: string
    }
    id = target.id ?? ""
    if (target.webSocketDebuggerUrl) {
      const socket = await openSocket(target.webSocketDebuggerUrl)
      try {
        await front(socket)
      } finally {
        socket.close()
      }
    }
  } catch {}
  writeActiveTabId(session, id)
  return { url, title: "", via: "new-tab" }
}

// A new tab becomes the active one, exactly like a real browser: the state
// line answers like navigate, and later ob-page calls land in this tab.
async function newTab(
  port: number,
  session: string | undefined,
  raw: string,
): Promise<PageState> {
  const url = raw.trim() ? normalizeTarget(raw) : "about:blank"
  if (!url) throw new Error(USAGE)
  const made = await jsonNew(port, url)
  let id = ""
  let wsUrl = ""
  try {
    const target = (await made.json()) as {
      id?: string
      webSocketDebuggerUrl?: string
    }
    id = target.id ?? ""
    wsUrl = target.webSocketDebuggerUrl ?? ""
  } catch {}
  writeActiveTabId(session, id)
  if (!wsUrl) return { url, title: "", via: "new-tab" }
  const socket = await openSocket(wsUrl)
  try {
    if (url === "about:blank") {
      await front(socket)
      return { url: "about:blank", title: "", via: "new-tab" }
    }
    return { ...(await navigateLive(url, socket)), via: "new-tab" }
  } finally {
    socket.close()
  }
}

export type TabLine = {
  tabs: { index: number; url: string; title: string; active: boolean }[]
}

async function tabsLine(port: number, session: string | undefined) {
  const targets = await listPageTargets(port)
  const active = pickPageTarget(targets, readActiveTabId(session))
  return {
    tabs: targets.map((target, index) => ({
      index: index + 1,
      url: target.url,
      title: target.title,
      active: target.id === active?.id,
    })),
  }
}

// switch/closetab take the 1-based index tabs prints, or a url substring.
export function matchTab(
  targets: PageTarget[],
  arg: string,
): PageTarget | null {
  const value = arg.trim()
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1
    return targets[index] ?? null
  }
  const needle = value.toLowerCase()
  return (
    targets.find(
      (item) =>
        item.url.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle),
    ) ?? null
  )
}

async function switchTab(
  port: number,
  session: string | undefined,
  arg: string,
): Promise<PageState> {
  const targets = await listPageTargets(port)
  const target = matchTab(targets, arg)
  if (!target) throw new Error(`no tab matches ${arg}`)
  writeActiveTabId(session, target.id)
  const socket = await openSocket(target.webSocketDebuggerUrl)
  try {
    await front(socket)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

async function closeTab(
  port: number,
  session: string | undefined,
  arg: string,
): Promise<PageState> {
  const activeId = readActiveTabId(session)
  const targets = await listPageTargets(port)
  const target = arg.trim()
    ? matchTab(targets, arg)
    : pickPageTarget(targets, activeId)
  if (!target) throw new Error(arg.trim() ? `no tab matches ${arg}` : USAGE)
  const gone = await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`, {
    signal: AbortSignal.timeout(4000),
  }).catch(() => null)
  if (!gone?.ok) throw new Error("tab did not close")
  if (target.id === activeId) clearActiveTabId(session)
  // The screen should follow the survivor, not a closed tab.
  const rest = await listPageTargets(port).catch(() => [])
  const next = pickPageTarget(rest)
  if (!next) return shapeState(null)
  writeActiveTabId(session, next.id)
  const socket = await openSocket(next.webSocketDebuggerUrl)
  try {
    await front(socket)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

async function navigate(
  port: number,
  session: string | undefined,
  raw: string,
): Promise<PageState> {
  const url = normalizeTarget(raw)
  if (!url) throw new Error(USAGE)
  try {
    const { target, socket } = await resolvePage(port, session)
    try {
      const state = await navigateLive(url, socket)
      writeActiveTabId(session, target.id)
      return state
    } finally {
      socket.close()
    }
  } catch {
    let dead: PageTarget | undefined
    try {
      dead =
        pickPageTarget(await listPageTargets(port), readActiveTabId(session)) ??
        undefined
    } catch {}
    return openFreshTab(port, session, url, dead)
  }
}

async function current(port: number, session?: string): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
  try {
    return await readState(socket)
  } finally {
    socket.close()
  }
}

async function history(
  port: number,
  session: string | undefined,
  delta: -1 | 1,
): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
  try {
    await evaluate(socket, `history.go(${delta})`)
    await Bun.sleep(800)
    return await readState(socket).catch(() => shapeState(null))
  } finally {
    socket.close()
  }
}

async function reload(port: number, session?: string): Promise<PageState> {
  const { socket } = await resolvePage(port, session)
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
  arg?: string
} {
  const [verb = "", ...rest] = argv
  if (verb === "navigate" || verb === "newtab") {
    let url = ""
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index]
      if (arg === "--url") url = rest[index + 1] ?? ""
      else if (arg.startsWith("--url=")) url = arg.slice(6)
      else if (!arg.startsWith("--") && !url) url = arg
    }
    return { verb, url }
  }
  if (verb === "switch" || verb === "closetab") {
    const arg = rest.find((item) => !item.startsWith("--")) ?? ""
    return { verb, arg }
  }
  return { verb }
}

// One failure is often just a dead screen or browser; healing and retrying
// once inside the same call saves the agent a whole step. Healthy calls pay
// no heal cost at all — the wrappers no longer run it up front.
const UNREACHABLE =
  /unable to connect|not reachable|econnrefused|fetch failed|no page on this screen|cdp connection (timed out|failed)/i

function heal(session: string | undefined) {
  if (!session) return
  try {
    Bun.spawnSync(["/opt/open-bot/screen-heal.sh", session], {
      stdout: "ignore",
      stderr: "inherit",
    })
  } catch {}
}

export async function withHeal<T>(
  session: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!UNREACHABLE.test(message)) throw error
    heal(session)
    return run()
  }
}

async function main() {
  const port = Number(process.argv[2])
  const session = process.argv[3]
  const { verb, url, arg } = verbFrom(process.argv.slice(4))
  if (!Number.isInteger(port) || !verb) throw new Error(USAGE)
  let state: PageState | TabLine
  if (verb === "navigate")
    state = await withHeal(session, () => navigate(port, session, url ?? ""))
  else if (verb === "newtab")
    state = await withHeal(session, () => newTab(port, session, url ?? ""))
  else if (verb === "tabs")
    state = await withHeal(session, () => tabsLine(port, session))
  else if (verb === "switch") {
    if (!arg) throw new Error(USAGE)
    state = await withHeal(session, () => switchTab(port, session, arg))
  } else if (verb === "closetab")
    state = await withHeal(session, () => closeTab(port, session, arg ?? ""))
  else if (verb === "url")
    state = await withHeal(session, () => current(port, session))
  else if (verb === "back")
    state = await withHeal(session, () => history(port, session, -1))
  else if (verb === "forward")
    state = await withHeal(session, () => history(port, session, 1))
  else if (verb === "reload")
    state = await withHeal(session, () => reload(port, session))
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
