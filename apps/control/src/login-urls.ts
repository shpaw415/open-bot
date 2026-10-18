// Login URL extraction for provider sign-in sessions.
//
// `opencode auth login` prints authorize URLs into the login PTY. We scan the
// raw output (ANSI-stripped) so the dashboard can render a click-to-open
// button, and we validate pasted `localhost` callback URLs so the control
// plane can relay them to the callback server waiting inside the desktop
// container (the user's browser can never reach that loopback itself).

// ANSI escapes are built through RegExp so the control-character regex lint
// (which bans \x1b-style literals) stays quiet — a PTY stream is full of them.
const ESC = String.fromCharCode(27)
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g")
const OSC_RE = new RegExp(
  `${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)`,
  "g",
)
const CHARSET_RE = new RegExp(`${ESC}[()#].`, "g")
const ESC_RE = new RegExp(`${ESC}.`, "g")
// biome-ignore lint/complexity/useRegexLiterals: \u0000-range escapes are banned in regex literals
const C0_RE = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]",
  "g",
)
// stripAnsi already removed the control bytes, so this needs no C0 range.
const URL_RE = /https?:\/\/[^\s"'`<>\\^{|}]+/g
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

const MAX_URLS = 5
const MAX_URL_LEN = 2048
const BUFFER_CAP = 8000

export function stripAnsi(text: string) {
  return text
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(CHARSET_RE, "")
    .replace(ESC_RE, "")
    .replace(C0_RE, (c) => (c === "\n" || c === "\r" ? c : ""))
    .replace(/\r/g, "")
}

function trimUrl(url: string) {
  let out = url.replace(/[.,;:!?'"]+$/, "")
  while (out.endsWith(")") && !out.includes("(")) out = out.slice(0, -1)
  return out
}

export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const match of stripAnsi(text).matchAll(URL_RE)) {
    const url = trimUrl(match[0])
    if (url.length > 8 && url.length <= MAX_URL_LEN) out.push(url)
  }
  return out
}

export type LoginUrlScanner = {
  push(chunk: string | Uint8Array): string[]
  /** Rescan without the edge guard — emits URLs still sitting at the buffer
   * end after a quiet period (the URL was the last thing printed). */
  flush(): string[]
  urls(): string[]
}

export function createLoginUrlScanner(): LoginUrlScanner {
  const decoder = new TextDecoder()
  const seen = new Set<string>()
  const found: string[] = []
  let buffer = ""
  const scan = (edgeGuard: boolean, text: string): string[] => {
    buffer = (buffer + text).slice(-BUFFER_CAP)
    const cleaned = stripAnsi(buffer)
    const fresh: string[] = []
    for (const match of cleaned.matchAll(URL_RE)) {
      // A match ending exactly at the buffer edge may still be growing —
      // hold it back until more output arrives (or flush()).
      if (edgeGuard && match.index + match[0].length >= cleaned.length) continue
      const url = trimUrl(match[0])
      if (url.length > 8 && url.length <= MAX_URL_LEN && !seen.has(url)) {
        seen.add(url)
        found.push(url)
        fresh.push(url)
      }
    }
    return fresh
  }
  return {
    push(chunk) {
      if (typeof chunk === "string") return scan(true, chunk)
      return scan(true, decoder.decode(chunk, { stream: true }))
    },
    flush() {
      return scan(false, "")
    },
    urls() {
      return found.slice(-MAX_URLS)
    },
  }
}

// Filter for the open-button: loopback URLs printed in the TTY are the
// redirect target, not a page the user's browser can usefully open.
export function isLocalUrl(url: string) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

export type LocalCallback =
  | { ok: true; url: string }
  | { ok: false; error: string }

export function parseLocalCallbackUrl(raw: unknown): LocalCallback {
  const text = typeof raw === "string" ? raw.trim() : ""
  if (!text)
    return {
      ok: false,
      error: "paste the full callback URL from the browser address bar",
    }
  if (text.length > MAX_URL_LEN) return { ok: false, error: "URL too long" }
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return { ok: false, error: "not a valid URL" }
  }
  if (parsed.protocol !== "http:")
    return { ok: false, error: "callback must be an http://localhost URL" }
  if (!LOCAL_HOSTS.has(parsed.hostname))
    return {
      ok: false,
      error:
        "expected a localhost callback — copy the address-bar URL the provider redirected to",
    }
  if (!parsed.port) return { ok: false, error: "callback URL has no port" }
  if (!parsed.searchParams.get("code") && !parsed.searchParams.get("error"))
    return {
      ok: false,
      error: "URL has no code — copy the URL after finishing sign-in",
    }
  parsed.hostname = "127.0.0.1"
  parsed.hash = ""
  return { ok: true, url: parsed.toString() }
}
