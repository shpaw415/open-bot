import type { Snapshot } from "./action-space"
import {
  actionScript,
  connectCdpSocket,
  evaluate,
  normalize,
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

const USAGE =
  "usage: page.ts PORT SESSION read | scroll down|up [pages] | click ID | type ID TEXT"

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
