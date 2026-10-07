import type { Db } from "@open-bot/db"
import { desktopExec, opencodeExec } from "./docker"
import { maxThreadScreens } from "./env"
import { HttpError } from "./http-error"

export const DISPLAY_MIN = 2
export const DISPLAY_MAX = 9

const chains = new Map<string, Promise<unknown>>()
const inflight = new Map<string, Promise<ThreadScreenView>>()

export type ThreadScreenView = {
  sessionId: string
  display: number
  rfbPort: number
  host: string
  path: string
  system: string
}

export type AliveScreen = {
  sessionId: string
  display: number
}

export function screenSessionId(id: string): string | null {
  const trimmed = id.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return null
  return trimmed
}

export function rfbPortFor(display: number) {
  return 5900 + display
}

export function vncHost(port: number) {
  return `computer::${port}`
}

export function capturePath(port: number) {
  return `/tmp/open-bot-${port}.png`
}

export function holdSystemLine() {
  return "The user holds this screen. Do not click, type, or run ob-nav or ob-vnc until they say they are done on the screen."
}

export function vncSystemLine(sessionId: string, port: number) {
  return [
    `This thread's screen id is ${sessionId}.`,
    `Drive it only with ob-vnc --session ${sessionId}.`,
    "Do not call vncdo. Do not run xclip or xsel. Paste with ob-vnc paste. Do not pass a host or port.",
    "Do not use 5900, computer:5900, computer::5900, or $OPEN_BOT_VNC.",
    `A single colon is a display number. The vncdo address is ${vncHost(port)}, and ob-vnc already uses it.`,
    `Capture with ob-vnc --session ${sessionId} capture ${capturePath(port)}. Add 2 when text is hard to read. That restores the screen. Clicks stay in live-screen pixels.`,
    `For a page goal, run ob-nav --session ${sessionId} --goal "..." before clicking.`,
    "The screen relaunches Chromium on this thread's last page on its own. A blank or black page only means Chromium was closed or is loading: run ob-nav to the page. Do not call the screen dark.",
    "If ob-nav is unconfigured, blocked, low_confidence, or errors, use ob-vnc.",
    "Twenty ob-vnc actions per task is the budget. Finish the task yourself; only after the budget, stop input and end with ![screen](open-bot://screen).",
    "If ob-nav needs the user, stop and end with ![screen](open-bot://screen).",
    "If the user must act on this screen, stop all input and end the reply with ![screen](open-bot://screen).",
    "The chat embeds this live screen. Do not click or type again until they say they are done on the screen.",
    "If the user takes control, stop all input until they say they are done on the screen.",
  ].join(" ")
}

export function holdFile(sessionId: string) {
  return `/home/agent/.open-bot/vnc/${sessionId}.hold`
}

export function vncViewPath(sessionId: string) {
  return `desktop/view/websockify?token=${sessionId}`
}

export function threadScreenCap(raw = maxThreadScreens) {
  if (!Number.isFinite(raw) || raw < 1) return 1
  const slots = DISPLAY_MAX - DISPLAY_MIN + 1
  return Math.min(slots, Math.floor(raw))
}

export function parseScreenList(text: string): AliveScreen[] {
  const out: AliveScreen[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [sessionId, displayRaw] = trimmed.split(/\s+/)
    const display = Number(displayRaw)
    if (!sessionId || !screenSessionId(sessionId)) continue
    if (
      !Number.isInteger(display) ||
      display < DISPLAY_MIN ||
      display > DISPLAY_MAX
    ) {
      continue
    }
    out.push({ sessionId, display })
  }
  return out
}

export function screensToStop(
  alive: { sessionId: string; lastActiveAt: number }[],
  cap: number,
): string[] {
  if (alive.length < cap) return []
  const sorted = [...alive].sort(
    (a, b) =>
      a.lastActiveAt - b.lastActiveAt || a.sessionId.localeCompare(b.sessionId),
  )
  return sorted.slice(0, alive.length - cap + 1).map((row) => row.sessionId)
}

export function pickDisplay(
  aliveDisplays: number[],
  preferred: number | null,
): number | null {
  if (
    preferred !== null &&
    preferred >= DISPLAY_MIN &&
    preferred <= DISPLAY_MAX &&
    !aliveDisplays.includes(preferred)
  ) {
    return preferred
  }
  for (let display = DISPLAY_MIN; display <= DISPLAY_MAX; display++) {
    if (!aliveDisplays.includes(display)) return display
  }
  return null
}

function view(sessionId: string, display: number): ThreadScreenView {
  const port = rfbPortFor(display)
  return {
    sessionId,
    display,
    rfbPort: port,
    host: vncHost(port),
    path: vncViewPath(sessionId),
    system: vncSystemLine(sessionId, port),
  }
}

function lockUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(userId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  chains.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

async function runScript(
  userId: string,
  role: "opencode" | "computer",
  script: string,
  args: string[],
) {
  const result = await desktopExec(userId, role, [script, ...args])
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new HttpError(
        503,
        "Desktop image is missing per-thread screens. Rebuild images, then sleep and start the desktop.",
        "screen_image",
      )
    }
    throw new HttpError(
      502,
      detail || "could not start the thread screen",
      "screen_failed",
    )
  }
  return result.stdout
}

async function stopProcesses(
  userId: string,
  sessionId: string,
  purge: boolean,
) {
  const downArgs = purge ? [sessionId, "--purge"] : [sessionId]
  await runScript(userId, "opencode", "/opt/open-bot/screen-down.sh", downArgs)
  await runScript(userId, "computer", "/opt/open-bot/vnc-down.sh", [sessionId])
}

async function ensureInner(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<ThreadScreenView> {
  const listed = parseScreenList(
    await runScript(userId, "opencode", "/opt/open-bot/screen-list.sh", []),
  )
  const row = db.threadScreen(userId, sessionId)
  const current = listed.find((item) => item.sessionId === sessionId)
  if (current) {
    const port = rfbPortFor(current.display)
    await runScript(userId, "opencode", "/opt/open-bot/screen-up.sh", [
      sessionId,
      String(current.display),
    ])
    await runScript(userId, "computer", "/opt/open-bot/vnc-up.sh", [
      sessionId,
      String(current.display),
      String(port),
    ])
    db.upsertThreadScreen({
      userId,
      sessionId,
      display: current.display,
      rfbPort: port,
      lastActiveAt: Date.now(),
    })
    return view(sessionId, current.display)
  }

  const stored = db.threadScreens(userId)
  const alive = listed.map((item) => ({
    sessionId: item.sessionId,
    lastActiveAt:
      stored.find((saved) => saved.sessionId === item.sessionId)
        ?.lastActiveAt ?? 0,
  }))
  const victims = screensToStop(alive, threadScreenCap())
  for (const victim of victims) {
    await stopProcesses(userId, victim, false)
  }
  const busy = listed
    .filter((item) => !victims.includes(item.sessionId))
    .map((item) => item.display)
  const display = pickDisplay(busy, row?.display ?? null)
  if (display === null) {
    throw new HttpError(
      429,
      "Too many thread screens are running.",
      "screen_capacity",
    )
  }
  const port = rfbPortFor(display)
  await runScript(userId, "opencode", "/opt/open-bot/screen-up.sh", [
    sessionId,
    String(display),
  ])
  await runScript(userId, "computer", "/opt/open-bot/vnc-up.sh", [
    sessionId,
    String(display),
    String(port),
  ])
  db.upsertThreadScreen({
    userId,
    sessionId,
    display,
    rfbPort: port,
    lastActiveAt: Date.now(),
  })
  return view(sessionId, display)
}

export async function screenHeld(userId: string, sessionId: string) {
  const id = screenSessionId(sessionId)
  if (!id) return false
  try {
    const result = await opencodeExec(userId, ["test", "-f", holdFile(id)])
    return result.code === 0
  } catch {
    return false
  }
}

export async function setScreenHold(
  userId: string,
  sessionId: string,
  held: boolean,
) {
  const id = screenSessionId(sessionId)
  if (!id) throw new HttpError(400, "invalid thread id", "bad_session")
  const file = holdFile(id)
  const result = await opencodeExec(
    userId,
    held
      ? [
          "sh",
          "-c",
          'mkdir -p /home/agent/.open-bot/vnc && : > "$1"',
          "sh",
          file,
        ]
      : ["rm", "-f", file],
  )
  if (result.code !== 0) {
    throw new HttpError(
      502,
      result.stderr.trim() || "could not update screen control",
      "screen_hold",
    )
  }
}

export function ensureThreadScreen(db: Db, userId: string, sessionId: string) {
  const id = screenSessionId(sessionId)
  if (!id) throw new HttpError(400, "invalid thread id", "bad_session")
  const key = `${userId}\0${id}`
  const existing = inflight.get(key)
  if (existing) return existing
  const job = lockUser(userId, () => ensureInner(db, userId, id)).finally(
    () => {
      inflight.delete(key)
    },
  )
  inflight.set(key, job)
  return job
}

export function stopThreadScreen(
  db: Db,
  userId: string,
  sessionId: string,
  purge = true,
) {
  const id = screenSessionId(sessionId)
  if (!id) return Promise.resolve()
  return lockUser(userId, async () => {
    try {
      await stopProcesses(userId, id, purge)
    } catch {
      // desktop may be asleep, or the image has not been rebuilt yet
    }
    db.clearThreadScreen(userId, id)
  })
}

export async function resolveRootSession(
  base: string,
  auth: HeadersInit,
  sessionId: string,
) {
  let current = screenSessionId(sessionId)
  if (!current) throw new HttpError(400, "invalid thread id", "bad_session")
  for (let depth = 0; depth < 4; depth++) {
    const res = await fetch(`${base}/session/${encodeURIComponent(current)}`, {
      headers: auth,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new HttpError(404, "thread not found", "thread_missing")
    const body = (await res.json().catch(() => null)) as {
      parentID?: unknown
    } | null
    const parent =
      typeof body?.parentID === "string" ? screenSessionId(body.parentID) : null
    if (!parent || parent === current) return current
    current = parent
  }
  return current
}
