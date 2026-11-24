import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { Snapshot } from "./action-space"
import {
  actionScript,
  connectCdpSocket,
  evaluate,
  evaluateObjectId,
  normalize,
  obnavFindExpr,
  PROBE,
  readActiveTabId,
} from "./cdp"
import { withHeal } from "./chrome"
import { sweepZombies } from "./tab-sweep"

type Metrics = {
  width: number
  height: number
  scrollY: number
  scrollHeight: number
}

export type PageView = {
  url: string
  title: string
  text: string
  viewport: { width: number; height: number }
  scrollY: number
  pageHeight: number
  canScrollDown: boolean
  canScrollUp: boolean
  elementsTruncated: boolean
  elements: {
    id: string
    role: string
    label: string
    value: string
    editable: boolean
    sensitive?: boolean
    options?: string[]
  }[]
}

export function shapeView(probe: Snapshot, metrics: Metrics): PageView {
  return {
    url: probe.url,
    title: probe.title,
    // Body text rides along so a read answers text questions without a
    // second tool (or a pixel detour).
    text: probe.text,
    viewport: { width: metrics.width, height: metrics.height },
    scrollY: metrics.scrollY,
    pageHeight: metrics.scrollHeight,
    canScrollDown: probe.canScrollDown,
    canScrollUp: probe.canScrollUp,
    elementsTruncated: probe.elementsTruncated === true,
    elements: probe.elements.map((item) => ({
      id: item.targetId,
      role: item.role,
      label: item.label,
      value: item.value,
      editable: item.editable,
      sensitive: item.sensitive === true,
      options: item.options?.map((option) => option.label),
    })),
  }
}

// The probe carries the viewport metrics so a read is a single CDP round trip.
function metricsFromProbe(raw: unknown): Metrics {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    width: Number(row.viewport_w ?? 0),
    height: Number(row.viewport_h ?? 0),
    scrollY: Number(row.scroll_y ?? 0),
    scrollHeight: Number(row.scroll_height ?? 0),
  }
}

async function view(socket: Parameters<typeof evaluate>[0]) {
  // The page world returns snake_case (target_id, can_scroll_down); without
  // normalize() every id and scroll flag would read as undefined.
  const raw = await evaluate(socket, PROBE)
  return shapeView(normalize(raw), metricsFromProbe(raw))
}

export function uploadPathsError(paths: string[]): string | null {
  if (paths.length === 0) return "upload needs at least one file path"
  for (const path of paths) {
    if (!path.startsWith("/home/agent/") || path.split("/").includes(".."))
      return `upload path must be a file under /home/agent: ${path}`
  }
  return null
}

const USAGE =
  "usage: page.ts PORT SESSION read | scroll down|up [pages] | click ID | type ID TEXT | type-secret ID --origin ORIGIN (secret on stdin) | upload ID PATH [PATH...]"

const SECRET_INPUT_MAX_BYTES = 1024

export function parseTypeSecretArgs(tail: string[]): {
  id: string
  origin: string
} {
  const [id, flag, origin, extra] = tail
  if (!id || flag !== "--origin" || !origin || extra !== undefined)
    throw new Error(USAGE)
  return { id, origin }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "localhost" || host === "::1" || host.startsWith("127.")
}

function parseOrigin(raw: string, defaultHttps = false): URL | null {
  try {
    return new URL(
      defaultHttps && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
        ? `https://${raw}`
        : raw,
    )
  } catch {
    return null
  }
}

/**
 * The exact-origin gate for secret input. The expected value comes from the
 * operator/agent before any secret is read; the actual value is the current
 * page URL. No secret belongs in either string, so naming both origins in
 * an error is safe and makes a wrong-tab refusal diagnosable.
 */
export function secretOriginError(
  expectedRaw: string,
  currentUrl: string,
): string | null {
  const expected = parseOrigin(expectedRaw, true)
  const actual = parseOrigin(currentUrl)
  if (!expected || !actual)
    return "secret input needs a valid expected and current origin"
  const secure = (url: URL) =>
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))
  if (!secure(expected) || !secure(actual))
    return "secret input requires https (http is allowed only on loopback)"
  if (expected.origin !== actual.origin)
    return `origin mismatch: expected ${expected.origin}, current page is ${actual.origin}`
  return null
}

/**
 * Reads exactly one secret from stdin. Only the one terminating newline a
 * producer command normally emits is removed; all other whitespace belongs
 * to the secret. Errors are deliberately content-free.
 */
export async function readSecretInput(
  chunks: AsyncIterable<Uint8Array | string>,
): Promise<string> {
  const parts: Uint8Array[] = []
  let total = 0
  const encoder = new TextEncoder()
  for await (const chunk of chunks) {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk
    total += bytes.byteLength
    if (total > SECRET_INPUT_MAX_BYTES)
      throw new Error("secret input is too long")
    parts.push(bytes)
  }
  let value: string
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(parts),
    )
  } catch {
    throw new Error("secret input is not valid UTF-8")
  }
  value = value.replace(/\r?\n$/, "")
  if (!value) throw new Error("no secret received on stdin")
  if (value.length > SECRET_INPUT_MAX_BYTES)
    throw new Error("secret input is too long")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
    throw new Error("secret input contains control characters")
  return value
}

// `upload ID PATH...` — set files on an <input type=file> through CDP
// (DOM.setFileInputFiles) instead of driving the native GTK chooser with
// keystrokes, which loses focus to the browser window and can send the
// path into the address bar (#82). Args are the argv tail after `upload`.
export function parseUploadArgs(tail: string[]): {
  id: string
  files: string[]
} {
  const [id, ...files] = tail
  if (!id || files.length === 0) throw new Error(USAGE)
  return { id, files }
}

// A wedged renderer (the OOM "Aw Snap" class) fails every evaluate with a
// timeout; the browser itself is fine. One sweep closes the zombie targets,
// and the original call retries against a live tab — but only when the
// sweep actually closed something, so a broken page never costs double.
const ZOMBIE =
  /cdp call timed out|target detached|cannot find context|navigated or closed|cdp connection closed|probe timed out/i

async function withSweep<T>(port: number, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!ZOMBIE.test(message)) throw error
    const swept = await sweepZombies(port).catch(() => null)
    if (!swept || swept.closed.length === 0) throw error
    return run()
  }
}

// Sets `files` on the file input stamped `id` and verifies by reading the
// input back. CDP needs absolute paths in the browser's filesystem (the
// same container), and DOM.setFileInputFiles fires the input/change
// events pages listen for — no synthetic events of our own.
async function upload(
  socket: Parameters<typeof evaluate>[0],
  id: string,
  files: string[],
) {
  const absolute = files.map((file) => resolve(file))
  for (const file of absolute) {
    if (!existsSync(file)) throw new Error(`upload: no such file: ${file}`)
  }
  const find = obnavFindExpr(JSON.stringify(id))
  const kind = await evaluate(
    socket,
    `(() => { const el = ${find}; return el ? String(el.tagName || "") + ":" + String(el.type || "") : "" })()`,
  )
  if (kind === "")
    throw new Error(
      `no element ${id} on this page — run ob-page read for fresh ids (the page reloaded or the active tab changed)`,
    )
  if (kind !== "INPUT:file")
    throw new Error(
      `element ${id} is not a file input (${String(kind).toLowerCase()}) — upload needs the <input type=file> id from ob-page read`,
    )
  const evaluated = (await socket.call("Runtime.evaluate", {
    expression: find,
    returnByValue: false,
  })) as { result?: { objectId?: string } }
  const objectId = evaluated.result?.objectId
  if (!objectId) throw new Error(`upload: could not resolve element ${id}`)
  await socket.call("DOM.enable")
  await socket.call("DOM.setFileInputFiles", { objectId, files: absolute })
  const names = await evaluate(
    socket,
    `(() => { const el = ${find}; return el && el.files ? Array.from(el.files, (f) => f.name) : [] })()`,
  )
  const landed = Array.isArray(names) ? names.map(String) : []
  if (landed.length !== absolute.length)
    throw new Error(
      `upload set ${landed.length} of ${absolute.length} files on ${id} — the input may not accept multiple files`,
    )
  return { uploaded: id, files: landed }
}

async function run(session: string | undefined) {
  const port = Number(process.argv[2])
  const verb = process.argv[4] ?? ""
  if (!Number.isInteger(port) || !verb) throw new Error(USAGE)
  // Follow the tab the agent last touched (navigate/newtab/switch record it).
  const activeId = readActiveTabId(session)
  await withHeal(session, () =>
    withSweep(port, async () => {
      const socket = await connectCdpSocket(port, activeId)
      try {
        if (verb === "read") {
          console.log(JSON.stringify(await view(socket)))
          return
        }
        if (verb === "scroll") {
          const direction = process.argv[5] === "up" ? "up" : "down"
          const pages = Math.min(
            Math.max(Number(process.argv[6] ?? 1) || 1, 1),
            10,
          )
          for (let index = 0; index < pages; index += 1) {
            await evaluate(socket, actionScript({ kind: "scroll", direction }))
            await Bun.sleep(80)
          }
          const viewAfter = await view(socket)
          console.log(
            JSON.stringify({
              scrolled: pages,
              scrollY: viewAfter.scrollY,
              pageHeight: viewAfter.pageHeight,
              canScrollDown: viewAfter.canScrollDown,
              canScrollUp: viewAfter.canScrollUp,
            }),
          )
          return
        }
        if (verb === "type-secret") {
          const { id, origin } = parseTypeSecretArgs(process.argv.slice(5))
          let secret = ""
          try {
            if (process.stdin.isTTY)
              throw new Error(
                "pipe the secret on stdin; interactive input is refused",
              )
            secret = await readSecretInput(Bun.stdin.stream())
            const current = await view(socket)
            const originError = secretOriginError(origin, current.url)
            if (originError) throw new Error(originError)
            const element = current.elements.find((item) => item.id === id)
            if (!element)
              throw new Error(
                `no element ${id} on this page — run ob-page read for fresh ids (the page reloaded or the active tab changed)`,
              )
            const secretField =
              element.sensitive ||
              /password|mot de passe|one[- ]time|verification|authenticator|security code|login code|\bOTP\b|\b2FA\b|\bMFA\b/i.test(
                `${element.role} ${element.label}`,
              )
            if (!element.editable || !secretField)
              throw new Error(
                `element ${id} is not a credential field — type-secret only fills password or one-time-code fields; use type for ordinary text`,
              )
            const find = obnavFindExpr(JSON.stringify(id))
            const focusedUrl = await evaluate(
              socket,
              `(() => {
                const el = ${find}
                if (!el) return "missing"
                if (!('value' in el)) return "unsupported"
                el.focus()
                try {
                  if (typeof el.select === "function") el.select()
                  else if (typeof el.setSelectionRange === "function")
                    el.setSelectionRange(0, String(el.value ?? "").length)
                } catch {}
                return location.href
              })()`,
            )
            if (focusedUrl === "missing")
              throw new Error(
                `no element ${id} on this page — run ob-page read for fresh ids (the page reloaded or the active tab changed)`,
              )
            if (focusedUrl === "unsupported")
              throw new Error(
                `element ${id} has no value-bearing input — type-secret does not support this custom control`,
              )
            const focusedOriginError = secretOriginError(
              origin,
              String(focusedUrl),
            )
            if (focusedOriginError) throw new Error(focusedOriginError)
            await socket.call("Input.insertText", { text: secret })
            const filled = await evaluate(
              socket,
              `(() => {
                const el = ${find}
                return el && 'value' in el ? String(el.value ?? "").length > 0 : null
              })()`,
            ).catch(() => null)
            if (filled === false)
              throw new Error("secret input did not land in the field")
            const verifiedOrigin = parseOrigin(origin, true)?.origin
            console.log(
              JSON.stringify({
                typedSecret: true,
                id,
                sensitive: true,
                origin: verifiedOrigin,
                verified: filled === true,
              }),
            )
          } catch (error) {
            const raw =
              error instanceof Error ? error.message : "type-secret failed"
            // Fail closed on diagnostics: a lower layer must never turn
            // the piped value into an error string that reaches a transcript.
            throw new Error(
              secret && raw.includes(secret)
                ? "type-secret failed (details redacted)"
                : raw,
            )
          } finally {
            secret = ""
          }
          return
        }
        if (verb === "upload") {
          // DOM-level file assignment (#82): typing a path into the GTK
          // chooser can land in the browser address bar when the chooser
          // loses focus; assigning files to the input by protocol never
          // touches native windows at all.
          const id = process.argv[5] ?? ""
          const paths = process.argv.slice(6)
          if (!id) throw new Error(USAGE)
          const bad = uploadPathsError(paths)
          if (bad) throw new Error(bad)
          const objectId = await evaluateObjectId(
            socket,
            obnavFindExpr(JSON.stringify(id)),
          )
          if (!objectId)
            throw new Error(
              `no element ${id} on this page — run ob-page read for fresh ids (the page reloaded or the active tab changed)`,
            )
          const isFile = await evaluate(
            socket,
            `(() => { const el = ${obnavFindExpr(JSON.stringify(id))}; return !!el && el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file' })()`,
          ).catch(() => false)
          if (!isFile) throw new Error(`${id} is not a file input on this page`)
          await socket.call("DOM.enable").catch(() => undefined)
          await socket.call("DOM.setFileInputFiles", {
            files: paths,
            objectId,
          })
          await Bun.sleep(200)
          console.log(JSON.stringify(await view(socket)))
          return
        }
        if (verb === "click" || verb === "type") {
          const id = process.argv[5] ?? ""
          if (!id) throw new Error(USAGE)
          const action =
            verb === "click"
              ? { kind: "click" as const, targetId: id }
              : {
                  kind: "type" as const,
                  targetId: id,
                  text: process.argv[6] ?? "",
                }
          if (verb === "type" && !action.text) throw new Error(USAGE)
          const ok = await evaluate(socket, actionScript(action))
          // false is not-found, not occlusion: a stale data-obnav id (the page
          // reloaded or the active tab changed) must not read as "target
          // covered" — the agent would retry clicks instead of re-reading ids.
          if (ok === false)
            throw new Error(
              `no element ${id} on this page — run ob-page read for fresh ids (the page reloaded or the active tab changed)`,
            )
          if (typeof ok === "string" && ok.startsWith("covered:"))
            throw new Error(`target ${ok.replace("covered:", "covered by ")}`)
          if (typeof ok === "string" && ok.startsWith("unverified:"))
            throw new Error(
              `${verb} on ${id} was not verified (${ok.slice("unverified:".length)}): no observable page change followed it. It may need a real pointer/keyboard event — retry with ob-vnc, or re-read the page to check its state.`,
            )
          await Bun.sleep(verb === "type" ? 200 : 80)
          // A click that navigates tears the execution context down while the
          // post-action read runs; the click still worked. Settle, then re-read
          // on a fresh connection instead of reporting a page error.
          try {
            console.log(JSON.stringify(await view(socket)))
          } catch {
            await Bun.sleep(900)
            const fresh = await connectCdpSocket(port, activeId)
            try {
              console.log(JSON.stringify(await view(fresh)))
            } finally {
              fresh.close()
            }
          }
          return
        }
        if (verb === "upload") {
          const { id, files } = parseUploadArgs(process.argv.slice(5))
          console.log(JSON.stringify(await upload(socket, id, files)))
          return
        }
        throw new Error(USAGE)
      } finally {
        socket.close()
      }
    }),
  )
}

async function main() {
  await run(process.argv[3])
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const raw = error instanceof Error ? error.message : "page failed"
    const message = /unable to connect|econnrefused|fetch failed/i.test(raw)
      ? "chrome is not reachable on this screen"
      : raw
    console.error(message)
    process.exit(1)
  })
}
