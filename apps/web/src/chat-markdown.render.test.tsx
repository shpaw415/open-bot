import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ChatMarkdown } from "./chat-markdown"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

function renderText(text: string): { container: HTMLElement; root: Root } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <ChatMarkdown text={text} />
      </StrictMode>,
    )
  })
  return { container, root }
}

describe("chat markdown media nesting", () => {
  test("standalone media leaves the paragraph entirely", async () => {
    const { container, root } = renderText(
      "Avant\n\n![Démo](/api/workspace/snapshot/s1/demo.png)\n\nAprès",
    )
    try {
      await flush()
      // The block-level wrapper (span.ob-media-wrap) must never sit inside a
      // <p> — React warns on <p> > <div> descendants and browsers repair the
      // markup out from under the download/fullscreen buttons.
      expect(container.querySelector("p .ob-media-wrap")).toBeNull()
      const wrap = container.querySelector(".ob-media-wrap")
      expect(wrap).not.toBeNull()
      expect(wrap?.closest("p")).toBeNull()
      expect(wrap?.querySelector("img")?.getAttribute("src")).toBe(
        "/api/workspace/snapshot/s1/demo.png",
      )
      expect(container.textContent).toContain("Avant")
      expect(container.textContent).toContain("Après")
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  test("inline media keeps the paragraph and uses an inline-safe span", async () => {
    const { container, root } = renderText(
      "Voir ![schéma](/api/workspace/snapshot/s1/x.png) ci-dessus.",
    )
    try {
      await flush()
      const paragraph = container.querySelector("p")
      expect(paragraph).not.toBeNull()
      const wrap = paragraph?.querySelector(".ob-media-wrap")
      expect(wrap).not.toBeNull()
      expect(wrap?.tagName).toBe("SPAN")
      expect(paragraph?.textContent).toContain("Voir")
      expect(paragraph?.textContent).toContain("ci-dessus.")
      expect(paragraph?.querySelector("div")).toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
