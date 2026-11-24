import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThreadRelayDialog } from "./ThreadRelayDialog"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 80) {
  await act(async () => {
    await sleep(ms)
  })
}

describe("ThreadRelayDialog (#134)", () => {
  test("mints a one-time handle, shows it once, and revokes grants", async () => {
    const now = Date.now()
    let grants: {
      id: string
      targetSessionId: string
      remainingUses: number
      createdAt: number
      expiresAt: number
      revokedAt: number | null
      lastUsedAt: number | null
    }[] = [
      {
        id: "g-old",
        targetSessionId: "u1",
        remainingUses: 1,
        createdAt: now - 1000,
        expiresAt: now + 60_000,
        revokedAt: null,
        lastUsedAt: null,
      },
    ]
    const calls: { path: string; method: string; body?: unknown }[] = []
    const realFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ path, method, body })
      let payload: unknown = {}
      if (path === "/api/threads/u1/relay-grants" && method === "GET") {
        payload = { grants }
      } else if (path === "/api/threads/u1/relay-grants" && method === "POST") {
        const grant = {
          id: "g-new",
          targetSessionId: "u1",
          remainingUses: body.maxUses,
          createdAt: now,
          expiresAt: now + body.ttlMinutes * 60_000,
          revokedAt: null,
          lastUsedAt: null,
        }
        grants = [grant, ...grants]
        payload = { ...grant, token: "obr_synthetic-relay-handle" }
      } else if (
        path.startsWith("/api/thread-relay-grants/") &&
        method === "DELETE"
      ) {
        const id = decodeURIComponent(path.split("/").at(-1) ?? "")
        grants = grants.map((grant) =>
          grant.id === id ? { ...grant, revokedAt: now } : grant,
        )
        payload = grants.find((grant) => grant.id === id)
      }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: method === "POST" ? 201 : 200,
        }),
      )
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <ThreadRelayDialog
            target={{ id: "u1", title: "Ordinary chat" }}
            onClose={() => {}}
          />
        </StrictMode>,
      )
    })
    try {
      await flush()
      expect(container.textContent).toContain("Relais vocal")
      expect(container.textContent).toContain("Ordinary chat")

      const create = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Créer un code"),
      )
      expect(create).toBeTruthy()
      await act(async () =>
        create?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      )
      await flush()
      const tokenField = [...container.querySelectorAll("input")].find(
        (input) => input.value.startsWith("obr_"),
      ) as HTMLInputElement | undefined
      expect(tokenField?.value).toBe("obr_synthetic-relay-handle")
      expect(container.textContent).toContain("une seule fois")
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        ttlMinutes: 60,
        maxUses: 1,
      })

      const revoke = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Révoquer"),
      )
      expect(revoke).toBeTruthy()
      await act(async () =>
        revoke?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      )
      await flush()
      expect(
        calls.some(
          (call) => call.method === "DELETE" && call.path.includes("g-new"),
        ) || calls.some((call) => call.method === "DELETE"),
      ).toBe(true)
      expect(container.textContent).toContain("Révoqué")
    } finally {
      await act(async () => root.unmount())
      container.remove()
      ;(globalThis as any).fetch = realFetch
    }
  })
})
