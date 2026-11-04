import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ChatMarkdown } from "./chat-markdown"
import { FilePreviewBody } from "./FileView"
import { FilePreviewContext } from "./file-view"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 30) {
  await act(async () => {
    await sleep(ms)
  })
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(body: string) {
  globalThis.fetch = (async () =>
    new Response(body, { status: 200 })) as unknown as typeof fetch
}

function render(node: React.ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<StrictMode>{node}</StrictMode>)
  })
  return { container, root }
}

describe("split file previewer", () => {
  test("markdown files render as formatted markdown, not raw text", async () => {
    stubFetch("# Rapport\n\nDu **gras** et une liste :\n\n- un\n- deux\n")
    const { container, root } = render(
      <FilePreviewBody
        path="/home/agent/workspace/rapport.md"
        src="/api/workspace/file?path=%2Fhome%2Fagent%2Fworkspace%2Frapport.md"
      />,
    )
    try {
      await flush()
      expect(container.querySelector("h1")?.textContent).toBe("Rapport")
      expect(container.querySelector("strong")?.textContent).toBe("gras")
      expect(container.querySelectorAll("li")).toHaveLength(2)
      expect(container.querySelector("pre")).toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  test("relative links inside a markdown file resolve to its folder", async () => {
    stubFetch("Voir [le guide](guide.md) et ![schéma](diagram.png).")
    const { container, root } = render(
      <FilePreviewBody
        path="/home/agent/projects/site/docs/index.md"
        src="/api/workspace/file?path=x"
      />,
    )
    try {
      await flush()
      const href = container.querySelector("a")?.getAttribute("href") ?? ""
      expect(decodeURIComponent(href)).toContain(
        "/home/agent/projects/site/docs/guide.md",
      )
      const img = container.querySelector("img")?.getAttribute("src") ?? ""
      expect(decodeURIComponent(img)).toContain(
        "/home/agent/projects/site/docs/diagram.png",
      )
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  test("plain text and code render in a pre block", async () => {
    stubFetch("const answer = 42\n")
    const { container, root } = render(
      <FilePreviewBody
        path="/home/agent/workspace/app.ts"
        src="/api/workspace/file?path=x"
      />,
    )
    try {
      await flush()
      expect(container.querySelector("pre")?.textContent).toContain(
        "const answer = 42",
      )
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  test("clicking a disk file link in chat opens the previewer in place", async () => {
    const opened: string[] = []
    const { container, root } = render(
      <FilePreviewContext.Provider
        value={(src) => {
          opened.push(src)
        }}
      >
        <ChatMarkdown text="[rapport](/home/agent/workspace/rapport.md) et [site](https://example.com)" />
      </FilePreviewContext.Provider>,
    )
    try {
      await flush()
      const [file, web] = container.querySelectorAll("a")
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      })
      act(() => {
        file?.dispatchEvent(click)
      })
      expect(opened).toEqual([
        "/api/workspace/file?path=%2Fhome%2Fagent%2Fworkspace%2Frapport.md",
      ])
      expect(click.defaultPrevented).toBe(true)
      // modifier clicks keep the browser behavior (new tab) untouched
      const ctrl = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
      act(() => {
        file?.dispatchEvent(ctrl)
      })
      expect(ctrl.defaultPrevented).toBe(false)
      expect(opened).toHaveLength(1)
      const webClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      })
      act(() => {
        web?.dispatchEvent(webClick)
      })
      expect(webClick.defaultPrevented).toBe(false)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
