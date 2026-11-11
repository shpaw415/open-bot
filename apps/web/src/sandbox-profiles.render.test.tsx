import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import {
  isBrokeredModelRef,
  sandboxModelChoice,
  SandboxProfiles,
} from "./SandboxProfiles"

/**
 * Rendered contract for the Config Sandbox tab (spec phase 2): the
 * built-in profiles list read-only with their model line, "Nouveau
 * profil" opens the editor dialog, and the dialog's own guards (network
 * warning, disabled save) react to the draft. The pure model-choice
 * helpers are pinned beside it.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

function installFetch() {
  const real = (globalThis as any).fetch
  ;(globalThis as any).fetch = (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    let body: unknown = {}
    if (path === "/api/sandbox-profiles") {
      body = {
        profiles: [
          {
            id: "locked",
            name: "locked",
            builtin: true,
            profile: {
              name: "locked",
              instruction: "",
              skills: [],
              mcp: [],
              tools: {
                bash: false,
                read: true,
                write: true,
                edit: true,
                glob: true,
                grep: true,
                list: true,
                webfetch: false,
                task: false,
              },
              network: "off",
              mcpSecrets: false,
              ttlMinutes: 120,
              idleMinutes: 30,
              limits: { memoryMb: 1024, cpus: 1, pids: 256, steps: 128 },
            },
          },
          {
            id: "row-1",
            name: "recherche",
            builtin: false,
            profile: {
              name: "recherche",
              instruction: "",
              model: "xai/grok-4.5",
              skills: [],
              mcp: [],
              tools: {
                bash: false,
                read: true,
                write: true,
                edit: true,
                glob: true,
                grep: true,
                list: true,
                webfetch: false,
                task: false,
              },
              network: "on",
              mcpSecrets: false,
              ttlMinutes: 60,
              idleMinutes: 15,
              limits: { memoryMb: 512, cpus: 1, pids: 128, steps: 64 },
            },
          },
        ],
      }
    } else if (path === "/api/personas/skill-catalog") {
      body = { skills: [], mcp: [], dirs: {}, live: true }
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }
  return () => {
    ;(globalThis as any).fetch = real
  }
}

async function renderTab() {
  const restoreFetch = installFetch()
  const RealSocket = (globalThis as any).WebSocket
  ;(globalThis as any).WebSocket = class {
    close() {}
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<SandboxProfiles />)
  })
  await flush()
  return async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    ;(globalThis as any).WebSocket = RealSocket
    restoreFetch()
  }
}

describe("SandboxProfiles (render)", () => {
  test("lists built-ins read-only and customs with model + summary line", async () => {
    const done = await renderTab()
    const text = document.body.textContent ?? ""
    expect(text).toContain("locked")
    expect(text).toContain("intégré")
    expect(text).toContain("recherche")
    expect(text).toContain("Clé du coffre · xai/grok-4.5")
    // The built-in shows Voir (not Modifier/Supprimer).
    const builtinCard = [...document.querySelectorAll("button")]
      .filter((button) => button.textContent === "Voir")
    expect(builtinCard.length).toBeGreaterThanOrEqual(1)
    expect(text).toContain("Modifier")
    expect(text).toContain("Supprimer")
    await done()
  })

  test("Nouveau profil opens the editor; network warning reacts; save guards", async () => {
    const done = await renderTab()
    const open = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Nouveau profil",
    )
    expect(open).toBeTruthy()
    await act(async () => {
      open?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await flush()
    let text = document.body.textContent ?? ""
    expect(text).toContain("Nouveau profil de bac à sable")
    expect(text).toContain("Compétences autorisées")
    expect(text).toContain("Serveurs MCP autorisés")
    expect(text).toContain("Outils intégrés")
    // Offline default: no open-network warning renders.
    expect(text).not.toContain("Réseau ouvert :")

    // Save is disabled until a name is set (controlled-input typing is
    // not simulatable under happy-dom + React 19 — the pure caps and the
    // server-side parseSandboxProfile carry the rest).
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Enregistrer",
    )
    expect(save?.hasAttribute("disabled")).toBe(true)
    await done()
  })
})

describe("sandbox model choice helpers", () => {
  test("instance refs keep their key, refs with a slash become broker", () => {
    expect(sandboxModelChoice(undefined)).toBe("chat")
    expect(sandboxModelChoice("chat")).toBe("chat")
    expect(sandboxModelChoice("small")).toBe("small")
    expect(sandboxModelChoice("xai/grok-4.5")).toBe("broker")
    expect(isBrokeredModelRef("xai/grok-4.5")).toBe(true)
    expect(isBrokeredModelRef("chat")).toBe(false)
  })
})
