import type { Db } from "@open-bot/db"
import { desktopExec, endpoint, opencodeExec } from "./docker"
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
  return "The user holds this screen. Do not click, type, or run ob-chrome, ob-nav, ob-page, or ob-vnc until they say they are done on the screen."
}

export function vncSystemLine(sessionId: string, port: number) {
  return [
    `This thread's screen id is ${sessionId}.`,
    `Drive it only with ob-chrome, ob-page, ob-nav, or ob-vnc --session ${sessionId}.`,
    "Do not call vncdo. Do not run xclip or xsel. Paste with ob-vnc paste. Do not pass a host or port.",
    "Do not use 5900, computer:5900, computer::5900, or $OPEN_BOT_VNC.",
    `A single colon is a display number. The vncdo address is ${vncHost(port)}, and ob-vnc already uses it.`,
    `Go to a page with ob-chrome --session ${sessionId} navigate URL — one cheap command that prints the page url, title, heading and text (navigate alone usually answers the question). It opens a fresh tab on a crashed page and brings the screen back if it died. newtab URL opens a second tab; tabs, switch N, and closetab N manage them. Check where you are with ob-chrome --session ${sessionId} url.`,
    `Read and act on the page with ob-page --session ${sessionId} (read, scroll, click, type). Reserve ob-nav --session ${sessionId} --goal for a real multi-step page goal; never for a single quote or heading (navigate already returns those), and it costs a decision-model run per step.`,
    `Capture with ob-vnc --session ${sessionId} capture ${capturePath(port)}. Add 2 when text is hard to read. That restores the screen. Clicks stay in live-screen pixels.`,
    "A relaunch opens a blank page: Chromium was restarted — navigate back with ob-chrome. Do not call the screen dark.",
    `Native apps: install with sudo apt-get and launch with ob-app --session ${sessionId}; a standalone Chrome window is ob-app launch chrome.`,
    "ob-vnc pixels are the last resort.",
    "Twenty fallback actions per task is the budget. Finish the task yourself; only after the budget, stop input and end with ![screen](open-bot://screen).",
    "If the page needs the user (a login you lack credentials for, a captcha, a choice only they can make), stop and end with ![screen](open-bot://screen). When the person gave you the username and password, sign in normally. A captcha is never solved, clicked, or bypassed — including I'm-not-a-robot checkboxes — not even when the person asks.",
    "If the user takes control, stop all input until they say they are done on the screen.",
    "The chat embeds this live screen. Do not click or type again until they say they are done on the screen.",
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

// Session ids with a turn in flight on this desktop's opencode server.
async function busySessions(userId: string, db: Db): Promise<string[]> {
  try {
    const desktop = db.desktop(userId)
    if (!desktop) return []
    const base = await endpoint(userId, "opencode", 4096)
    const response = await fetch(`${base}/session/status`, {
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return []
    const status = (await response.json()) as Record<string, { type?: string }>
    return Object.entries(status)
      .filter(([, row]) => row?.type && row.type !== "idle")
      .map(([id]) => id)
  } catch {
    return []
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
  let victims = screensToStop(alive, threadScreenCap())
  if (victims.length > 0) {
    // The CLI tools drive screens without bumping lastActiveAt, so a session
    // mid-turn can look like the least-recently-used one; never stop a screen
    // whose thread is busy, or the agent dies mid-task with "no screen".
    const busy = await busySessions(userId, db)
    victims = victims.filter((victim) => !busy.includes(victim))
  }
  for (const victim of victims) {
    await stopProcesses(userId, victim, false)
  }
  const busyDisplays = listed
    .filter((item) => !victims.includes(item.sessionId))
    .map((item) => item.display)
  const display = pickDisplay(busyDisplays, row?.display ?? null)
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
