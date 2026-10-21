import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CronView } from "./CronView"

// V06 rendered contract: opening an existing automation's editor and
// cancelling it (Cancel button or Escape) returns focus to that row's
// "Modifier" trigger — never to the page body. The dialog mounts with an
// autoFocus field, which used to steal the trigger before the capture ran.
// Never dial a real socket in tests (same stub as the dashboard tests).
class FakeSocket {
  static last: FakeSocket | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {
    this.onclose?.()
  }
}
;(globalThis as any).WebSocket = FakeSocket

const job = {
  id: "job-1",
  name: "Veille marché",
  enabled: true,
  nextRunAt: Date.now() + 3_600_000,
  lastError: null,
  message: "Surveille les prix",
  kind: "every" as const,
  cronExpr: null,
  everySeconds: 3600,
  atMs: null,
  sessionId: null,
  createdAt: Date.now(),
  lastRunAt: null,
  runCount: 0,
  providerId: null,
  modelId: null,
  personaId: null,
}

function busFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/api/cron")
      return new Response(JSON.stringify([job]), { status: 200 })
    if (path === "/api/cron/notices")
      return new Response(JSON.stringify([]), { status: 200 })
    return new Response("{}", { status: 200 })
  }) as typeof fetch
}

async function mountEditor() {
  const restoreFetch = globalThis.fetch
  globalThis.fetch = busFetch()
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root?.render(
      <StrictMode>
        <CronView me={{ id: "u", email: "e", role: "user" } as never} />
      </StrictMode>,
    )
  })
  await new Promise((r) => setTimeout(r, 30))
  await act(async () => {})
  const trigger = (
    Array.from(container.querySelectorAll("button")) as HTMLButtonElement[]
  ).find((b) => b.textContent?.includes("Modifier"))
  if (!trigger) throw new Error("expected a Modifier trigger")
  if (!root) throw new Error("expected a mounted root")
  const mountedRoot: Root = root
  return {
    container,
    root: mountedRoot,
    restore: () => {
      globalThis.fetch = restoreFetch
    },
    trigger,
  }
}

async function flush(ms = 20) {
  await new Promise((r) => setTimeout(r, ms))
  await act(async () => {})
}

function pressEscape() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe("Automations editor — focus returns to the trigger (V06)", () => {
  test("Escape closes the editor and refocuses Modifier", async () => {
    const view = await mountEditor()
    try {
      await act(async () => {
        view.trigger.focus()
        view.trigger.click()
      })
      await flush()
      const dialog = view.container.querySelector('[role="dialog"]')
      expect(dialog).toBeDefined()
      // The editor's own field holds focus (autoFocus) — like a real open.
      expect(dialog?.contains(document.activeElement)).toBe(true)

      await act(async () => {
        pressEscape()
      })
      await flush()
      expect(view.container.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(view.trigger)
    } finally {
      view.root.unmount()
      view.container.remove()
      view.restore()
    }
  })

  test("Annuler closes the editor and refocuses Modifier", async () => {
    const view = await mountEditor()
    try {
      await act(async () => {
        view.trigger.focus()
        view.trigger.click()
      })
      await flush()
      const cancel = (
        Array.from(
          view.container.querySelectorAll('[role="dialog"] button'),
        ) as HTMLButtonElement[]
      ).find((b) => b.textContent?.trim() === "Annuler")
      expect(cancel).toBeDefined()
      await act(async () => {
        cancel?.click()
      })
      await flush()
      expect(view.container.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(view.trigger)
    } finally {
      view.root.unmount()
      view.container.remove()
      view.restore()
    }
  })

  test("the editor dialog is named and keeps Tab inside", async () => {
    const view = await mountEditor()
    try {
      await act(async () => {
        view.trigger.focus()
        view.trigger.click()
      })
      await flush()
      const dialog = view.container.querySelector('[role="dialog"]')
      if (!dialog) throw new Error("expected the editor dialog to open")
      expect(dialog.getAttribute("aria-labelledby")).toBeTruthy()

      // Tab at the last control wraps back inside the dialog.
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.getAttribute("aria-hidden") !== "true",
      )
      expect(focusables.length).toBeGreaterThan(1)
      focusables[focusables.length - 1]?.focus()
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      await flush()
      expect(dialog.contains(document.activeElement)).toBe(true)

      // Escape still returns to the trigger afterwards.
      await act(async () => {
        pressEscape()
      })
      await flush()
      expect(document.activeElement).toBe(view.trigger)
    } finally {
      view.root.unmount()
      view.container.remove()
      view.restore()
    }
  })
})
