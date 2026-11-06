import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import Stack from "@shpaw415/mui-lite/Stack"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { isNarrowPane, useElementWidth } from "./hooks"

/**
 * Pane-width contract behind the split-screen small view: a view hosted
 * in a narrow split pane must learn about *its own* width, never the
 * window's, so shrinking a pane (window untouched) still flips it to
 * the small-screen layout. The probe drives the real hook through a
 * stubbed ResizeObserver and a scripted clientWidth.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

type RoCallback = (entries: unknown[], observer: unknown) => void

class FakeResizeObserver {
  static callbacks = new Set<RoCallback>()
  #cb: RoCallback
  constructor(cb: RoCallback) {
    this.#cb = cb
    FakeResizeObserver.callbacks.add(cb)
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeResizeObserver.callbacks.delete(this.#cb)
  }
  static fire() {
    for (const cb of [...FakeResizeObserver.callbacks]) cb([], {})
  }
}

function Probe() {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  return (
    <div ref={ref}>
      <span data-testid="w">{width}</span>
      <span data-testid="narrow">{String(isNarrowPane(width))}</span>
    </div>
  )
}

/** The workspace root is a mui-lite Stack; its ref must reach the DOM. */
function StackProbe() {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  return (
    <Stack ref={ref}>
      <span data-testid="w">{width}</span>
      <span data-testid="narrow">{String(isNarrowPane(width))}</span>
    </Stack>
  )
}

/** Script every element's clientWidth and the ResizeObserver. Restores. */
function stubWidths(getWidth: () => number): () => void {
  const proto = window.HTMLElement.prototype
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    proto,
    "clientWidth",
  )
  const originalRo = (globalThis as any).ResizeObserver
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get: getWidth,
  })
  ;(globalThis as any).ResizeObserver = FakeResizeObserver
  return () => {
    if (originalDescriptor)
      Object.defineProperty(proto, "clientWidth", originalDescriptor)
    else delete (proto as any).clientWidth
    ;(globalThis as any).ResizeObserver = originalRo
  }
}

async function mountProbe(node: React.ReactNode = <Probe />) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<StrictMode>{node}</StrictMode>)
  })
  await flush(10)
  return {
    text: (id: string) =>
      container.querySelector(`[data-testid="${id}"]`)?.textContent,
    async unmount() {
      await act(async () => root?.unmount())
      container.remove()
    },
  }
}

describe("isNarrowPane", () => {
  test("matches the mobile breakpoint, inclusive", () => {
    expect(isNarrowPane(899)).toBe(true)
    expect(isNarrowPane(900)).toBe(false)
    expect(isNarrowPane(320)).toBe(true)
    expect(isNarrowPane(1600)).toBe(false)
  })

  test("unmeasured (0) is not narrow — the viewport decides until measured", () => {
    expect(isNarrowPane(0)).toBe(false)
  })
})

describe("useElementWidth", () => {
  test("reports the element's width and tracks pane resizes", async () => {
    let fakeWidth = 1200
    const restore = stubWidths(() => fakeWidth)
    const probe = await mountProbe()
    try {
      // Wide pane on a wide window: desktop layout.
      expect(probe.text("w")).toBe("1200")
      expect(probe.text("narrow")).toBe("false")

      // The split divider shrinks the pane; the window never moves.
      fakeWidth = 540
      await act(async () => {
        FakeResizeObserver.fire()
      })
      await flush()
      expect(probe.text("w")).toBe("540")
      expect(probe.text("narrow")).toBe("true")

      // Widening back across the breakpoint restores the desktop layout.
      fakeWidth = 900
      await act(async () => {
        FakeResizeObserver.fire()
      })
      await flush()
      expect(probe.text("w")).toBe("900")
      expect(probe.text("narrow")).toBe("false")
    } finally {
      await probe.unmount()
      restore()
    }
  })

  test("measures through the mui-lite Stack the workspace root uses", async () => {
    const restore = stubWidths(() => 500)
    const probe = await mountProbe(<StackProbe />)
    try {
      expect(probe.text("w")).toBe("500")
      expect(probe.text("narrow")).toBe("true")
    } finally {
      await probe.unmount()
      restore()
    }
  })
})
