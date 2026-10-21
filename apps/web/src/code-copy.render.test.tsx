import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Markdown from "react-markdown"
import { MarkdownCodeBlock } from "./code-copy"
import { CODE_COPY } from "./texts"

// happy-dom exposes navigator members as readonly getters; shadow with an
// own property and restore (or drop the shadow) afterwards.
function patchNavigator(key: string, value: unknown): () => void {
  const nav = navigator as unknown as Record<string, unknown>
  const owned = Object.hasOwn(nav, key)
  const real = nav[key]
  Object.defineProperty(nav, key, { value, configurable: true })
  return () => {
    if (owned) {
      Object.defineProperty(nav, key, { value: real, configurable: true })
    } else {
      delete (nav as { [k: string]: unknown })[key]
    }
  }
}

/** Assert-or-throw: keeps the lint clean without non-null assertions. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element to exist")
  return value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

describe("chat code blocks — copy button", () => {
  test("fenced block gets a copy button that copies the code and confirms", async () => {
    const written: string[] = []
    const restoreClipboard = patchNavigator("clipboard", {
      writeText: (text: string) => {
        written.push(text)
        return Promise.resolve()
      },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <Markdown components={{ pre: MarkdownCodeBlock }}>
            {"Essayez :\n\n```js\nconst x = 1\n```\n"}
          </Markdown>
        </StrictMode>,
      )
    })
    try {
      await flush()
      const button = must(
        container.querySelector<HTMLButtonElement>("button.ob-code-copy"),
      )
      expect(button.getAttribute("aria-label")).toBe(CODE_COPY.copy)
      await act(async () => {
        button.click()
        await sleep(0)
      })
      expect(written).toEqual(["const x = 1"])
      expect(button.getAttribute("aria-label")).toBe(CODE_COPY.copied)
      expect(button.textContent).toContain(CODE_COPY.copied)
      await act(async () => {
        await sleep(2100)
      })
      expect(button.getAttribute("aria-label")).toBe(CODE_COPY.copy)
    } finally {
      restoreClipboard()
      act(() => root.unmount())
      container.remove()
    }
  })

  test("inline code and plain prose get no button", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <Markdown components={{ pre: MarkdownCodeBlock }}>
            {"Utilisez `npm i` aujourd’hui.\n"}
          </Markdown>
        </StrictMode>,
      )
    })
    try {
      await flush()
      expect(container.querySelector("button.ob-code-copy")).toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
