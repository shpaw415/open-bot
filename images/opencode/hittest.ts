export type Socket = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

export function openSocket(url: string) {
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

export async function pageSocket(port: number) {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.json(),
  )) as { type?: string; webSocketDebuggerUrl?: string }[]
  const page = list.find(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  )
  if (!page?.webSocketDebuggerUrl) throw new Error("no page on this screen")
  return openSocket(page.webSocketDebuggerUrl)
}

export async function evaluate(
  socket: Socket,
  expression: string,
): Promise<unknown> {
  const result = (await socket.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } }
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluate failed")
  }
  return result.result?.value
}

export const HIT_SCRIPT = `
(liveX, liveY) => {
  const left = window.screenX + (window.outerWidth - window.innerWidth) / 2
  const top = window.screenY + (window.outerHeight - window.innerHeight)
  const x = liveX - left
  const y = liveY - top
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > window.innerWidth ||
    y > window.innerHeight
  ) {
    return { hit: "outside the browser window" }
  }
  const el = document.elementFromPoint(x, y)
  if (!el) return { hit: "no element at that point" }
  const labelled = el.closest("[aria-label],[title],label,button,a")
  const label =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (labelled && labelled !== el
      ? (labelled.getAttribute("aria-label") ||
          labelled.getAttribute("title") ||
          labelled.textContent ||
          "")
          .trim()
          .slice(0, 80)
      : "")
  const text = (el.textContent || "").trim().slice(0, 80)
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    label: label || undefined,
    text: text || undefined,
  }
}
`

async function main() {
  const port = Number(process.argv[2])
  const x = Number(process.argv[3])
  const y = Number(process.argv[4])
  if (!Number.isInteger(port) || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("usage: hittest.ts PORT X Y")
  }
  const socket = await pageSocket(port)
  try {
    const value = await evaluate(
      socket,
      `(${HIT_SCRIPT})(${JSON.stringify(x)}, ${JSON.stringify(y)})`,
    )
    console.log(JSON.stringify(value ?? { hit: "no result" }))
  } finally {
    socket.close()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "hit test failed")
    process.exit(1)
  })
}
