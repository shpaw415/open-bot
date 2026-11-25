import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import AccessibleDialog, { DialogTitle } from "./AccessibleDialog"
import {
  installShellHost,
  type PaneMode,
  paneSyncAction,
  searchParam,
  useClosingPane,
  usePaneNav,
} from "./back-nav"
import { MediaImage } from "./MediaDownload"

/**
 * Rendered contract for the app history stack: opening an image preview
 * (or any dialog) is a navigation — the system/browser Back button
 * closes the topmost layer and stays on the page, Forward reopens a
 * media viewer, and the ✕ button consumes the same entry.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 30) {
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

function click(el: HTMLElement) {
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  })
}

async function traverse(delta: number) {
  await act(async () => {
    history.go(delta)
    await sleep(20)
  })
  await flush(10)
}

describe("back-nav — rendered app stack", () => {
  test("image preview: tap opens, Back closes it (page stays), Forward reopens", async () => {
    history.replaceState(null, "", "/chat")
    const { container, unmount } = await mount(
      <MediaImage src="/api/media/items/x/file" alt="sample" />,
    )
    try {
      const img = container.querySelector("img.ob-media-tap") as HTMLElement
      expect(img).toBeTruthy()
      await click(img)
      await flush()
      expect(document.body.querySelector(".ob-lightbox")).toBeTruthy()
      expect(location.pathname).toBe("/chat")

      await traverse(-1)
      expect(document.body.querySelector(".ob-lightbox")).toBeFalsy()
      expect(location.pathname).toBe("/chat")

      await traverse(1)
      expect(document.body.querySelector(".ob-lightbox")).toBeTruthy()

      const close = document.body.querySelector(
        ".ob-lightbox-close",
      ) as HTMLElement
      await click(close)
      await flush()
      expect(document.body.querySelector(".ob-lightbox")).toBeFalsy()
      expect(location.pathname).toBe("/chat")
    } finally {
      await unmount()
      history.replaceState(null, "", "/")
    }
  })

  test("dialog: Back dismisses it like Escape; Forward does not resurrect it", async () => {
    history.replaceState(null, "", "/media")
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open-dialog
          </button>
          <AccessibleDialog
            open={open}
            onClose={() => setOpen(false)}
            aria-labelledby="t-id"
          >
            <DialogTitle id="t-id">Delete?</DialogTitle>
          </AccessibleDialog>
        </>
      )
    }
    const { container, unmount } = await mount(<Harness />)
    try {
      const opener = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "open-dialog",
      ) as HTMLButtonElement
      await click(opener)
      await flush()
      expect(container.querySelector('[role="dialog"]')).toBeTruthy()

      await traverse(-1)
      expect(container.querySelector('[role="dialog"]')).toBeFalsy()
      expect(location.pathname).toBe("/media")

      await traverse(1)
      expect(container.querySelector('[role="dialog"]')).toBeFalsy()
      expect(location.pathname).toBe("/media")
    } finally {
      await unmount()
      history.replaceState(null, "", "/")
    }
  })
})

/**
 * Rendered contract for a URL-backed side pane (`?preview=1`) wired like
 * the Workspace ones: Close closes eagerly and leaves the entry through
 * backOr, and until that traversal lands the URL still names the pane. The
 * pane must stay closed meanwhile — following the URL again re-opened it
 * on every Close, remounting the preview iframe — and follow the URL again
 * once history moved.
 */

let bodiesMounted = 0
function PaneBody() {
  useEffect(() => {
    bodiesMounted += 1
  }, [])
  return <div data-testid="body">preview</div>
}

function PreviewPane({
  markClosing,
  seen,
}: {
  /** Set the closing marker before leaving, like closePreview does. */
  markClosing: boolean
  seen: (closing: string) => void
}) {
  const pane = usePaneNav()
  const closing = useClosingPane()
  const open = searchParam(pane.search, "preview") === "1"
  const [mode, setMode] = useState<PaneMode>("closed")
  seen(closing.current)
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing is a ref, read live on purpose
  useEffect(() => {
    const action = paneSyncAction(open, mode, closing.current === "preview")
    if (action === "open") setMode("pane")
    else if (action === "close") setMode("closed")
  }, [open, mode])
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      {mode === "pane" ? <PaneBody /> : null}
      <button
        type="button"
        data-testid="open"
        onClick={() => {
          setMode("pane")
          // Shell-style push: the entry carries its traversal position.
          history.pushState({ obPos: 1 }, "", "/chat?thread=t&preview=1")
          window.dispatchEvent(new CustomEvent("ob-navigate"))
        }}
      >
        open
      </button>
      <button
        type="button"
        data-testid="close"
        onClick={() => {
          if (markClosing) closing.current = "preview"
          setMode("closed")
          pane.backOr(`${pane.pathname}?thread=t`)
        }}
      >
        close
      </button>
    </div>
  )
}

const text = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""

/** Shell host whose Back lands a little later, like a real traversal. */
function installSlowBack() {
  return installShellHost({
    getState: () => history.state,
    getUrl: () => location.pathname + location.search,
    push: (patch, url) =>
      history.pushState({ ...(history.state ?? {}), ...patch }, "", url),
    replace: (patch, url) =>
      history.replaceState({ ...(history.state ?? {}), ...patch }, "", url),
    back: () => {
      setTimeout(() => history.back(), 30)
    },
    canGoBackInApp: () =>
      Number((history.state as { obPos?: number } | null)?.obPos) > 0,
  })
}

async function openPreview(container: HTMLElement) {
  await click(container.querySelector('[data-testid="open"]') as HTMLElement)
  await flush()
  expect(text(container, "mode")).toBe("pane")
}

describe("back-nav — URL-backed pane close", () => {
  test("Close stays closed while Back travels, then the URL is followed again", async () => {
    history.replaceState({ obPos: 0 }, "", "/chat?thread=t")
    bodiesMounted = 0
    const seen: string[] = []
    const uninstall = installSlowBack()
    const { container, unmount } = await mount(
      <PreviewPane
        markClosing
        seen={(closing) => {
          seen.push(closing)
        }}
      />,
    )
    try {
      await openPreview(container)
      const mounted = bodiesMounted

      // Close: Back is still travelling, so the URL still names the pane.
      await click(
        container.querySelector('[data-testid="close"]') as HTMLElement,
      )
      expect(location.search).toBe("?thread=t&preview=1")
      expect(text(container, "mode")).toBe("closed")
      expect(container.querySelector('[data-testid="body"]')).toBeFalsy()
      expect(bodiesMounted).toBe(mounted)

      await flush(100)
      expect(location.search).toBe("?thread=t")
      expect(text(container, "mode")).toBe("closed")
      expect(seen.at(-1)).toBe("")

      // Forward names the pane again: history moved, the URL leads again.
      await traverse(1)
      expect(text(container, "mode")).toBe("pane")
      expect(container.querySelector('[data-testid="body"]')).toBeTruthy()
    } finally {
      await unmount()
      uninstall()
      history.replaceState(null, "", "/")
    }
  })

  test("without the closing marker the URL effect re-opens the pane mid-traversal", async () => {
    history.replaceState({ obPos: 0 }, "", "/chat?thread=t")
    bodiesMounted = 0
    const uninstall = installSlowBack()
    const { container, unmount } = await mount(
      <PreviewPane markClosing={false} seen={() => {}} />,
    )
    try {
      await openPreview(container)
      const mounted = bodiesMounted
      await click(
        container.querySelector('[data-testid="close"]') as HTMLElement,
      )
      // The pane was closed and already re-mounted from the stale URL.
      expect(text(container, "mode")).toBe("pane")
      expect(bodiesMounted).toBeGreaterThan(mounted)
      await flush(100)
      expect(location.search).toBe("?thread=t")
      expect(text(container, "mode")).toBe("closed")
    } finally {
      await unmount()
      uninstall()
      history.replaceState(null, "", "/")
    }
  })
  test("the closing marker holds until the next popstate or in-app navigation", async () => {
    let closing: { current: string } | null = null
    function Probe() {
      closing = useClosingPane()
      return null
    }
    const { unmount } = await mount(<Probe />)
    try {
      const ref = closing as unknown as { current: string }
      expect(ref.current).toBe("")
      ref.current = "preview"
      expect(ref.current).toBe("preview")
      window.dispatchEvent(new CustomEvent("ob-navigate"))
      expect(ref.current).toBe("")
      ref.current = "council"
      window.dispatchEvent(new PopStateEvent("popstate"))
      expect(ref.current).toBe("")
    } finally {
      await unmount()
    }
  })
})
