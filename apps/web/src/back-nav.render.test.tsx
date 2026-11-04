import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import AccessibleDialog, { DialogTitle } from "./AccessibleDialog"
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
