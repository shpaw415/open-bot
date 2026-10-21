import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
  // react-dom's act() needs the test-environment flag, same as the JSdom setup.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import type { Me } from "./api"
import { Dashboard } from "./Dashboard"
import type { PluginTab } from "./plugin-tabs"

/**
 * R01/R03/R06 rendered contract: the Dashboard is mounted UNDER STRICTMODE
 * with delayed, reordered and failing responses. What is asserted is what a
 * user would see — real data after loading, no eternal skeleton, stale
 * responses dropped, errors retryable — not the props or the helpers.
 */

type Route = { path: string; status: number; body: unknown; delay: number }

class FetchBus {
  routes: Route[] = []
  calls: string[] = []
  install() {
    const realFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, "")
      this.calls.push(path)
      const route = this.routes.find((entry) => entry.path === path)
      if (!route) return Promise.resolve(new Response("{}", { status: 404 }))
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(route.body), {
                status: route.status,
              }),
            ),
          route.delay,
        )
      })
    }) as typeof fetch
    return () => {
      globalThis.fetch = realFetch
    }
  }
}

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

const me: Me = {
  id: "u1",
  email: "casey@example.com",
  role: "user",
  language: "fr",
  desktop: "running",
  model: { providerID: "p", modelID: "m" },
}

const goPaths: string[] = []
const openedThreads: string[] = []
const newThreads: (string | undefined)[] = []

function mountDashboard() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <Dashboard
          me={me}
          tabs={[] as PluginTab[]}
          go={(path) => goPaths.push(path)}
          onOpenThread={(id) => openedThreads.push(id)}
          onNewThread={(seed) => newThreads.push(seed)}
        />
      </StrictMode>,
    )
  })
  return {
    root,
    container,
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
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

function text(root: { container: HTMLElement }): string {
  return root.container.textContent ?? ""
}

function setRoutes(
  bus: FetchBus,
  overrides: Partial<Record<string, Omit<Route, "path">>>,
) {
  const base: Record<string, Omit<Route, "path">> = {
    "/api/threads/recent": {
      status: 200,
      delay: 5,
      body: {
        threads: [
          {
            sessionId: "s1",
            title: "Rapport hebdo",
            createdAt: Date.now() - 60_000,
          },
        ],
      },
    },
    "/api/cron": {
      status: 200,
      delay: 5,
      body: [
        {
          id: "j1",
          name: "Veille marché",
          enabled: true,
          nextRunAt: Date.now() + 3_600_000,
          lastError: null,
        },
      ],
    },
    "/api/quota": {
      status: 200,
      delay: 5,
      body: { limitTokens: 1000, used: 10, over: false, behavior: "warn" },
    },
    "/api/projects": { status: 200, delay: 5, body: { projects: [{}] } },
    "/api/desktop": {
      status: 200,
      delay: 5,
      body: { phase: "running" },
    },
  }
  bus.routes = Object.entries({ ...base, ...overrides }).map(
    ([path, rest]) => ({ path, ...rest }) as Route,
  )
}

describe("Dashboard under StrictMode — rendered contract", () => {
  // The event stream must never dial a real socket in these tests.
  ;(() => {
    const original = globalThis.WebSocket
    ;(globalThis as any).WebSocket = FakeSocket
    void original
  })()

  test("data actually renders after StrictMode's double effect cycle", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {})
    const view = mountDashboard()
    try {
      // skeletons while loading…
      expect(text(view)).toContain("Chargement des conversations")
      await flush(80)
      // …then real content, not an eternal skeleton and not an empty list.
      expect(text(view)).toContain("Rapport hebdo")
      expect(text(view)).toContain("Veille marché")
      expect(text(view)).not.toContain("Chargement des conversations")
      // the passive phase probe confirmed the profile's phase
      expect(bus.calls).toContain("/api/desktop")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("a slow older response never overwrites the newer one", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {
      "/api/threads/recent": {
        status: 200,
        delay: 200,
        body: {
          threads: [
            { sessionId: "old", title: "VIEILLE réponse", createdAt: 1 },
          ],
        },
      },
    })
    const view = mountDashboard()
    try {
      await flush(30)
      expect(text(view)).not.toContain("Rapport hebdo")
      // A newer request (visibility-style refetch, fast) lands first.
      bus.routes = bus.routes.map((route) =>
        route.path === "/api/threads/recent"
          ? {
              ...route,
              delay: 5,
              body: {
                threads: [
                  {
                    sessionId: "new",
                    title: "RÉPONSE FRAÎCHE",
                    createdAt: 2,
                  },
                ],
              },
            }
          : route,
      )
      // trigger a refetch through the event-driven path by calling the
      // retry-free path: a fresh request happens via visibilitychange
      document.dispatchEvent(new Event("visibilitychange"))
      await flush(40)
      expect(text(view)).toContain("RÉPONSE FRAÎCHE")
      // the first, slower response resolves later — it must be dropped
      await flush(300)
      expect(text(view)).toContain("RÉPONSE FRAÎCHE")
      expect(text(view)).not.toContain("VIEILLE réponse")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("a failed source renders local error + Retry, other sections stay usable", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {
      "/api/threads/recent": { status: 500, delay: 5, body: { error: "boom" } },
    })
    const view = mountDashboard()
    try {
      await flush(80)
      expect(text(view)).toContain(
        "Impossible de charger vos conversations récentes",
      )
      expect(text(view)).toContain("Réessayer")
      // the other sections still load
      expect(text(view)).toContain("Veille marché")
      // Retry reloads the failed source only
      bus.calls.length = 0
      setRoutes(bus, {})
      const retry = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Réessayer",
      )
      expect(retry).toBeTruthy()
      await act(async () => {
        must(retry).click()
        await sleep(40)
      })
      expect(bus.calls).toContain("/api/threads/recent")
      expect(text(view)).toContain("Rapport hebdo")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("unmount then remount shows data again (fresh identity, fresh refs)", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {})
    const first = mountDashboard()
    await flush(60)
    expect(text(first)).toContain("Rapport hebdo")
    first.unmount()
    const second = mountDashboard()
    try {
      await flush(60)
      expect(text(second)).toContain("Rapport hebdo")
      expect(text(second)).not.toContain("Chargement des conversations")
    } finally {
      second.unmount()
      restoreFetch()
    }
  })

  test("examples are real named buttons that prefill without sending", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {})
    const view = mountDashboard()
    try {
      await flush(60)
      const example = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Recherche + résumé",
      )
      expect(example).toBeTruthy()
      must(example).click()
      expect(newThreads.length).toBe(1)
      expect(newThreads[0]).toContain("recherche")
      expect(goPaths).toEqual([])
      // no server session and no POST was fired by a click
      expect(bus.calls.every((path) => !path.includes("session"))).toBe(true)
      // the environment badge is textual, not an empty colored dot
      expect(text(view)).toContain("Environnement prêt")
      // the wake action is an explicit, named button — the badge is not the button
      const badge = [...view.container.querySelectorAll("*")].find(
        (node) =>
          node.textContent === "Environnement prêt" &&
          node.children.length === 0,
      )
      expect(badge?.tagName).not.toBe("BUTTON")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  // ---- V01: the summary's coverage drives every empty/invite decision ----

  test("named index with rows shows the partial preview, never a first-run invite", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {})
    const view = mountDashboard()
    try {
      await flush(80)
      expect(text(view)).toContain("Rapport hebdo")
      // the titled index is NOT the full history — it says so
      expect(text(view)).toContain("Aperçu partiel")
      // rows prove history exists: no onboarding step, no fake empty state
      expect(text(view)).not.toContain("Démarrer une première conversation")
      expect(text(view)).not.toContain("Votre historique n’est pas disponible")
      expect(text(view)).not.toContain("Bien démarrer")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("an empty named index is unknown coverage — honest unavailable state", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {
      "/api/threads/recent": {
        status: 200,
        delay: 5,
        body: { threads: [], coverage: "titles" },
      },
    })
    const view = mountDashboard()
    try {
      await flush(80)
      // an index-only 200 with no rows is NOT "no conversations"
      expect(text(view)).toContain(
        "Votre historique n’est pas disponible dans cet aperçu",
      )
      expect(text(view)).not.toContain("Aucune conversation pour l’instant")
      // and it is not a first-run invitation either
      expect(text(view)).not.toContain("Démarrer une première conversation")
      const open = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Ouvrir les conversations",
      )
      expect(open).toBeTruthy()
      goPaths.length = 0
      await act(async () => {
        must(open).click()
      })
      expect(goPaths).toContain("/chat")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("full coverage with an empty list is a confirmed empty history — the guide may invite", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {
      "/api/threads/recent": {
        status: 200,
        delay: 5,
        body: { threads: [], coverage: "full" },
      },
    })
    const view = mountDashboard()
    try {
      await flush(80)
      expect(text(view)).toContain("Aucune conversation pour l’instant")
      expect(text(view)).not.toContain("Votre historique n’est pas disponible")
      // a genuinely new account gets the real getting-started step
      expect(text(view)).toContain("Démarrer une première conversation")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })

  test("full coverage rows are ordered by real activity and labelled as such", async () => {
    const bus = new FetchBus()
    const restoreFetch = bus.install()
    setRoutes(bus, {
      "/api/threads/recent": {
        status: 200,
        delay: 5,
        body: {
          coverage: "full",
          threads: [
            {
              sessionId: "s1",
              title: "Rapport hebdo",
              createdAt: Date.now() - 60_000,
            },
          ],
        },
      },
    })
    const view = mountDashboard()
    try {
      await flush(80)
      expect(text(view)).toContain("Rapport hebdo")
      // real last activity, not the naming date
      expect(text(view)).toContain("activité")
      expect(text(view)).not.toContain("Aperçu partiel")
    } finally {
      view.unmount()
      restoreFetch()
    }
  })
})
