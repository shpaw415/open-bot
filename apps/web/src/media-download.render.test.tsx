import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MediaImage } from "./MediaDownload"

/**
 * The full-screen lightbox must never be a silent black screen: while the
 * image loads it says so, and when the load fails (a stale media URL, a
 * desktop that went to sleep) it shows an error with a retry instead of
 * only the ✕ button over an empty backdrop.
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

function fire(el: HTMLElement, type: string) {
  return act(async () => {
    el.dispatchEvent(new window.Event(type, { bubbles: false }))
  })
}

describe("media lightbox — load states", () => {
  test("failed image shows an error with retry, never a silent blank", async () => {
    history.replaceState(
      null,
      "",
      "/chat?thread=s1&split=%2Fchat%3Fthread%3Ds1",
    )
    const { container, unmount } = await mount(
      <MediaImage src="/api/workspace/image?path=%2Fgone.png" alt="sample" />,
    )
    try {
      const thumb = container.querySelector("img.ob-media-tap") as HTMLElement
      expect(thumb).toBeTruthy()
      await click(thumb)
      await flush()

      const lightbox = document.body.querySelector(".ob-lightbox")
      expect(lightbox).toBeTruthy()
      // While the (separate) full-screen load is pending, the viewer says so.
      expect(lightbox?.querySelector(".ob-lightbox-status")).toBeTruthy()

      // happy-dom never loads images, so the settle check may already have
      // landed on error; otherwise drive the failure explicitly.
      const img = lightbox?.querySelector("img") as HTMLImageElement | null
      if (img) {
        await fire(img, "error")
        await flush()
      }

      // A failed load is explicit: error text plus a way to retry, and the
      // broken image is not left as the only (invisible) content.
      const status = lightbox?.querySelector(".ob-lightbox-status")
      expect(status?.textContent).toContain("could not be loaded")
      const retry = [...(lightbox?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent === "Retry",
      )
      expect(retry).toBeTruthy()

      // Retrying remounts the image; a successful load clears the status.
      await click(retry as HTMLElement)
      await flush()
      const retried = lightbox?.querySelector("img") as HTMLImageElement
      expect(retried).toBeTruthy()
      await fire(retried, "load")
      await flush()
      expect(lightbox?.querySelector(".ob-lightbox-status")).toBeFalsy()
    } finally {
      await unmount()
      history.replaceState(null, "", "/")
    }
  })
})
