import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import type { JoinedFile } from "./join-file"
import { JoinedFiles } from "./joined-files"

const image: JoinedFile = {
  id: "f1",
  name: "capture-ecran.png",
  mime: "image/png",
  url: "data:image/png;base64,QQ==",
}
const doc: JoinedFile = {
  id: "f2",
  name: "notes.txt",
  mime: "text/plain",
  url: "data:text/plain;base64,QQ==",
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<StrictMode>{node}</StrictMode>)
  })
  return {
    container,
    async unmount() {
      await act(async () => root?.unmount())
      container.remove()
    },
  }
}

function click(el: Element) {
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  })
}

describe("JoinedFiles — composer attachment previews", () => {
  test("a pasted image renders as a large preview tile, not a chip avatar", () => {
    const html = renderToStaticMarkup(
      <JoinedFiles files={[image, doc]} onRemove={() => {}} />,
    )
    // Large preview tile with the real image, its visible name, and
    // labelled preview/remove controls (previously a 28px chip avatar
    // with the label hidden).
    expect(html).toContain("ob-join-preview")
    expect(html).toContain('src="data:image/png;base64,QQ=="')
    expect(html).toContain("capture-ecran.png")
    expect(html).toContain("Aperçu plein écran de capture-ecran.png")
    expect(html).toContain("Retirer capture-ecran.png")
    expect(html).not.toContain("ob-join-thumb")
    // Non-image files keep the compact named chip.
    expect(html).toContain("notes.txt")
    expect(html).toContain("Retirer notes.txt")
  })

  test("tapping the preview opens the full-screen lightbox; remove fires", async () => {
    const removed: string[] = []
    const { container, unmount } = await mount(
      <JoinedFiles files={[image]} onRemove={(id) => removed.push(id)} />,
    )
    try {
      const preview = container.querySelector(
        ".ob-join-preview-button",
      ) as HTMLElement
      expect(preview).toBeTruthy()
      await click(preview)
      expect(document.body.querySelector(".ob-lightbox")).toBeTruthy()
      const close = document.body.querySelector(
        ".ob-lightbox-close",
      ) as HTMLElement
      await click(close)
      expect(document.body.querySelector(".ob-lightbox")).toBeFalsy()

      const remove = container.querySelector(
        ".ob-join-preview-remove",
      ) as HTMLElement
      await click(remove)
      expect(removed).toEqual(["f1"])
    } finally {
      await unmount()
    }
  })
})
