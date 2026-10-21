import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import Markdown from "react-markdown"
import { ChatLink } from "./chat-link"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

function renderMarkdown(text: string): { container: HTMLElement; root: Root } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <Markdown components={{ a: ChatLink }}>{text}</Markdown>
      </StrictMode>,
    )
  })
  return { container, root }
}

describe("chat links — external targets", () => {
  test("external web links open in a new tab with noopener", async () => {
    const { container, root } = renderMarkdown(
      "[docs](https://example.com/guide) and [plain](http://example.org).",
    )
    try {
      await flush()
      const links = container.querySelectorAll("a")
      expect(links).toHaveLength(2)
      for (const link of links) {
        expect(link.getAttribute("target")).toBe("_blank")
        expect(link.getAttribute("rel")).toBe("noopener noreferrer")
      }
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  test("relative links stay in-tab", async () => {
    const { container, root } = renderMarkdown(
      "[api](/api/workspace/snapshot/s1/x.png)",
    )
    try {
      await flush()
      const link = container.querySelector("a")
      expect(link?.getAttribute("href")).toBe(
        "/api/workspace/snapshot/s1/x.png",
      )
      expect(link?.getAttribute("target")).toBeNull()
      expect(link?.getAttribute("rel")).toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
