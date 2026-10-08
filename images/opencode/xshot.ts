const SCALE_MAX = 3
const WIDTH_MAX = 3840
const HEIGHT_MAX = 2400

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
  return new Promise<Socket>((resolve, reject) => {
    ws.onopen = () =>
      resolve({
        call(method, params) {
          const id = ++next
          return new Promise((done, fail) => {
            pending.set(id, { resolve: done, reject: fail })
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

async function main() {
  const port = Number(process.argv[2])
  const file = process.argv[3]
  const spec = shotSize(process.argv[4] ?? "")
  if (!file || !Number.isInteger(port))
    throw new Error("usage: xshot.ts PORT FILE RESOLUTION")
  const socket = await pageSocket(port)
  let ox = 0
  let oy = 0
  let origin = true
  try {
    const probe = (await socket.call("Runtime.evaluate", {
      expression:
        "({x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2), y: Math.round(window.screenY + (window.outerHeight - window.innerHeight))})",
      returnByValue: true,
    })) as { result?: { value?: { x?: number; y?: number } } }
    const value = probe.result?.value
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      ox = Math.round(value.x)
      oy = Math.round(value.y)
    } else {
      origin = false
    }
  } catch {
    origin = false
  }
  try {
    await socket.call("Page.enable")
    const current = layout(await socket.call("Page.getLayoutMetrics"))
    const scale = spec.scale
    const width = spec.width ?? current.width
    const height = spec.height ?? current.height
    if (scale < 1 || scale > SCALE_MAX)
      throw new Error("resolution must be 2 or 2560x1600")
    await socket.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    })
    await Bun.sleep(300)
    const shot = (await socket.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    })) as { data?: string }
    if (!shot.data) throw new Error("empty screenshot")
    await Bun.write(file, Buffer.from(shot.data, "base64"))
    const statePath = `/home/agent/.open-bot/capture-${port}.json`
    await Bun.write(
      statePath,
      `${JSON.stringify({ factor: scale, ox, oy, ts: Date.now(), origin })}\n`,
    )
    const offsetText = origin ? `offset ${ox},${oy}` : "offset unknown"
    console.log(
      `capture ${width * scale}x${height * scale} live ${current.width}x${current.height} factor ${scale} ${offsetText}`,
    )
  } finally {
    await socket
      .call("Emulation.clearDeviceMetricsOverride")
      .catch(() => undefined)
    socket.close()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "screenshot failed")
    process.exit(1)
  })
}
