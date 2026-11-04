import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  type PaneNav,
  PaneNavContext,
  searchParam,
  splitUrl,
  usePaneNav,
} from "./back-nav"
import { buildSecondaryPaneNav, buildSplitUrl, parseSplit } from "./split"

/**
 * Rendered contract for pane-scoped URL state: a view in the second
 * pane reads and writes its own query params (here ?thread=) without
 * ever touching the primary pane's address, and a view with no pane
 * provider keeps the classic real-location behavior.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<StrictMode>{node}</StrictMode>)
  })
  await flush(10)
  return {
    container,
    async unmount() {
      await act(async () => root?.unmount())
      container.remove()
    },
  }
}

/** Probe view: shows its pane's ?thread= and buttons to move it. */
function Probe({ seen }: { seen: (pane: PaneNav) => void }) {
  const pane = usePaneNav()
  seen(pane)
  return (
    <div>
      <span data-testid="thread">{searchParam(pane.search, "thread")}</span>
      <span data-testid="active">{String(pane.active)}</span>
      <button
        type="button"
        data-testid="open"
        onClick={() => pane.pushSearch({ thread: "t2" })}
      >
        open t2
      </button>
      <button
        type="button"
        data-testid="close"
        onClick={() => pane.backOr(`${pane.pathname}?thread=closed`)}
      >
        close
      </button>
    </div>
  )
}

describe("pane nav — second pane isolation", () => {
  test("reads its own params and writes only ?split=", async () => {
    let currentUrl = buildSplitUrl(
      "/chat?thread=primary1",
      "/chat?thread=second1",
    )
    const pushed: string[] = []
    const nav = {
      getUrl: () => currentUrl,
      go: (url: string) => {
        pushed.push(url)
        currentUrl = url
      },
      replace: (url: string) => {
        currentUrl = url
      },
    }
    let latest: PaneNav | null = null
    const secondary = buildSecondaryPaneNav(
      parseSplit(splitUrl(currentUrl).search) ?? "",
      true,
      nav,
    )
    const { container, unmount } = await mount(
      <PaneNavContext.Provider value={secondary}>
        <Probe
          seen={(pane) => {
            latest = pane
          }}
        />
      </PaneNavContext.Provider>,
    )
    try {
      const thread = container.querySelector('[data-testid="thread"]')
      expect(thread?.textContent).toBe("second1")
      expect(
        container.querySelector('[data-testid="active"]')?.textContent,
      ).toBe("true")

      const open = container.querySelector(
        '[data-testid="open"]',
      ) as HTMLElement
      await act(async () => {
        open.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
      })
      await flush()
      expect(pushed).toHaveLength(1)
      // The primary pane's address is byte-identical; only ?split= moved.
      expect(splitUrl(pushed[0]).pathname).toBe("/chat")
      expect(searchParam(splitUrl(pushed[0]).search, "thread")).toBe("primary1")
      expect(parseSplit(splitUrl(pushed[0]).search)).toBe("/chat?thread=t2")

      // A no-op write (same value) reports false and pushes nothing.
      expect(latest).toBeTruthy()
      const again = (latest as unknown as PaneNav).pushSearch({
        thread: "t2",
      })
      expect(again).toBe(false)
      expect(pushed).toHaveLength(1)

      const close = container.querySelector(
        '[data-testid="close"]',
      ) as HTMLElement
      await act(async () => {
        close.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
      })
      await flush()
      expect(pushed).toHaveLength(2)
      expect(parseSplit(splitUrl(pushed[1]).search)).toBe("/chat?thread=closed")
      expect(searchParam(splitUrl(pushed[1]).search, "thread")).toBe("primary1")
    } finally {
      await unmount()
    }
  })

  test("replace writes swap the pair entry in place", async () => {
    let currentUrl = buildSplitUrl("/media", "/media?album=a1")
    const replaced: string[] = []
    const secondary = buildSecondaryPaneNav("/media?album=a1", false, {
      getUrl: () => currentUrl,
      go: (url: string) => {
        currentUrl = url
      },
      replace: (url: string) => {
        replaced.push(url)
        currentUrl = url
      },
    })
    const ok = secondary.pushSearch({ item: "i9" }, { replace: true })
    expect(ok).toBe(true)
    expect(replaced).toHaveLength(1)
    expect(parseSplit(splitUrl(replaced[0]).search)).toBe(
      "/media?album=a1&item=i9",
    )
    expect(secondary.active).toBe(false)
  })

  test("no provider: the real address, active, like always", async () => {
    history.replaceState(null, "", buildSplitUrl("/chat?thread=real1", "/apps"))
    let latest: PaneNav | null = null
    const { container, unmount } = await mount(
      <Probe
        seen={(pane) => {
          latest = pane
        }}
      />,
    )
    try {
      expect(
        container.querySelector('[data-testid="thread"]')?.textContent,
      ).toBe("real1")
      expect((latest as unknown as PaneNav).active).toBe(true)
      expect((latest as unknown as PaneNav).pathname).toBe("/chat")
    } finally {
      await unmount()
    }
  })
})
