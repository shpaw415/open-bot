import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import type { Me } from "./api"
import { CronView } from "./CronView"
import { atMsToLocalInput } from "./dashboard-data"

/**
 * R04 rendered contract: opening the edit form of an existing one-shot job
 * pre-fills its instant (in the viewer's zone), leaves the advanced options
 * collapsed for a simple job, and a name-only save sends NO schedule keys —
 * the stored instant must survive untouched.
 */

const HOUR = 3_600_000
const AT_MS = Date.now() + 26 * HOUR

const me: Me = {
  id: "u1",
  email: "c@example.com",
  role: "user",
  language: "fr",
}

const oneShotJob = {
  id: "j1",
  name: "Rappel facture",
  enabled: true,
  nextRunAt: AT_MS,
  lastError: null,
  message: "Rappelle-moi la facture",
  kind: "at",
  cronExpr: null,
  everySeconds: null,
  atMs: AT_MS,
  sessionId: null,
  createdAt: Date.now() - HOUR,
  lastRunAt: null,
  runCount: 0,
  providerId: null,
  modelId: null,
  personaId: null,
  runKind: "prompt",
  script: null,
}

const requests: { path: string; method: string; body: string }[] = []

function installFetch() {
  const real = (globalThis as any).fetch
  ;(globalThis as any).fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const method = init?.method ?? "GET"
    if (method !== "GET") {
      requests.push({
        path,
        method,
        body: typeof init?.body === "string" ? init.body : "",
      })
    }
    const body = path.startsWith("/api/cron/notices")
      ? []
      : path === "/api/cron"
        ? [oneShotJob]
        : path === "/api/models"
          ? { models: [] }
          : path === "/api/personas"
            ? { personas: [] }
            : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }
  return () => {
    ;(globalThis as any).fetch = real
  }
}

/** Assert-or-throw: keeps the lint clean without non-null assertions. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element to exist")
  return value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms: number) {
  await act(async () => {
    await sleep(ms)
  })
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")] as HTMLButtonElement[]
}

describe("CronView — one-shot edit (R04, rendered)", () => {
  test("pre-filled date, collapsed advanced, name-only save sends no schedule", async () => {
    // WebSocket (event stream) must not connect for real.
    const RealSocket = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = class {
      close() {}
    }
    const restoreFetch = installFetch()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <CronView me={me} />
        </StrictMode>,
      )
    })
    try {
      await flush(60)
      const edit = buttons(container).find(
        (button) => button.textContent === "Modifier",
      )
      expect(edit).toBeTruthy()
      await act(async () => {
        must(edit).click()
        await sleep(20)
      })
      // the datetime field holds the job's instant in the viewer's zone —
      // not empty, not a UTC relabel
      const dateInput = container.querySelector(
        'input[type="datetime-local"]',
      ) as HTMLInputElement | null
      expect(dateInput).toBeTruthy()
      expect(must(dateInput).value).toBe(atMsToLocalInput(AT_MS))
      // a simple one-shot job keeps the advanced options collapsed
      const advanced = buttons(container).find((button) =>
        button.textContent?.includes("Options avancées"),
      )
      expect(advanced).toBeTruthy()
      expect(must(advanced).getAttribute("aria-expanded")).toBe("false")
      // Saving the untouched form is the same wire contract a name-only
      // edit takes: scheduleUnchanged() omits every schedule key, so the
      // server keeps the stored instant to the millisecond. (Typing into a
      // controlled input is not simulatable under happy-dom + React 19 —
      // React's delegated input listener never sees programmatic events —
      // so the name change itself is exercised by scheduleUnchanged's
      // purity: any field the user DID touch would be re-sent with its
      // schedule, as pinned in cron-helpers/dashboard-data tests.)
      requests.length = 0
      const save = buttons(container).find(
        (button) => button.textContent === "Enregistrer",
      )
      expect(save).toBeTruthy()
      await act(async () => {
        must(save).click()
        await sleep(40)
      })
      const patch = requests.find((request) => request.method === "PATCH")
      expect(patch).toBeTruthy()
      expect(must(patch).path).toBe("/api/cron/j1")
      const sent = JSON.parse(must(patch).body) as Record<string, unknown>
      expect(sent.name).toBe("Rappel facture")
      // the schedule is OMITTED: the server keeps the stored instant
      expect(sent.kind).toBeUndefined()
      expect(sent.atMs).toBeUndefined()
      expect(sent.cronExpr).toBeUndefined()
      expect(sent.everySeconds).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      restoreFetch()
      ;(globalThis as any).WebSocket = RealSocket
    }
  })

  test("the dashboard alert deep link (?job=ID) opens that job's editor", async () => {
    const RealSocket = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = class {
      close() {}
    }
    const restoreFetch = installFetch()
    history.replaceState(null, "", "/automations?job=j1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <CronView me={me} />
        </StrictMode>,
      )
    })
    try {
      await flush(80)
      // the dialog opened by itself with the right job
      expect(container.querySelector('[role="dialog"]')).toBeTruthy()
      const dateInput = container.querySelector(
        'input[type="datetime-local"]',
      ) as HTMLInputElement | null
      expect(dateInput).toBeTruthy()
      expect(must(dateInput).value).toBe(atMsToLocalInput(AT_MS))
      // the URL is cleaned so Back/reload don't reopen the dialog
      expect(location.search).toBe("")
      // an unknown id stays closed (the list is the answer)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      restoreFetch()
      history.replaceState(null, "", "/")
      ;(globalThis as any).WebSocket = RealSocket
    }
  })
})
