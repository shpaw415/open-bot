const SCALE_MAX = 3
const WIDTH_MAX = 3840
const HEIGHT_MAX = 2400
const CALL_TIMEOUT_MS = 15_000

export function shotSize(raw: string): {
  width: number | null
  height: number | null
  scale: number
} {
  const text = raw.trim().toLowerCase()
  const scaled = /^([1-3])x?$/.exec(text)
  if (scaled) return { width: null, height: null, scale: Number(scaled[1]) }
  const match = /^([0-9]{3,4})x([0-9]{3,4})$/.exec(text)
  if (!match) throw new Error("resolution must be 2 or 2560x1600")
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 640 || height < 480 || width > WIDTH_MAX || height > HEIGHT_MAX) {
    throw new Error("resolution must be 2 or 2560x1600")
  }
  return { width, height, scale: 1 }
}

// PNG dimensions from the IHDR chunk (bytes 16-24, big-endian). The capture
// transform is derived from the bytes actually returned, never from what
// the CDP call was asked for: browser zoom / devicePixelRatio changes the
// real capture-to-viewport ratio, and printing the requested scale as the
// factor silently mis-mapped every pixel under zoom.
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  )
    return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) return null
  return { width, height }
}

export type CaptureTransform = {
  // Capture pixels per viewport CSS pixel, measured from the PNG bytes.
  factor: number
  yFactor: number
  // Browser window viewport origin in live screen (device) pixels.
  ox: number
  oy: number
  // window.devicePixelRatio at capture time (page zoom x display scale).
  dpr: number
}

// image = css * factor; live screen px = offset + css * dpr. The offset the
// page reports (screenX & friends) is in CSS pixels, so it scales by dpr
// before it can shift a live-screen click.
export function captureTransform(input: {
  pngWidth: number
  pngHeight: number
  cssWidth: number
  cssHeight: number
  dpr: number
  oxCss: number
  oyCss: number
}): CaptureTransform {
  const dpr = input.dpr > 0 && Number.isFinite(input.dpr) ? input.dpr : 1
  return {
    factor: input.pngWidth / input.cssWidth,
    yFactor: input.pngHeight / input.cssHeight,
    ox: Math.round(input.oxCss * dpr),
    oy: Math.round(input.oyCss * dpr),
    dpr,
  }
}

type Socket = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

function openSocket(url: string) {
  const ws = new WebSocket(url)
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let next = 0
  const failAll = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      result?: unknown
      error?: { message?: string }
    }
    if (!message.id || !pending.has(message.id)) return
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (!waiter) return
    if (message.error) {
      waiter.reject(new Error(message.error.message || "cdp failed"))
      return
    }
    waiter.resolve(message.result)
  }
  ws.onclose = () => failAll(new Error("cdp connection closed"))
  return new Promise<Socket>((resolve, reject) => {
    ws.onopen = () =>
      resolve({
        call(method, params) {
          const id = ++next
          return new Promise((done, fail) => {
            // A hung call must not hang the capture: the metrics-override
            // cleanup in the finally block only runs if calls settle.
            const timer = setTimeout(() => {
              pending.delete(id)
              fail(new Error(`cdp call timed out: ${method}`))
            }, CALL_TIMEOUT_MS)
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer)
                done(value)
              },
              reject: (error) => {
                clearTimeout(timer)
                fail(error)
              },
            })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        },
      })
    ws.onerror = () => reject(new Error("cdp connection failed"))
  })
}

async function pageSocket(port: number) {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.json(),
  )) as { type?: string; webSocketDebuggerUrl?: string }[]
  const page = list.find(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  )
  if (!page?.webSocketDebuggerUrl) throw new Error("no page on this screen")
  return openSocket(page.webSocketDebuggerUrl)
}

function layout(metrics: unknown) {
  const row = metrics as {
    cssLayoutViewport?: { clientWidth?: number; clientHeight?: number }
  }
  const width = row.cssLayoutViewport?.clientWidth
  const height = row.cssLayoutViewport?.clientHeight
  if (!width || !height) throw new Error("no page size")
  return { width: Math.round(width), height: Math.round(height) }
}

function ratioText(value: number): string {
  return String(Math.round(value * 100) / 100)
}

async function evaluateValue(
  socket: Socket,
  expression: string,
): Promise<unknown> {
  const result = (await socket.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown } }
  return result.result?.value
}

// Two rAF ticks arriving on schedule prove the renderer is still painting;
// a capture byte-identical to the previous one while rAF runs is the frozen
// compositor signature (stale surface, live page).
async function pageAnimating(socket: Socket): Promise<boolean> {
  const elapsed = await evaluateValue(
    socket,
    "new Promise((resolve) => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0))) })",
  ).catch(() => null)
  return typeof elapsed === "number" && elapsed > 0 && elapsed < 2_000
}

async function main() {
  const port = Number(process.argv[2])
  const file = process.argv[3]
  const spec = shotSize(process.argv[4] ?? "")
  if (!file || !Number.isInteger(port))
    throw new Error("usage: xshot.ts PORT FILE RESOLUTION")
  const socket = await pageSocket(port)
  const statePath = `/home/agent/.open-bot/capture-${port}.json`
  let previousHash = ""
  try {
    const previous = JSON.parse(await Bun.file(statePath).text()) as {
      hash?: unknown
    }
    if (typeof previous.hash === "string") previousHash = previous.hash
  } catch {
    previousHash = ""
  }
  let oxCss = 0
  let oyCss = 0
  let dpr = 1
  let origin = true
  try {
    const value = (await evaluateValue(
      socket,
      "({x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2), y: Math.round(window.screenY + (window.outerHeight - window.innerHeight)), dpr: window.devicePixelRatio || 1})",
    )) as { x?: number; y?: number; dpr?: number } | undefined
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      oxCss = Math.round(value.x ?? 0)
      oyCss = Math.round(value.y ?? 0)
      if (
        typeof value.dpr === "number" &&
        Number.isFinite(value.dpr) &&
        value.dpr > 0
      )
        dpr = value.dpr
    } else {
      origin = false
    }
  } catch {
    origin = false
  }
  // Only an explicit WxH request resizes the viewport (metrics override);
  // a plain scaled capture uses the screenshot clip scale instead. The
  // override churn (set DSF -> shoot -> clear) could leave the window's
  // compositor surface frozen on a stale frame while the page kept
  // rendering — every later capture then showed old pixels.
  const resized = spec.width !== null && spec.height !== null
  let overrideLive = false
  try {
    await socket.call("Page.enable")
    const current = layout(await socket.call("Page.getLayoutMetrics"))
    const scale = spec.scale
    if (scale < 1 || scale > SCALE_MAX)
      throw new Error("resolution must be 2 or 2560x1600")
    const cssWidth = spec.width ?? current.width
    const cssHeight = spec.height ?? current.height
    if (resized) {
      await socket.call("Emulation.setDeviceMetricsOverride", {
        width: cssWidth,
        height: cssHeight,
        deviceScaleFactor: 1,
        mobile: false,
      })
      overrideLive = true
      await Bun.sleep(300)
    }
    const shotParams: Record<string, unknown> = {
      format: "png",
      fromSurface: true,
    }
    if (!resized) {
      shotParams.clip = {
        x: 0,
        y: 0,
        width: cssWidth,
        height: cssHeight,
        scale,
      }
    }
    const shot = (await socket.call("Page.captureScreenshot", shotParams)) as {
      data?: string
    }
    if (!shot.data) throw new Error("empty screenshot")
    const bytes = Buffer.from(shot.data, "base64")
    await Bun.write(file, bytes)
    const png = pngSize(bytes) ?? {
      width: cssWidth * scale,
      height: cssHeight * scale,
    }
    const transform = captureTransform({
      pngWidth: png.width,
      pngHeight: png.height,
      cssWidth,
      cssHeight,
      dpr,
      oxCss,
      oyCss,
    })
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
    await Bun.write(
      statePath,
      `${JSON.stringify({ ...transform, ts: Date.now(), origin, hash })}\n`,
    )
    const offsetText = origin
      ? `offset ${transform.ox},${transform.oy}`
      : "offset unknown"
    const factorText =
      Math.abs(transform.factor - transform.yFactor) < 0.01
        ? ratioText(transform.factor)
        : `x${ratioText(transform.factor)} y${ratioText(transform.yFactor)}`
    console.log(
      `capture ${png.width}x${png.height} live ${cssWidth}x${cssHeight} factor ${factorText} ${offsetText} dpr ${ratioText(transform.dpr)}`,
    )
    if (Math.abs(transform.dpr - 1) > 0.01)
      console.error(
        `note: browser zoom is ~${ratioText(transform.dpr)}x (dpr ${ratioText(transform.dpr)}): viewport CSS px are not live screen px. live = offset + css*${ratioText(transform.dpr)}; image = css*${ratioText(transform.factor)}. Convert with ob-vnc map / hit-image instead of assuming 1:1.`,
      )
    if (resized)
      console.error(
        "note: this capture resized the page viewport for the shot and restored it after; if you are measuring on-page FPS, capture again after waiting ~15 seconds",
      )
    if (previousHash && previousHash === hash) {
      if (await pageAnimating(socket))
        console.error(
          "warning: this capture is byte-identical to the previous one while the page is still animating (requestAnimationFrame is alive) — the screen compositor may be showing a stale frame. Do not trust these pixels: cross-check with ob-chrome eval / ob-page read, and if captures stay identical reload the tab (ob-chrome reload) or open a new tab.",
        )
      else
        console.error(
          "note: this capture is byte-identical to the previous capture on this screen",
        )
    }
  } finally {
    if (overrideLive) {
      // Never swallow a failed clear: a leftover override freezes the
      // viewport size and can strand the compositor on a stale surface.
      const cleared = await socket
        .call("Emulation.clearDeviceMetricsOverride")
        .then(() => true)
        .catch(() =>
          socket
            .call("Emulation.clearDeviceMetricsOverride")
            .then(() => true)
            .catch(() => false),
        )
      if (!cleared)
        console.error(
          "warning: could not clear the capture viewport override — the page viewport may stay resized; reload the tab (ob-chrome reload) if the layout looks wrong",
        )
      else await socket.call("Page.bringToFront").catch(() => undefined)
    }
    socket.close()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "screenshot failed")
    process.exit(1)
  })
}
