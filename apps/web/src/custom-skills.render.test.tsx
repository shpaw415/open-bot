import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { CustomSkills } from "./CustomSkills"

/**
 * Rendered contract for the skills search field: once skills load, the
 * page offers the same native filter field as the threads/apps lists
 * (type=search, Filter skills). Typing itself is covered by the pure
 * filterSkills tests — controlled-input typing is not simulatable
 * under happy-dom + React 19.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms: number) {
  await act(async () => {
    await sleep(ms)
  })
}

function installFetch() {
  const real = (globalThis as any).fetch
  ;(globalThis as any).fetch = (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const body = path.startsWith("/api/catalog/dirs")
      ? { dirs: [], items: [] }
      : path === "/api/skills"
        ? {
            skills: [
              { name: "mémo-vocal", description: "Dicter des notes" },
              { name: "web-research", description: "Deep web research" },
            ],
          }
        : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }
  return () => {
    ;(globalThis as any).fetch = real
  }
}

describe("CustomSkills — search field (rendered)", () => {
  test("loaded skills come with a search field above the list", async () => {
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
          <CustomSkills />
        </StrictMode>,
      )
    })
    try {
      await flush(80)
      expect(container.textContent).toContain("mémo-vocal")
      expect(container.textContent).toContain("web-research")
      const field = container.querySelector(
        'input[type="search"]',
      ) as HTMLInputElement | null
      expect(field).toBeTruthy()
      expect(field?.getAttribute("aria-label")).toBe("Filter skills")
      expect(field?.getAttribute("placeholder")).toBe("Filter skills")
    } finally {
      await act(async () => root.unmount())
      container.remove()
      restoreFetch()
      ;(globalThis as any).WebSocket = RealSocket
    }
  })
})
