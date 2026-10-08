import type { Snapshot } from "./action-space"
import {
  actionScript,
  connectCdpSocket,
  evaluate,
  normalize,
  PROBE,
} from "./cdp"

type Metrics = {
  width: number
  height: number
  scrollY: number
  scrollHeight: number
}

const METRICS = `({width:innerWidth,height:innerHeight,scrollY:window.scrollY,scrollHeight:document.documentElement.scrollHeight})`

export type PageView = {
  url: string
  title: string
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
    options?: string[]
  }[]
}

export function shapeView(probe: Snapshot, metrics: Metrics): PageView {
  return {
    url: probe.url,
    title: probe.title,
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
      options: item.options?.map((option) => option.label),
    })),
  }
}

function metrics(raw: unknown): Metrics {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    scrollY: Number(row.scrollY ?? 0),
    scrollHeight: Number(row.scrollHeight ?? 0),
  }
}

async function view(socket: Parameters<typeof evaluate>[0]) {
  // The page world returns snake_case (target_id, can_scroll_down); without
  // normalize() every id and scroll flag would read as undefined.
  const probe = normalize(await evaluate(socket, PROBE))
  return shapeView(probe, metrics(await evaluate(socket, METRICS)))
}

const USAGE =
  "usage: page.ts PORT read | scroll down|up [pages] | click ID | type ID TEXT"

async function main() {
  const port = Number(process.argv[2])
  const verb = process.argv[3] ?? ""
  if (!Number.isInteger(port) || !verb) throw new Error(USAGE)
  const socket = await connectCdpSocket(port)
  try {
    if (verb === "read") {
      console.log(JSON.stringify(await view(socket)))
      return
    }
    if (verb === "scroll") {
      const direction = process.argv[4] === "up" ? "up" : "down"
      const pages = Math.min(Math.max(Number(process.argv[5] ?? 1) || 1, 1), 10)
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
    if (verb === "click" || verb === "type") {
      const id = process.argv[4] ?? ""
      if (!id) throw new Error(USAGE)
      const action =
        verb === "click"
          ? { kind: "click" as const, targetId: id }
          : { kind: "type" as const, targetId: id, text: process.argv[5] ?? "" }
      if (verb === "type" && !action.text) throw new Error(USAGE)
      const ok = await evaluate(socket, actionScript(action))
      if (ok === false) throw new Error("target covered")
      await Bun.sleep(verb === "type" ? 200 : 80)
      console.log(JSON.stringify(await view(socket)))
      return
    }
    throw new Error(USAGE)
  } finally {
    socket.close()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "page failed")
    process.exit(1)
  })
}
